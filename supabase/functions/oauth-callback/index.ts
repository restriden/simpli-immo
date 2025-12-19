import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GHL_CLIENT_ID = "69432ebdab47804bce51b78a-mjalsvpx";
const GHL_CLIENT_SECRET = Deno.env.get("GHL_CLIENT_SECRET") || "";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const REDIRECT_URI = "https://hsfrdovpgxtqbitmkrhs.supabase.co/functions/v1/oauth-callback";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GHL_WEBHOOK_URL = "https://hsfrdovpgxtqbitmkrhs.supabase.co/functions/v1/ghl-webhook";

// App deep link for redirect after OAuth
const APP_SUCCESS_REDIRECT = "simpliimmo://oauth/success";
const APP_ERROR_REDIRECT = "simpliimmo://oauth/error";
const WEB_SUCCESS_REDIRECT = "https://simpli.immo/app/connected";
const WEB_ERROR_REDIRECT = "https://simpli.immo/app/error";

interface GHLTokenResponse {
  access_token: string;
  refresh_token: string;
  token_type: string;
  expires_in: number;
  scope: string;
  locationId: string;
  companyId: string;
  userId: string;
}

interface GHLLocationResponse {
  location: {
    id: string;
    name: string;
    email: string;
    phone: string;
    address: string;
    city: string;
    country: string;
    postalCode: string;
    timezone: string;
  };
}

