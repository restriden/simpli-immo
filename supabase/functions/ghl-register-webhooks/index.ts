import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const GHL_WEBHOOK_URL = "https://hsfrdovpgxtqbitmkrhs.supabase.co/functions/v1/ghl-webhook";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Register webhooks for an existing GHL connection
 * Call this to set up webhooks for users who connected before automatic registration was added
 */
serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse request
    const { user_id } = await req.json();

    if (!user_id) {
      return jsonResponse({ error: "Missing user_id" }, 400);
    }

    console.log("=== REGISTER WEBHOOKS ===");
    console.log("User ID:", user_id);

    // Get the connection
    const { data: connection, error: connError } = await supabase
      .from("ghl_connections")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .single();

    if (connError || !connection) {
      return jsonResponse({ error: "No active GHL connection found" }, 404);
    }

    console.log("Found connection for location:", connection.location_id);

    // Register webhooks
    const result = await registerWebhooks(
      connection.access_token,
      connection.location_id
    );

    // Log result
    await supabase.from("ghl_sync_logs").insert({
      connection_id: connection.id,
      sync_type: "webhook_registration",
      status: result.success ? "success" : "error",
      message: result.success
        ? `Registered ${result.webhookIds.length} webhooks`
        : `Errors: ${result.errors.join(", ")}`,
      metadata: result,
    });

    return jsonResponse({
      success: result.success,
      webhooks_registered: result.webhookIds.length,
      webhook_ids: result.webhookIds,
      errors: result.errors,
    });
  } catch (err) {
    console.error("Register webhooks error:", err);
    return jsonResponse({ error: err.message || "Internal error" }, 500);
  }
});

async function registerWebhooks(
  accessToken: string,
  locationId: string
): Promise<{ success: boolean; webhookIds: string[]; errors: string[] }> {
  const webhookIds: string[] = [];
  const errors: string[] = [];

  const headers = {
    Authorization: `Bearer ${accessToken}`,
    Version: "2021-07-28",
    "Content-Type": "application/json",
    Accept: "application/json",
  };

  // Events to subscribe to
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

  // First check existing webhooks
  try {
    console.log("Checking existing webhooks...");
    const existingResponse = await fetch(
      `https://services.leadconnectorhq.com/webhooks/?locationId=${locationId}`,
      { method: "GET", headers }
    );

    if (existingResponse.ok) {
      const existingData = await existingResponse.json();
      const existingWebhooks = existingData.webhooks || [];
      console.log("Existing webhooks:", existingWebhooks.length);

      // Find our webhooks
      const ourWebhooks = existingWebhooks.filter(
        (w: any) => w.url === GHL_WEBHOOK_URL
      );

      if (ourWebhooks.length > 0) {
        console.log("Our webhooks already exist:", ourWebhooks.length);
        // Delete old ones to re-register fresh
        for (const webhook of ourWebhooks) {
          try {
            console.log("Deleting old webhook:", webhook.id);
            await fetch(
              `https://services.leadconnectorhq.com/webhooks/${webhook.id}`,
              { method: "DELETE", headers }
            );
          } catch (e) {
            console.error("Error deleting webhook:", e);
          }
        }
      }
    }
  } catch (err) {
    console.error("Error checking existing webhooks:", err);
  }

  // Register each webhook
  for (const config of webhookConfigs) {
    try {
      console.log(`Registering: ${config.name}`);

      const response = await fetch(
        "https://services.leadconnectorhq.com/webhooks/",
        {
          method: "POST",
          headers,
          body: JSON.stringify({
            name: config.name,
            url: GHL_WEBHOOK_URL,
            events: config.events,
            locationId: locationId,
          }),
        }
      );

      const responseText = await response.text();
      console.log(`Response for ${config.name}:`, response.status, responseText);

      if (response.ok) {
        const data = JSON.parse(responseText);
        if (data.webhook?.id) {
          webhookIds.push(data.webhook.id);
          console.log(`Registered: ${config.name} -> ${data.webhook.id}`);
        }
      } else {
        errors.push(`${config.name}: ${response.status} - ${responseText}`);
      }
    } catch (err) {
      console.error(`Error registering ${config.name}:`, err);
      errors.push(`${config.name}: ${err.message}`);
    }
  }

  return {
    success: webhookIds.length > 0,
    webhookIds,
    errors,
  };
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
