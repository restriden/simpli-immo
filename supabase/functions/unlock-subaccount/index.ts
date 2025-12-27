import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GHL_API_BASE = "https://services.leadconnectorhq.com";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GHLUser {
  id: string;
  firstName: string;
  lastName: string;
  email: string;
  phone?: string;
  role: string;
}

interface UnlockResult {
  success: boolean;
  location_name?: string;
  users_created: number;
  users_existing: number;
  users_failed: number;
  details: Array<{
    email: string;
    status: 'created' | 'existing' | 'failed';
    error?: string;
  }>;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const { location_id } = await req.json();

    if (!location_id) {
      return jsonResponse({ error: "location_id is required" }, 400);
    }

    console.log("=== UNLOCK SUBACCOUNT ===");
    console.log("Location ID:", location_id);

    // 1. Get GHL connection for this location
    const { data: connection, error: connError } = await supabase
      .from("ghl_connections")
      .select("*")
      .eq("location_id", location_id)
      .eq("is_active", true)
      .single();

    if (connError || !connection) {
      console.error("No connection found:", connError);
      return jsonResponse({ error: "No active connection found for this location" }, 404);
    }

    console.log("Found connection:", connection.location_name);

    // 2. Fetch users from GHL API
    const ghlResponse = await fetch(
      `${GHL_API_BASE}/users/?locationId=${location_id}`,
      {
        headers: {
          Authorization: `Bearer ${connection.access_token}`,
          Version: "2021-07-28",
          Accept: "application/json",
        },
      }
    );

    if (!ghlResponse.ok) {
      const errorText = await ghlResponse.text();
      console.error("GHL API error:", ghlResponse.status, errorText);
      return jsonResponse({
        error: `Failed to fetch users from GHL: ${ghlResponse.status}`,
        details: errorText
      }, 500);
    }

    const ghlData = await ghlResponse.json();
    const ghlUsers: GHLUser[] = ghlData.users || [];

    console.log(`Found ${ghlUsers.length} users in GHL`);

    // 3. Create Supabase accounts for each user
    const result: UnlockResult = {
      success: true,
      location_name: connection.location_name,
      users_created: 0,
      users_existing: 0,
      users_failed: 0,
      details: [],
    };

    for (const ghlUser of ghlUsers) {
      if (!ghlUser.email) {
        console.log(`Skipping user ${ghlUser.id} - no email`);
        continue;
      }

      try {
        // Check if user already exists
        const { data: existingUsers } = await supabase.auth.admin.listUsers();
        const existingUser = existingUsers?.users?.find(
          (u) => u.email?.toLowerCase() === ghlUser.email.toLowerCase()
        );

        if (existingUser) {
          console.log(`User ${ghlUser.email} already exists`);
          result.users_existing++;
          result.details.push({ email: ghlUser.email, status: 'existing' });

          // Update user metadata to link to this location if not already
          const currentLocations = existingUser.user_metadata?.ghl_location_ids || [];
          if (!currentLocations.includes(location_id)) {
            await supabase.auth.admin.updateUserById(existingUser.id, {
              user_metadata: {
                ...existingUser.user_metadata,
                ghl_location_ids: [...currentLocations, location_id],
              },
            });
          }
          continue;
        }

        // Create new user
        const fullName = `${ghlUser.firstName || ""} ${ghlUser.lastName || ""}`.trim() || "Unbekannt";

        const { data: newUser, error: createError } = await supabase.auth.admin.createUser({
          email: ghlUser.email,
          password: "simpli123",
          email_confirm: true,
          user_metadata: {
            must_change_password: true,
            ghl_user_id: ghlUser.id,
            ghl_location_id: location_id,
            ghl_location_ids: [location_id],
            full_name: fullName,
          },
        });

        if (createError) {
          console.error(`Failed to create user ${ghlUser.email}:`, createError);
          result.users_failed++;
          result.details.push({
            email: ghlUser.email,
            status: 'failed',
            error: createError.message
          });
          continue;
        }

        console.log(`Created user: ${ghlUser.email}`);

        // Create profile
        await supabase.from("profiles").upsert({
          id: newUser.user.id,
          email: ghlUser.email,
          full_name: fullName,
          company_name: connection.location_name,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        });

        result.users_created++;
        result.details.push({ email: ghlUser.email, status: 'created' });

      } catch (userError: any) {
        console.error(`Error processing user ${ghlUser.email}:`, userError);
        result.users_failed++;
        result.details.push({
          email: ghlUser.email,
          status: 'failed',
          error: userError.message
        });
      }
    }

    console.log("=== UNLOCK COMPLETE ===");
    console.log(`Created: ${result.users_created}, Existing: ${result.users_existing}, Failed: ${result.users_failed}`);

    return jsonResponse(result);

  } catch (error: any) {
    console.error("Unlock subaccount error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
});

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
