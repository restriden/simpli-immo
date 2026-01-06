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
          name,
          ghl_contact_id,
          ghl_location_id,
          email,
          last_message_at,
          followup_1_sent_at,
          followup_2_sent_at
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

        // 5. Get form_type (du/Sie) for this location
        const { data: whitelist } = await supabase
          .from("ghl_whitelist_subaccounts")
          .select("form_type")
          .eq("location_id", lead.ghl_location_id)
          .single();

        const formType = whitelist?.form_type || 'sie';

        // 6. Calculate if template is needed based on last INCOMING message (24h window)
        const rawMessage = followup.final_message || followup.suggested_message;
        const needsTemplate = await checkIfTemplateNeeded(lead.id, supabase);

        // 7. Format message with proper salutation
        const message = formatMessageWithSalutation(rawMessage, lead, formType, needsTemplate);

        // 8. Send the message - use different method based on template need
        let sendResult;

        if (needsTemplate) {
          // Template needed: Update simplios_message field, GHL workflow will send template
          console.log(`[SendScheduledFollowups] Template needed, updating simplios_message field...`);
          sendResult = await updateContactFieldForTemplate(
            lead.ghl_location_id,
            lead.id,  // Use lead.id (our DB ID), not ghl_contact_id
            message
          );
        } else {
          // Within 24h window: Send directly via conversations API
          console.log(`[SendScheduledFollowups] Within 24h window, sending directly...`);
          sendResult = await sendGhlMessage(
            accessToken,
            lead.ghl_location_id,
            lead.ghl_contact_id,
            message
          );
        }

        if (!sendResult.success) {
          console.log(`[SendScheduledFollowups] Failed to send ${followup.id}: ${sendResult.error}`);
          results.push({ id: followup.id, status: "failed", reason: sendResult.error });
          continue;
        }

        // 7. Mark as sent
        const sentAt = new Date().toISOString();
        const { error: updateError } = await supabase
          .from("followup_approvals")
          .update({
            status: "sent",
            sent_at: sentAt,
            updated_at: sentAt
          })
          .eq("id", followup.id);

        if (updateError) {
          console.error(`[SendScheduledFollowups] Error updating approval status: ${updateError.message}`);
        } else {
          console.log(`[SendScheduledFollowups] Updated approval ${followup.id} to sent`);
        }

        // 8. Store the message in our messages table
        const { error: msgError } = await supabase.from("messages").insert({
          lead_id: lead.id,
          ghl_message_id: sendResult.messageId,
          content: needsTemplate ? `[Template] ${message}` : message,
          type: "outgoing",
          is_template: needsTemplate,
          delivery_status: needsTemplate ? "pending" : "sent",
          created_at: sentAt
        });

        if (msgError) {
          console.error(`[SendScheduledFollowups] Error inserting message: ${msgError.message}`);
        }

        // 9. Update leads table with followup sent timestamp
        const followUpNumber = followup.follow_up_number || 1;
        const leadUpdate: any = {};
        if (followUpNumber === 1 && !lead.followup_1_sent_at) {
          leadUpdate.followup_1_sent_at = sentAt;
          leadUpdate.followup_1_approved_id = followup.id;
        } else if (followUpNumber === 2 && !lead.followup_2_sent_at) {
          leadUpdate.followup_2_sent_at = sentAt;
          leadUpdate.followup_2_approved_id = followup.id;
        } else if (!lead.followup_1_sent_at) {
          // Fallback: if no followup_1 yet, use that
          leadUpdate.followup_1_sent_at = sentAt;
          leadUpdate.followup_1_approved_id = followup.id;
        }

        if (Object.keys(leadUpdate).length > 0) {
          await supabase
            .from("leads")
            .update(leadUpdate)
            .eq("id", lead.id);
          console.log(`[SendScheduledFollowups] Updated lead ${lead.id} with followup_${followUpNumber}_sent_at`);
        }

        // 10. Update followup_prompt_performance for tracking
        if (followup.prompt_version_id) {
          const periodDate = today;

          // Try to get existing performance record for today
          const { data: existingPerf } = await supabase
            .from("followup_prompt_performance")
            .select("id, total_sent")
            .eq("prompt_version_id", followup.prompt_version_id)
            .eq("period_date", periodDate)
            .single();

          if (existingPerf) {
            // Update existing record
            await supabase
              .from("followup_prompt_performance")
              .update({
                total_sent: (existingPerf.total_sent || 0) + 1,
                updated_at: sentAt
              })
              .eq("id", existingPerf.id);
          } else {
            // Create new record for today
            await supabase
              .from("followup_prompt_performance")
              .insert({
                prompt_version_id: followup.prompt_version_id,
                period_date: periodDate,
                total_sent: 1,
                total_approved: 0,
                total_rejected: 0
              });
          }
          console.log(`[SendScheduledFollowups] Updated performance tracking for prompt ${followup.prompt_version_id}`);
        }

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
// IMPORTANT: The 24h window is based on the last INCOMING message from the customer,
// NOT the last message overall (which could be outgoing from us)
async function checkIfTemplateNeeded(leadId: string, supabase: any): Promise<boolean> {
  // Get the last incoming message for this lead
  const { data: lastIncoming, error } = await supabase
    .from("messages")
    .select("created_at")
    .eq("lead_id", leadId)
    .eq("type", "incoming")
    .order("created_at", { ascending: false })
    .limit(1)
    .single();

  if (error || !lastIncoming) {
    console.log(`[SendScheduledFollowups] No incoming messages found for lead ${leadId} - template needed`);
    return true; // No incoming messages = need template
  }

  const lastIncomingTime = new Date(lastIncoming.created_at).getTime();
  const now = Date.now();
  const hoursSinceLastIncoming = (now - lastIncomingTime) / (1000 * 60 * 60);

  console.log(`[SendScheduledFollowups] Last incoming message: ${lastIncoming.created_at}, hours ago: ${hoursSinceLastIncoming.toFixed(1)}`);

  return hoursSinceLastIncoming > 24;
}

