import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateContactRequest {
  user_id: string;
  first_name: string;
  last_name?: string;
  email?: string;
  phone?: string;
  objekt_id?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const body: CreateContactRequest = await req.json();
    const { user_id, first_name, last_name, email, phone, objekt_id } = body;

    console.log("=== CREATE CONTACT REQUEST ===");
    console.log("User ID:", user_id);
    console.log("Name:", first_name, last_name);
    console.log("Email:", email);
    console.log("Phone:", phone);
    console.log("Objekt ID:", objekt_id);

    if (!user_id || !first_name) {
      return jsonResponse({ error: "Missing required fields (user_id, first_name)" }, 400);
    }

    // Get GHL connection
    const { data: connection, error: connError } = await supabase
      .from("ghl_connections")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .single();

    if (connError || !connection) {
      console.error("No GHL connection found:", connError);
      return jsonResponse({ error: "No active GHL connection" }, 400);
    }

    // Create contact in GHL
    const ghlContactData: any = {
      firstName: first_name,
      locationId: connection.location_id,
    };

    if (last_name) ghlContactData.lastName = last_name;
    if (email) ghlContactData.email = email;
    if (phone) ghlContactData.phone = phone;

    console.log("Creating contact in GHL:", JSON.stringify(ghlContactData));

    const ghlResponse = await fetch(`${GHL_API_BASE}/contacts/`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${connection.access_token}`,
        Version: "2021-07-28",
        "Content-Type": "application/json",
      },
      body: JSON.stringify(ghlContactData),
    });

    const ghlResult = await ghlResponse.json();

    if (!ghlResponse.ok) {
      console.error("GHL contact creation failed:", ghlResponse.status, JSON.stringify(ghlResult));
      return jsonResponse({
        error: "Failed to create contact in GHL",
        details: ghlResult
      }, 500);
    }

    const ghlContactId = ghlResult.contact?.id || ghlResult.id;
    console.log("Contact created in GHL:", ghlContactId);

    // Create lead in local database
    const fullName = last_name ? `${first_name} ${last_name}` : first_name;

    const leadData = {
      user_id,
      name: fullName,
      email: email || null,
      phone: phone || null,
      status: "neu",
      source: "app",
      ghl_contact_id: ghlContactId,
      objekt_id: objekt_id || null,
      auto_respond_enabled: false,
    };

    const { data: newLead, error: insertError } = await supabase
      .from("leads")
      .insert(leadData)
      .select()
      .single();

    if (insertError) {
      console.error("Error creating lead:", insertError);
      return jsonResponse({ error: "Failed to create lead locally" }, 500);
    }

    console.log("Lead created locally:", newLead.id);

    return jsonResponse({
      success: true,
      lead: newLead,
      ghl_contact_id: ghlContactId,
    });
  } catch (err) {
    console.error("Create contact error:", err);
    return jsonResponse({ error: err.message || "Internal error" }, 500);
  }
});

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
