import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface SendMessageRequest {
  user_id: string;
  lead_id: string;
  message: string;
  type?: "SMS" | "WhatsApp" | "Email";
}

/**
 * Send a message via GHL API
 * This allows the app to send messages that appear in GHL conversations
 */
serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Validate authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    // Parse request body
    const body: SendMessageRequest = await req.json();
    const { user_id, lead_id, message, type = "SMS" } = body;

    console.log("=== SEND MESSAGE REQUEST ===");
    console.log("User ID:", user_id);
    console.log("Lead ID:", lead_id);
    console.log("Message type:", type);

    if (!user_id || !lead_id || !message) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    // Get the GHL connection for this user
    const { data: connection, error: connError } = await supabase
      .from("ghl_connections")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .single();

    if (connError || !connection) {
      return jsonResponse({ error: "No active GHL connection" }, 404);
    }

    // Get the lead to find the GHL contact ID
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("ghl_contact_id, phone, email")
      .eq("id", lead_id)
      .single();

    if (leadError || !lead) {
      return jsonResponse({ error: "Lead not found" }, 404);
    }

    if (!lead.ghl_contact_id) {
      return jsonResponse({ error: "Lead has no GHL contact ID" }, 400);
    }

    console.log("GHL Contact ID:", lead.ghl_contact_id);

    // Prepare GHL API headers
    const headers = {
      Authorization: `Bearer ${connection.access_token}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
    };

    // Determine the message type and endpoint
    let sendResult;

    if (type === "SMS" || type === "WhatsApp") {
      // Send SMS/WhatsApp message via conversations API
      sendResult = await sendConversationMessage(
        headers,
        connection.location_id,
        lead.ghl_contact_id,
        message,
        type
      );
    } else if (type === "Email") {
      // Send email (requires email in lead)
      if (!lead.email) {
        return jsonResponse({ error: "Lead has no email address" }, 400);
      }
      sendResult = await sendEmailMessage(
        headers,
        connection.location_id,
        lead.ghl_contact_id,
        lead.email,
        message
      );
    }

    if (!sendResult.success) {
      console.error("Failed to send message:", sendResult.error);
      return jsonResponse({ error: sendResult.error }, 500);
    }

    console.log("Message sent successfully, GHL message ID:", sendResult.messageId);

    // Save message to local database
    const messageData = {
      user_id,
      lead_id,
      ghl_message_id: sendResult.messageId || `local_${Date.now()}`,
      ghl_conversation_id: sendResult.conversationId || null,
      content: message,
      type: "outgoing",
      is_template: false,
      ghl_data: sendResult.data || null,
      created_at: new Date().toISOString(),
    };

    const { data: savedMessage, error: saveError } = await supabase
      .from("messages")
      .insert(messageData)
      .select()
      .single();

    if (saveError) {
      console.error("Error saving message locally:", saveError);
      // Message was sent to GHL, just failed to save locally
    }

    // Update lead's last_message_at
    await supabase
      .from("leads")
      .update({
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq("id", lead_id);

    return jsonResponse({
      success: true,
      message_id: savedMessage?.id || sendResult.messageId,
      ghl_message_id: sendResult.messageId,
    });
  } catch (err) {
    console.error("Send message error:", err);
    return jsonResponse({ error: err.message || "Internal error" }, 500);
  }
});

async function sendConversationMessage(
  headers: Record<string, string>,
  locationId: string,
  contactId: string,
  message: string,
  type: "SMS" | "WhatsApp"
): Promise<{ success: boolean; messageId?: string; conversationId?: string; data?: any; error?: string }> {
  try {
    // GHL API v2: Send message directly via /conversations/messages
    // The API will create or use existing conversation automatically
    const sendUrl = `${GHL_API_BASE}/conversations/messages`;

    const messagePayload = {
      type: type, // "SMS" or "WhatsApp"
      contactId: contactId,
      message: message,
    };

    console.log("Sending message to:", sendUrl);
    console.log("Payload:", JSON.stringify(messagePayload));

    const sendResponse = await fetch(sendUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(messagePayload),
    });

    const responseText = await sendResponse.text();
    console.log("GHL response status:", sendResponse.status);
    console.log("GHL response body:", responseText);

    if (!sendResponse.ok) {
      console.error("GHL send message error:", sendResponse.status, responseText);

      // Try to parse error for more details
      try {
        const errorData = JSON.parse(responseText);
        return { success: false, error: errorData.message || errorData.error || `GHL API error: ${sendResponse.status}` };
      } catch {
        return { success: false, error: `GHL API error: ${sendResponse.status} - ${responseText}` };
      }
    }

    const result = JSON.parse(responseText);
    console.log("GHL send result:", result);

    return {
      success: true,
      messageId: result.messageId || result.id,
      conversationId: result.conversationId,
      data: result,
    };
  } catch (err) {
    console.error("Send conversation message error:", err);
    return { success: false, error: err.message };
  }
}

async function sendEmailMessage(
  headers: Record<string, string>,
  locationId: string,
  contactId: string,
  email: string,
  message: string
): Promise<{ success: boolean; messageId?: string; error?: string }> {
  try {
    const sendUrl = `${GHL_API_BASE}/conversations/messages`;

    const emailPayload = {
      type: "Email",
      contactId,
      message,
      emailTo: email,
      subject: "Nachricht von Simpli.Immo",
    };

    const sendResponse = await fetch(sendUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(emailPayload),
    });

    if (!sendResponse.ok) {
      const errorText = await sendResponse.text();
      console.error("GHL send email error:", sendResponse.status, errorText);
      return { success: false, error: `GHL API error: ${sendResponse.status}` };
    }

    const result = await sendResponse.json();

    return {
      success: true,
      messageId: result.messageId || result.id,
    };
  } catch (err) {
    console.error("Send email error:", err);
    return { success: false, error: err.message };
  }
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
