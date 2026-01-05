import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const today = new Date().toISOString().split("T")[0]; // YYYY-MM-DD

  console.log(`[SendScheduledFollowups] Running for date: ${today}`);

  try {
    // 1. Get all approved follow-ups that are due today or earlier
    const { data: dueFollowups, error: fetchError } = await supabase
      .from("followup_approvals")
      .select(`
        *,
        leads!inner (
          id,
          ghl_contact_id,
          ghl_location_id,
          email,
          first_name,
          last_name,
          last_message_at
        )
      `)
      .eq("status", "approved")
      .or(`final_follow_up_date.lte.${today},and(final_follow_up_date.is.null,suggested_follow_up_date.lte.${today})`);

    if (fetchError) {
      throw new Error(`Error fetching due follow-ups: ${fetchError.message}`);
    }

    console.log(`[SendScheduledFollowups] Found ${dueFollowups?.length || 0} follow-ups due`);

    if (!dueFollowups || dueFollowups.length === 0) {
      return new Response(
        JSON.stringify({ success: true, sent: 0, message: "No follow-ups due today" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let sentCount = 0;
    let skippedCount = 0;
    const results: any[] = [];

    for (const followup of dueFollowups) {
      try {
        const lead = followup.leads;
        if (!lead || !lead.ghl_contact_id || !lead.ghl_location_id) {
          console.log(`[SendScheduledFollowups] Skipping ${followup.id}: Missing lead data`);
          skippedCount++;
          results.push({ id: followup.id, status: "skipped", reason: "Missing lead data" });
          continue;
        }

        // 2. Check if lead responded since approval (cancel if so)
        if (lead.last_message_at) {
          const lastMessageDate = new Date(lead.last_message_at);
          const approvedDate = new Date(followup.approved_at);

          if (lastMessageDate > approvedDate) {
            console.log(`[SendScheduledFollowups] Cancelling ${followup.id}: Lead responded after approval`);

            // Mark as expired instead of sending
            await supabase
              .from("followup_approvals")
              .update({
                status: "expired",
                updated_at: new Date().toISOString(),
                rejection_reason: "Automatisch abgebrochen: Lead hat nach Genehmigung geantwortet"
              })
              .eq("id", followup.id);

            skippedCount++;
            results.push({ id: followup.id, status: "cancelled", reason: "Lead responded after approval" });
            continue;
          }
        }

        // 3. Get GHL connection for this location
        const { data: connection, error: connError } = await supabase
          .from("ghl_connections")
          .select("access_token, refresh_token, token_expires_at")
          .eq("location_id", lead.ghl_location_id)
          .eq("is_active", true)
          .single();

        if (connError || !connection) {
          console.log(`[SendScheduledFollowups] Skipping ${followup.id}: No GHL connection for location`);
          skippedCount++;
          results.push({ id: followup.id, status: "skipped", reason: "No GHL connection" });
          continue;
        }

        // 4. Check if token needs refresh
        let accessToken = connection.access_token;
        const tokenExpiry = new Date(connection.token_expires_at);
        const now = new Date();

        if (tokenExpiry < now) {
          console.log(`[SendScheduledFollowups] Token expired, refreshing...`);
          const refreshResult = await refreshGhlToken(connection.refresh_token, lead.ghl_location_id, supabase);
          if (!refreshResult.success) {
            console.log(`[SendScheduledFollowups] Token refresh failed: ${refreshResult.error}`);
            skippedCount++;
            results.push({ id: followup.id, status: "skipped", reason: "Token refresh failed" });
            continue;
          }
          accessToken = refreshResult.accessToken;
        }

        // 5. Calculate if template is needed based on NOW (not approval time)
        const message = followup.final_message || followup.suggested_message;
        const needsTemplate = checkIfTemplateNeeded(lead);

        // 6. Send the message via GHL API
        const sendResult = await sendGhlMessage(
          accessToken,
          lead.ghl_location_id,
          lead.ghl_contact_id,
          message,
          needsTemplate
        );

        if (!sendResult.success) {
          console.log(`[SendScheduledFollowups] Failed to send ${followup.id}: ${sendResult.error}`);
          results.push({ id: followup.id, status: "failed", reason: sendResult.error });
          continue;
        }

        // 7. Mark as sent
        await supabase
          .from("followup_approvals")
          .update({
            status: "sent",
            sent_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          })
          .eq("id", followup.id);

        // 8. Store the message in our messages table
        await supabase.from("messages").insert({
          lead_id: lead.id,
          ghl_message_id: sendResult.messageId,
          content: message,
          type: "outgoing",
          created_at: new Date().toISOString()
        });

        console.log(`[SendScheduledFollowups] ✓ Sent follow-up ${followup.id} to ${lead.email || lead.ghl_contact_id}`);
        sentCount++;
        results.push({ id: followup.id, status: "sent" });

      } catch (err: any) {
        console.error(`[SendScheduledFollowups] Error processing ${followup.id}:`, err);
        results.push({ id: followup.id, status: "error", reason: err.message });
      }
    }

    console.log(`[SendScheduledFollowups] Complete. Sent: ${sentCount}, Skipped: ${skippedCount}`);

    return new Response(
      JSON.stringify({
        success: true,
        date: today,
        total: dueFollowups.length,
        sent: sentCount,
        skipped: skippedCount,
        results
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error: any) {
    console.error("[SendScheduledFollowups] Error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

// Check if template message is needed (24h window closed)
function checkIfTemplateNeeded(lead: any): boolean {
  if (!lead.last_message_at) return true; // No messages = need template

  const lastMessageTime = new Date(lead.last_message_at).getTime();
  const now = Date.now();
  const hoursSinceLastMessage = (now - lastMessageTime) / (1000 * 60 * 60);

  return hoursSinceLastMessage > 24;
}

// Refresh GHL OAuth token
async function refreshGhlToken(
  refreshToken: string,
  locationId: string,
  supabase: any
): Promise<{ success: boolean; accessToken?: string; error?: string }> {
  try {
    const GHL_CLIENT_ID = Deno.env.get("GHL_CLIENT_ID");
    const GHL_CLIENT_SECRET = Deno.env.get("GHL_CLIENT_SECRET");

    const response = await fetch("https://services.leadconnectorhq.com/oauth/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: refreshToken,
        client_id: GHL_CLIENT_ID!,
        client_secret: GHL_CLIENT_SECRET!,
      }),
    });

    if (!response.ok) {
      return { success: false, error: `Token refresh failed: ${response.status}` };
    }

    const tokenData = await response.json();
    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000).toISOString();

    // Update token in database
    await supabase
      .from("ghl_connections")
      .update({
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        token_expires_at: expiresAt,
        updated_at: new Date().toISOString()
      })
      .eq("location_id", locationId);

    return { success: true, accessToken: tokenData.access_token };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

// Send message via GHL API
async function sendGhlMessage(
  accessToken: string,
  locationId: string,
  contactId: string,
  message: string,
  useTemplate: boolean
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const endpoint = `https://services.leadconnectorhq.com/conversations/messages`;

    const body: any = {
      type: "SMS",
      contactId: contactId,
      message: message,
    };

    // If template needed, format as WhatsApp template
    if (useTemplate) {
      body.type = "WhatsApp";
      // Note: Template formatting may need adjustment based on GHL API requirements
    }

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "Version": "2021-07-28"
      },
      body: JSON.stringify(body)
    });

    if (!response.ok) {
      const errorText = await response.text();
      return { success: false, error: `GHL API error: ${response.status} - ${errorText}` };
    }

    const result = await response.json();
    return { success: true, messageId: result.messageId || result.id };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
