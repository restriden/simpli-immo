import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * GHL Webhook Handler
 * Receives webhooks from GoHighLevel for:
 * - InboundMessage: New incoming message
 * - OutboundMessage: Message sent from GHL
 * - ContactCreate: New contact created
 * - ContactUpdate: Contact updated
 * - AppointmentCreate: New appointment
 */
serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse webhook payload
    const payload = await req.json();
    console.log("=== GHL WEBHOOK RECEIVED ===");
    console.log("Event type:", payload.type);
    console.log("Location ID:", payload.locationId);
    console.log("Payload:", JSON.stringify(payload, null, 2));

    const { type, locationId } = payload;

    if (!locationId) {
      console.error("No locationId in webhook payload");
      return jsonResponse({ error: "Missing locationId" }, 400);
    }

    // Find the connection for this location
    const { data: connection, error: connError } = await supabase
      .from("ghl_connections")
      .select("id, user_id")
      .eq("location_id", locationId)
      .eq("is_active", true)
      .single();

    if (connError || !connection) {
      console.error("No active connection for location:", locationId);
      return jsonResponse({ error: "No connection found" }, 404);
    }

    console.log("Found connection for user:", connection.user_id);

    // Handle different webhook types
    switch (type) {
      case "InboundMessage":
      case "OutboundMessage":
        await handleMessage(supabase, connection, payload);
        break;

      case "ContactCreate":
      case "ContactUpdate":
        await handleContact(supabase, connection, payload);
        break;

      case "AppointmentCreate":
      case "AppointmentUpdate":
        await handleAppointment(supabase, connection, payload);
        break;

      default:
        console.log("Unhandled webhook type:", type);
    }

    // Log the webhook
    await supabase.from("ghl_sync_logs").insert({
      connection_id: connection.id,
      sync_type: "webhook",
      status: "success",
      message: `Webhook received: ${type}`,
      metadata: { type, locationId, timestamp: new Date().toISOString() },
    });

    return jsonResponse({ success: true, type });
  } catch (err) {
    console.error("Webhook error:", err);
    return jsonResponse({ error: err.message || "Internal error" }, 500);
  }
});

async function handleMessage(supabase: any, connection: any, payload: any) {
  console.log("=== HANDLING MESSAGE ===");

  const { contactId, conversationId, message, direction, messageType } = payload;

  if (!contactId || !message) {
    console.error("Missing contactId or message in payload");
    return;
  }

  // Find the lead for this contact
  const { data: lead, error: leadError } = await supabase
    .from("leads")
    .select("id")
    .eq("ghl_contact_id", contactId)
    .eq("user_id", connection.user_id)
    .single();

  if (leadError || !lead) {
    console.log("Lead not found for contact:", contactId);
    // Optionally create the lead here
    return;
  }

  // Create message record
  const messageData = {
    user_id: connection.user_id,
    lead_id: lead.id,
    ghl_message_id: message.id || `webhook_${Date.now()}`,
    ghl_conversation_id: conversationId,
    content: message.body || message.text || "",
    type: direction === "inbound" ? "incoming" : "outgoing",
    is_template: false,
    ghl_data: payload,
    created_at: message.dateAdded || new Date().toISOString(),
  };

  console.log("Inserting message:", messageData.ghl_message_id);

  // Check if message already exists
  const { data: existing } = await supabase
    .from("messages")
    .select("id")
    .eq("ghl_message_id", messageData.ghl_message_id)
    .single();

  if (existing) {
    console.log("Message already exists, skipping");
    return;
  }

  const { error: insertError } = await supabase.from("messages").insert(messageData);

  if (insertError) {
    console.error("Error inserting message:", insertError);
    return;
  }

  console.log("Message inserted successfully");

  // Update lead's last_message_at
  await supabase
    .from("leads")
    .update({
      last_message_at: messageData.created_at,
      updated_at: new Date().toISOString(),
    })
    .eq("id", lead.id);
}

async function handleContact(supabase: any, connection: any, payload: any) {
  console.log("=== HANDLING CONTACT ===");

  const contact = payload.contact || payload;

  if (!contact.id) {
    console.error("No contact ID in payload");
    return;
  }

  const leadData = {
    user_id: connection.user_id,
    ghl_contact_id: contact.id,
    ghl_location_id: payload.locationId,
    name: `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "Unbekannt",
    email: contact.email || null,
    phone: contact.phone || null,
    status: "neu",
    source: "extern" as const,
    ghl_data: contact,
    updated_at: new Date().toISOString(),
  };

  // Check if lead exists
  const { data: existing } = await supabase
    .from("leads")
    .select("id")
    .eq("ghl_contact_id", contact.id)
    .single();

  if (existing) {
    // Update existing lead
    const { error } = await supabase
      .from("leads")
      .update(leadData)
      .eq("id", existing.id);

    if (error) {
      console.error("Error updating lead:", error);
    } else {
      console.log("Lead updated:", existing.id);
    }
  } else {
    // Create new lead
    const { error } = await supabase.from("leads").insert(leadData);

    if (error) {
      console.error("Error creating lead:", error);
    } else {
      console.log("Lead created for contact:", contact.id);
    }
  }
}

async function handleAppointment(supabase: any, connection: any, payload: any) {
  console.log("=== HANDLING APPOINTMENT ===");

  const event = payload.appointment || payload;

  if (!event.id) {
    console.error("No event ID in payload");
    return;
  }

  // Find lead if contact is associated
  let leadId = null;
  if (event.contactId) {
    const { data: lead } = await supabase
      .from("leads")
      .select("id")
      .eq("ghl_contact_id", event.contactId)
      .single();
    leadId = lead?.id;
  }

  const todoData = {
    user_id: connection.user_id,
    lead_id: leadId,
    ghl_event_id: event.id,
    type: "besichtigung",
    priority: "normal",
    title: event.title || "Termin",
    subtitle: event.notes || null,
    completed: event.status === "completed",
    due_date: event.startTime,
    ghl_data: event,
  };

  // Check if todo exists
  const { data: existing } = await supabase
    .from("todos")
    .select("id")
    .eq("ghl_event_id", event.id)
    .single();

  if (existing) {
    const { error } = await supabase
      .from("todos")
      .update(todoData)
      .eq("id", existing.id);

    if (error) {
      console.error("Error updating todo:", error);
    }
  } else {
    const { error } = await supabase.from("todos").insert(todoData);

    if (error) {
      console.error("Error creating todo:", error);
    }
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