serve(async (req: Request) => {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // Contains user_id from our app
  const error = url.searchParams.get("error");
  const errorDescription = url.searchParams.get("error_description");

  // Debug: Log environment variables status
  console.log("=== OAuth Callback Debug ===");
  console.log("SUPABASE_URL set:", !!SUPABASE_URL, "length:", SUPABASE_URL.length);
  console.log("SUPABASE_SERVICE_ROLE_KEY set:", !!SUPABASE_SERVICE_ROLE_KEY, "length:", SUPABASE_SERVICE_ROLE_KEY.length);
  console.log("GHL_CLIENT_SECRET set:", !!GHL_CLIENT_SECRET, "length:", GHL_CLIENT_SECRET.length);
  console.log("Request URL:", req.url);
  console.log("Code present:", !!code);
  console.log("State (user_id):", state);

  // Handle OAuth errors from GHL
  if (error) {
    console.error("OAuth error from GHL:", error, errorDescription);
    return redirectToApp(false, `OAuth error: ${errorDescription || error}`);
  }

  // Validate required parameters
  if (!code) {
    console.error("Missing authorization code");
    return redirectToApp(false, "Missing authorization code");
  }

  if (!state) {
    console.error("Missing state parameter (user_id)");
    return redirectToApp(false, "Missing state parameter");
  }

  const userId = state;

  // Validate UUID format
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(userId)) {
    console.error("Invalid user_id format (not a UUID):", userId);
    return redirectToApp(false, "Ungültige Benutzer-ID");
  }

  try {
    // Step 1: Exchange code for tokens
    console.log("Exchanging code for tokens...");
    const tokenResponse = await exchangeCodeForTokens(code);

    if (!tokenResponse.access_token || !tokenResponse.locationId) {
      console.error("Invalid token response:", tokenResponse);
      return redirectToApp(false, "Invalid token response from GHL");
    }

    console.log("Token exchange successful, locationId:", tokenResponse.locationId);

    // Step 2: Initialize Supabase client
    console.log("Initializing Supabase client...");
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Step 2.5: Verify user exists in auth.users
    console.log("Verifying user exists in auth.users...");
    const { data: authUser, error: authError } = await supabase.auth.admin.getUserById(userId);

    if (authError || !authUser?.user) {
      console.error("User not found in auth.users:", userId);
      console.error("Auth error:", authError);
      return redirectToApp(false, "Benutzer nicht gefunden. Bitte erneut einloggen.");
    }
    console.log("User verified:", authUser.user.email);

    // Step 3: Check if location is whitelisted
    console.log("Checking whitelist for locationId:", tokenResponse.locationId);
    const { data: whitelistEntry, error: whitelistError } = await supabase
      .from("approved_subaccounts")
      .select("*")
      .eq("location_id", tokenResponse.locationId)
      .eq("is_active", true)
      .maybeSingle();

    // Check expiry if set
    const isExpired = whitelistEntry?.expires_at && new Date(whitelistEntry.expires_at) < new Date();

    if (whitelistError || !whitelistEntry || isExpired) {
      console.error("Location not whitelisted or expired:", tokenResponse.locationId);
      return redirectToApp(
        false,
        "Dieser Subaccount ist nicht freigeschaltet. Bitte kontaktiere den Support."
      );
    }

    console.log("Location is whitelisted:", whitelistEntry.location_name || whitelistEntry.location_id);

    // Step 4: Get location details from GHL
    console.log("Fetching location details...");
    const locationDetails = await getLocationDetails(
      tokenResponse.access_token,
      tokenResponse.locationId
    );

    // Step 5: Calculate token expiry
    const expiresAt = new Date();
    expiresAt.setSeconds(expiresAt.getSeconds() + tokenResponse.expires_in);

    // Step 6: Upsert connection to database
    console.log("Saving connection to database...");
    console.log("User ID:", userId);
    console.log("Location ID:", tokenResponse.locationId);

    const connectionData = {
      user_id: userId,
      location_id: tokenResponse.locationId,
      company_id: tokenResponse.companyId || null,
      ghl_user_id: tokenResponse.userId || null,
      access_token: tokenResponse.access_token,
      refresh_token: tokenResponse.refresh_token,
      token_expires_at: expiresAt.toISOString(),
      scope: tokenResponse.scope || null,
      location_name: locationDetails?.location?.name || null,
      location_email: locationDetails?.location?.email || null,
      location_timezone: locationDetails?.location?.timezone || null,
      is_active: true,
      last_sync_at: null,
    };

    console.log("Connection data to insert:", JSON.stringify(connectionData, null, 2));

    // First try to find existing connection
    console.log("Checking for existing connection...");
    const { data: existingConnection, error: existingError } = await supabase
      .from("ghl_connections")
      .select("id")
      .eq("user_id", userId)
      .single();

    console.log("Existing connection check - data:", existingConnection, "error:", existingError?.code);

    let connection;
    let connectionError;

    if (existingConnection) {
      // Update existing
      console.log("Updating existing connection:", existingConnection.id);
      const result = await supabase
        .from("ghl_connections")
        .update(connectionData)
        .eq("id", existingConnection.id)
        .select()
        .single();
      connection = result.data;
      connectionError = result.error;
      console.log("Update result - data:", !!connection, "error:", result.error);
    } else {
      // Insert new
      console.log("Inserting new connection...");
      console.log("Insert data:", JSON.stringify(connectionData, null, 2));
      const result = await supabase
        .from("ghl_connections")
        .insert(connectionData)
        .select()
        .single();
      connection = result.data;
      connectionError = result.error;
      console.log("Insert result - data:", !!connection, "error:", result.error);
    }

    // Double-check by querying the connection
    console.log("Verifying connection was saved...");
    const { data: verifyConnection, error: verifyError } = await supabase
      .from("ghl_connections")
      .select("id, user_id, location_id, is_active")
      .eq("user_id", userId)
      .single();
    console.log("Verification result - data:", verifyConnection, "error:", verifyError?.code);

    if (connectionError) {
      console.error("Error saving connection:", JSON.stringify(connectionError, null, 2));
      console.error("Error code:", connectionError.code);
      console.error("Error message:", connectionError.message);
      console.error("Error details:", connectionError.details);
      console.error("Error hint:", connectionError.hint);
      return redirectToApp(false, `Fehler beim Speichern: ${connectionError.message || connectionError.code}`);
    }

    if (!connection) {
      console.error("No connection returned after save");
      return redirectToApp(false, "Keine Verbindung nach Speichern erhalten");
    }

    console.log("Connection saved successfully:", connection.id);

    // Step 7: Register webhooks automatically for this location
    console.log("Registering webhooks for location...");
    const webhookResult = await registerWebhooks(
      tokenResponse.access_token,
      tokenResponse.locationId
    );
    console.log("Webhook registration result:", webhookResult);

    // Step 8: Log the successful connection
    await supabase.from("ghl_sync_logs").insert({
      connection_id: connection.id,
      sync_type: "oauth",
      status: "success",
      message: "OAuth connection established successfully",
      metadata: {
        location_id: tokenResponse.locationId,
        scopes: tokenResponse.scope,
        webhooks_registered: webhookResult.success,
        webhook_ids: webhookResult.webhookIds,
      },
    });

    // Step 9: Redirect to success
    return redirectToApp(true, "Verbindung erfolgreich hergestellt!");
  } catch (err) {
    console.error("OAuth callback error:", err);
    return redirectToApp(false, `Fehler: ${err.message || "Unbekannter Fehler"}`);
  }
});

