import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { user_id, business_name } = await req.json();

    if (!user_id || !business_name) {
      return new Response(
        JSON.stringify({ error: "user_id and business_name required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("=== UPDATE BUSINESS NAME ===");
    console.log("User ID:", user_id);
    console.log("New Name:", business_name);

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Get GHL connection for this user
    const { data: connection, error: connError } = await supabase
      .from("ghl_connections")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .single();

    if (connError || !connection) {
      console.error("No active GHL connection found:", connError);
      return new Response(
        JSON.stringify({ error: "Keine aktive CRM-Verbindung gefunden" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log("Found connection for location:", connection.location_id);

    // 2. Update GHL Location name via API
    let ghlUpdated = false;
    try {
      const ghlResponse = await fetch(
        `https://services.leadconnectorhq.com/locations/${connection.location_id}`,
        {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${connection.access_token}`,
            Version: "2021-07-28",
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            name: business_name,
          }),
        }
      );

      if (ghlResponse.ok) {
        console.log("GHL location name updated successfully");
        ghlUpdated = true;
      } else {
        const errorText = await ghlResponse.text();
        console.error("GHL update failed:", ghlResponse.status, errorText);
      }
    } catch (ghlError) {
      console.error("GHL API error:", ghlError);
    }

    // 3. Update profiles.company_name
    const { error: profileError } = await supabase
      .from("profiles")
      .update({ company_name: business_name })
      .eq("id", user_id);

    if (profileError) {
      console.error("Profile update failed:", profileError);
    } else {
      console.log("Profile updated");
    }

    // 4. Update ghl_connections.location_name
    const { error: connUpdateError } = await supabase
      .from("ghl_connections")
      .update({ location_name: business_name })
      .eq("user_id", user_id);

    if (connUpdateError) {
      console.error("Connection update failed:", connUpdateError);
    } else {
      console.log("Connection updated");
    }

    // 5. Update approved_subaccounts.location_name
    const { error: approvedError } = await supabase
      .from("approved_subaccounts")
      .update({ location_name: business_name })
      .eq("location_id", connection.location_id);

    if (approvedError) {
      console.error("Approved subaccounts update failed:", approvedError);
    } else {
      console.log("Approved subaccounts updated");
    }

    return new Response(
      JSON.stringify({
        success: true,
        ghl_updated: ghlUpdated,
        message: ghlUpdated
          ? "Name überall synchronisiert"
          : "Name lokal gespeichert, GHL-Sync fehlgeschlagen",
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error:", error);
    return new Response(
      JSON.stringify({ error: error.message || "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
