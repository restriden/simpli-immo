import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GHL_API_BASE = "https://services.leadconnectorhq.com";
const GHL_CLIENT_ID = "69432ebdab47804bce51b78a-mjalsvpx";
const GHL_CLIENT_SECRET = Deno.env.get("GHL_CLIENT_SECRET") || "";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const GHL_AGENCY_API_KEY = Deno.env.get("GHL_AGENCY_API_KEY") || "";

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

    // 2. Ensure token is valid (refresh if needed)
    const validConnection = await ensureValidToken(supabase, connection);

    // 3. Fetch users from GHL API
    // Use Agency API key for /users/ endpoint as it requires company-level access
    const apiToken = GHL_AGENCY_API_KEY || validConnection.access_token;
    console.log("Using API token type:", GHL_AGENCY_API_KEY ? "Agency API Key" : "Connection Token");

    const ghlResponse = await fetch(
      `${GHL_API_BASE}/users/?locationId=${location_id}`,
      {
        headers: {
          Authorization: `Bearer ${apiToken}`,
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

interface GHLConnection {
  id: string;
  user_id: string;
  location_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  is_active: boolean;
  location_name?: string;
}

async function ensureValidToken(
  supabase: any,
  connection: GHLConnection
): Promise<GHLConnection> {
  // Skip token refresh for agency key connections
  if (connection.refresh_token === 'AGENCY_KEY' || !connection.refresh_token || !connection.token_expires_at) {
    console.log(`Using agency key for location ${connection.location_id} - no refresh needed`);
    return connection;
  }

  const expiresAt = new Date(connection.token_expires_at);
  const now = new Date();

  // Refresh if token expires in less than 5 minutes
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  if (expiresAt <= fiveMinutesFromNow) {
    console.log(`Refreshing token for location ${connection.location_id}`);

    const response = await fetch(GHL_TOKEN_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Accept: "application/json",
      },
      body: new URLSearchParams({
        client_id: GHL_CLIENT_ID,
        client_secret: GHL_CLIENT_SECRET,
        grant_type: "refresh_token",
        refresh_token: connection.refresh_token,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Token refresh failed:", errorText);

      // Mark connection as inactive if refresh fails
      await supabase
        .from("ghl_connections")
        .update({ is_active: false })
        .eq("id", connection.id);

      throw new Error("Token refresh failed - connection deactivated");
    }

    const tokens = await response.json();
    const newExpiresAt = new Date();
    newExpiresAt.setSeconds(newExpiresAt.getSeconds() + tokens.expires_in);

    // Update tokens in database
    await supabase
      .from("ghl_connections")
      .update({
        access_token: tokens.access_token,
        refresh_token: tokens.refresh_token,
        token_expires_at: newExpiresAt.toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", connection.id);

    connection.access_token = tokens.access_token;
    connection.refresh_token = tokens.refresh_token;
    connection.token_expires_at = newExpiresAt.toISOString();

    console.log("Token refreshed successfully");
  }

  return connection;
}

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