// Format message based on whether template is needed
// TEMPLATE RULES (via Custom Field / GHL Workflow):
// 1. NO "Hallo" at the beginning
// 2. NO farewell/closing at the end
// 3. NO line breaks/paragraphs (causes WhatsApp rejection)
//
// DIRECT MESSAGE (within 24h window):
// - Can have greeting and closing
function formatMessageWithSalutation(
  message: string,
  lead: any,
  formType: string,
  needsTemplate: boolean
): string {
  const trimmedMessage = message.trim();

  if (needsTemplate) {
    // TEMPLATE: Clean message - no greeting, no closing, no line breaks
    let cleanMessage = trimmedMessage;

    // Remove "Hallo " or similar greetings at the start
    cleanMessage = cleanMessage.replace(/^(hallo|hi|hey|guten\s*tag|liebe[rs]?|moin)\s*/i, '');

    // Remove closing phrases at the end
    cleanMessage = cleanMessage.replace(/\s*(viele\s*)?grüße!?\s*$/i, '');
    cleanMessage = cleanMessage.replace(/\s*liebe\s*grüße!?\s*$/i, '');
    cleanMessage = cleanMessage.replace(/\s*mit\s*freundlichen\s*grüßen!?\s*$/i, '');
    cleanMessage = cleanMessage.replace(/\s*mfg!?\s*$/i, '');

    // Remove all line breaks (replace with space)
    cleanMessage = cleanMessage.replace(/[\r\n]+/g, ' ');

    // Clean up multiple spaces
    cleanMessage = cleanMessage.replace(/\s+/g, ' ').trim();

    console.log(`[SendScheduledFollowups] Template message formatted: "${cleanMessage}"`);
    return cleanMessage;
  }

  // DIRECT MESSAGE (within 24h window): Add greeting and closing
  const greeting = 'Hallo ';
  const closing = '\n\nViele Grüße!';

  // Check if message already has greeting
  const hasGreeting = /^(hallo|hi|hey|guten|liebe|moin)/i.test(trimmedMessage);
  if (hasGreeting) {
    // Already has greeting, just ensure closing
    if (!/grüße|gruesse/i.test(trimmedMessage)) {
      return trimmedMessage + closing;
    }
    return trimmedMessage;
  }

  return greeting + trimmedMessage + closing;
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

// Send message directly via GHL API (within 24h window)
async function sendGhlMessage(
  accessToken: string,
  locationId: string,
  contactId: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const endpoint = `https://services.leadconnectorhq.com/conversations/messages`;

    const body: any = {
      type: "WhatsApp",
      contactId: contactId,
      message: message,
    };

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

// Update contact's simplios_message field via ghl-update-contact-field Edge Function
// This triggers the GHL workflow to send the WhatsApp template
const TEMPLATE_FIELD_KEY = "simplios_message";

async function updateContactFieldForTemplate(
  locationId: string,
  leadId: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    // Call the existing ghl-update-contact-field Edge Function
    // This is the same function SimpliOS Inbox uses
    const endpoint = `${SUPABASE_URL}/functions/v1/ghl-update-contact-field`;

    console.log(`[SendScheduledFollowups] Calling ghl-update-contact-field for lead ${leadId}...`);

    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        location_id: locationId,
        lead_id: leadId,
        field_key: TEMPLATE_FIELD_KEY,
        field_value: message,
        clear_first: true
      })
    });

    const responseText = await response.text();
    console.log(`[SendScheduledFollowups] ghl-update-contact-field response:`, response.status, responseText);

    if (!response.ok) {
      return { success: false, error: `Update field error: ${response.status} - ${responseText}` };
    }

    const result = JSON.parse(responseText);
    if (!result.success) {
      return { success: false, error: result.error || "Unknown error" };
    }

    console.log(`[SendScheduledFollowups] Field updated, GHL workflow will send template`);

    // Return success - the messageId will be generated by GHL workflow
    return { success: true, messageId: `template_${Date.now()}` };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