async function exchangeCodeForTokens(code: string): Promise<GHLTokenResponse> {
  const response = await fetch(GHL_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      client_id: GHL_CLIENT_ID,
      client_secret: GHL_CLIENT_SECRET,
      grant_type: "authorization_code",
      code: code,
      redirect_uri: REDIRECT_URI,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error("Token exchange failed:", response.status, errorText);
    throw new Error(`Token exchange failed: ${response.status}`);
  }

  return await response.json();
}

async function getLocationDetails(
  accessToken: string,
  locationId: string
): Promise<GHLLocationResponse | null> {
  try {
    const response = await fetch(
      `https://services.leadconnectorhq.com/locations/${locationId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: "2021-07-28",
          Accept: "application/json",
        },
      }
    );

    if (!response.ok) {
      console.error("Failed to get location details:", response.status);
      return null;
    }

    return await response.json();
  } catch (err) {
    console.error("Error fetching location details:", err);
    return null;
  }
}

function redirectToApp(success: boolean, message: string): Response {
  const encodedMessage = encodeURIComponent(message);

  // Use deep link for app redirect (HTTP 302)
  const appRedirect = success
    ? `${APP_SUCCESS_REDIRECT}?message=${encodedMessage}`
    : `${APP_ERROR_REDIRECT}?message=${encodedMessage}`;

  console.log("Redirecting to:", appRedirect);

  // Return HTTP 302 redirect to deep link
  // This is what WebBrowser.openAuthSessionAsync expects
  return new Response(null, {
    status: 302,
    headers: {
      "Location": appRedirect,
    },
  });
}

/**
 * Register webhooks for a GHL location
 * This automatically subscribes to message and contact events
 */
async function registerWebhooks(
  accessToken: string,
  locationId: string
): Promise<{ success: boolean; webhookIds: string[]; errors: string[] }> {
  const webhookIds: string[] = [];
  const errors: string[] = [];

  // Events we want to subscribe to
  const webhookConfigs = [
    {
      name: "Simpli.Immo - Inbound Messages",
      events: ["InboundMessage"],
    },
    {
      name: "Simpli.Immo - Outbound Messages",
      events: ["OutboundMessage"],
    },
    {
      name: "Simpli.Immo - Contacts",
      events: ["ContactCreate", "ContactUpdate"],
    },
  ];

  // First, check for existing webhooks to avoid duplicates
  try {
    console.log("Checking for existing webhooks...");
    const existingResponse = await fetch(
      `https://services.leadconnectorhq.com/webhooks/?locationId=${locationId}`,
      {
        method: "GET",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Version: "2021-07-28",
          Accept: "application/json",
        },
      }
    );

    if (existingResponse.ok) {
      const existingData = await existingResponse.json();
      const existingWebhooks = existingData.webhooks || [];

      // Check if our webhooks already exist
      const ourWebhookUrls = existingWebhooks.filter(
        (w: any) => w.url === GHL_WEBHOOK_URL
      );

      if (ourWebhookUrls.length > 0) {
        console.log("Webhooks already registered:", ourWebhookUrls.length);
        return {
          success: true,
          webhookIds: ourWebhookUrls.map((w: any) => w.id),
          errors: [],
        };
      }
    }
  } catch (err) {
    console.error("Error checking existing webhooks:", err);
    // Continue to try registering anyway
  }

  // Register each webhook config
  for (const config of webhookConfigs) {
    try {
      console.log(`Registering webhook: ${config.name}`);

      const response = await fetch(
        "https://services.leadconnectorhq.com/webhooks/",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Version: "2021-07-28",
            "Content-Type": "application/json",
            Accept: "application/json",
          },
          body: JSON.stringify({
            name: config.name,
            url: GHL_WEBHOOK_URL,
            events: config.events,
            locationId: locationId,
          }),
        }
      );

      if (response.ok) {
        const data = await response.json();
        console.log(`Webhook registered: ${config.name}`, data);
        if (data.webhook?.id) {
          webhookIds.push(data.webhook.id);
        }
      } else {
        const errorText = await response.text();
        console.error(`Failed to register webhook ${config.name}:`, response.status, errorText);
        errors.push(`${config.name}: ${response.status}`);
      }
    } catch (err) {
      console.error(`Error registering webhook ${config.name}:`, err);
      errors.push(`${config.name}: ${err.message}`);
    }
  }

  return {
    success: webhookIds.length > 0,
    webhookIds,
    errors,
  };
}
