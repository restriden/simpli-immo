import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Workflow Triggered Webhook Handler
 *
 * Receives webhooks from GHL workflows to track when specific actions occur.
 * Currently supports:
 * - makler_notified: Tracks when Makler was notified via GHL workflow
 *
 * Expected payload from GHL workflow webhook action:
 * {
 *   "contact_id": "abc123",       // GHL Contact ID
 *   "location_id": "loc456",      // GHL Location ID
 *   "action": "makler_notified",  // Action type
 *   "timestamp": "2025-12-23..."  // Optional, defaults to now
 * }
 */
serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  // Handle GET/HEAD requests (GHL webhook validation)
  if (req.method === "GET" || req.method === "HEAD") {
    console.log("Webhook validation request received:", req.method);
    return new Response(req.method === "HEAD" ? null : JSON.stringify({ success: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse webhook payload
    const payload = await req.json();
    console.log("=== WORKFLOW TRIGGERED WEBHOOK ===");
    console.log("Payload:", JSON.stringify(payload, null, 2));

    // Extract data from payload - GHL can send in various formats
    const contactId = payload.contact_id || payload.contactId || payload.contact?.id;
    const locationId = payload.location_id || payload.locationId;
    const action = payload.action || payload.type || "makler_notified";
    const timestamp = payload.timestamp || new Date().toISOString();

    // Validate required fields
    if (!contactId) {
      console.error("Missing contact_id in payload");
      return jsonResponse({
        success: false,
        error: "Missing contact_id"
      }, 400);
    }

    console.log(`Processing workflow action: ${action} for contact: ${contactId}`);

    // Find the lead by GHL contact ID
    let leadQuery = supabase
      .from("leads")
      .select("id, name, ghl_location_id")
      .eq("ghl_contact_id", contactId);

    // If location_id provided, add to filter for more precise matching
    if (locationId) {
      leadQuery = leadQuery.eq("ghl_location_id", locationId);
    }

    const { data: lead, error: leadError } = await leadQuery.single();

    if (leadError || !lead) {
      console.error("Lead not found for contact:", contactId, "Error:", leadError?.message);
      return jsonResponse({
        success: false,
        error: "Lead not found",
        contact_id: contactId
      }, 404);
    }

    console.log(`Found lead: ${lead.id} (${lead.name})`);

    // Handle different workflow actions
    switch (action) {
      case "makler_notified":
      case "makler-notified":
      case "notify_makler":
        // Update makler_notified_at timestamp
        const { error: updateError } = await supabase
          .from("leads")
          .update({
            makler_notified_at: timestamp,
            updated_at: new Date().toISOString(),
          })
          .eq("id", lead.id);

        if (updateError) {
          console.error("Error updating lead:", updateError);
          return jsonResponse({
            success: false,
            error: "Failed to update lead"
          }, 500);
        }

        console.log(`Updated makler_notified_at for lead ${lead.id} to ${timestamp}`);

        return jsonResponse({
          success: true,
          action: "makler_notified",
          lead_id: lead.id,
          lead_name: lead.name,
          notified_at: timestamp,
        });

      default:
        console.log("Unknown workflow action:", action);
        return jsonResponse({
          success: false,
          error: `Unknown action: ${action}`,
        }, 400);
    }

  } catch (err) {
    console.error("Workflow webhook error:", err);
    return jsonResponse({
      success: false,
      error: err.message || "Internal error"
    }, 500);
  }
});

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
