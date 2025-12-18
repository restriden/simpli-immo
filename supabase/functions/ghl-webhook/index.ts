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
    console.log("=== GHL WEBHOOK RECEIVED ===");
    console.log("Event type:", payload.type);
    console.log("Location ID:", payload.locationId);
    console.log("Payload:", JSON.stringify(payload, null, 2));

    const { type, locationId } = payload;

    // Handle test/validation webhooks from GHL (no locationId)
    if (!locationId) {
      console.log("No locationId - likely a test/validation webhook");
      return jsonResponse({ success: true, message: "Webhook received" }, 200);
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

      case "TaskCreate":
      case "TaskUpdate":
      case "TaskComplete":
      case "TaskDelete":
        await handleTask(supabase, connection, payload);
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
  console.log("Full payload:", JSON.stringify(payload, null, 2));

  // GHL webhook payload can have different structures
  // Try to extract contactId from various possible locations
  const contactId = payload.contactId || payload.contact_id || payload.contact?.id;
  const conversationId = payload.conversationId || payload.conversation_id;

  // Message content can be in different places
  const messageBody = payload.body || payload.message?.body || payload.message?.text ||
                      payload.text || payload.messageBody || payload.content || "";

  // Message ID
  const messageId = payload.messageId || payload.message_id || payload.id ||
                    payload.message?.id || `webhook_${Date.now()}`;

  // Direction - GHL uses "inbound"/"outbound" or type contains it
  const isInbound = payload.direction === "inbound" ||
                    payload.type === "InboundMessage" ||
                    payload.direction === "incoming";

  console.log("Extracted - contactId:", contactId, "messageBody:", messageBody?.substring(0, 50));

  if (!contactId) {
    console.error("Missing contactId in payload. Available keys:", Object.keys(payload));
    return;
  }

  if (!messageBody) {
    console.error("Missing message body in payload");
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
    console.log("Lead not found for contact:", contactId, "Error:", leadError?.message);
    // Optionally create the lead here
    return;
  }

  console.log("Found lead:", lead.id);

  // Create message record
  const messageData = {
    user_id: connection.user_id,
    lead_id: lead.id,
    ghl_message_id: messageId,
    ghl_conversation_id: conversationId,
    content: messageBody,
    type: isInbound ? "incoming" : "outgoing",
    is_template: false,
    ghl_data: payload,
    created_at: payload.dateAdded || payload.createdAt || payload.timestamp || new Date().toISOString(),
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

  // Process messages with AI
  if (isInbound) {
    // INCOMING: Analyze + potentially auto-respond (combined in one function)
    try {
      // Get the inserted message ID for updating with analysis
      const { data: insertedMsg } = await supabase
        .from("messages")
        .select("id")
        .eq("ghl_message_id", messageData.ghl_message_id)
        .single();

      const handlerUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/message-handler`;
      const handlerResponse = await fetch(handlerUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          message_id: insertedMsg?.id,
          message_content: messageBody,
          lead_id: lead.id,
          user_id: connection.user_id,
        }),
      });

      if (handlerResponse.ok) {
        const result = await handlerResponse.json();
        console.log("Message handler result:", result);
        if (result.response_sent) {
          console.log("Auto-response was sent");
        }
        if (result.created_task) {
          console.log("Task created:", result.created_task.id);
        }
      } else {
        console.error("Message handler failed:", await handlerResponse.text());
      }
    } catch (handlerError) {
      console.error("Error calling message-handler:", handlerError);
    }
  } else {
    // OUTGOING: Learn from Makler responses
    try {
      const learnUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/learn-response`;
      const learnResponse = await fetch(learnUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          response_content: messageBody,
          lead_id: lead.id,
          user_id: connection.user_id,
        }),
      });

      if (learnResponse.ok) {
        const result = await learnResponse.json();
        if (result.learned) {
          console.log("Learned new knowledge:", result.question, "->", result.answer);
        }
      }
    } catch (learnError) {
      console.error("Error calling learn-response:", learnError);
    }
  }
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
    .select("id, objekt_id")
    .eq("ghl_contact_id", contact.id)
    .single();

  let leadId: string;

  if (existing) {
    // Update existing lead
    const { error } = await supabase
      .from("leads")
      .update(leadData)
      .eq("id", existing.id);

    if (error) {
      console.error("Error updating lead:", error);
      return;
    }
    leadId = existing.id;
    console.log("Lead updated:", existing.id);
  } else {
    // Create new lead
    const { data: newLead, error } = await supabase
      .from("leads")
      .insert(leadData)
      .select("id")
      .single();

    if (error || !newLead) {
      console.error("Error creating lead:", error);
      return;
    }
    leadId = newLead.id;
    console.log("Lead created for contact:", contact.id);
  }

  // Auto-assign lead to objekt based on contact custom fields
  // Only if lead doesn't already have an objekt assigned
  if (!existing?.objekt_id) {
    try {
      const matcherUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/objekt-matcher`;
      const matchResponse = await fetch(matcherUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
        },
        body: JSON.stringify({
          action: "match",
          contact_data: contact,
          user_id: connection.user_id,
          lead_id: leadId,
        }),
      });

      if (matchResponse.ok) {
        const matchResult = await matchResponse.json();
        if (matchResult.action === 'matched') {
          console.log(`Auto-assigned lead to existing objekt: ${matchResult.objekt_name}`);
        } else if (matchResult.action === 'created') {
          console.log(`Created new objekt and assigned lead: ${matchResult.objekt_name}`);
        } else {
          console.log("No objekt field found in contact data");
        }
      }
    } catch (matchError) {
      console.error("Error calling objekt-matcher:", matchError);
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

async function handleTask(supabase: any, connection: any, payload: any) {
  console.log("=== HANDLING TASK ===");
  console.log("Full payload:", JSON.stringify(payload, null, 2));

  const task = payload.task || payload;
  const taskId = task.id || payload.taskId;

  if (!taskId) {
    console.error("No task ID in payload");
    return;
  }

  // Handle task deletion
  if (payload.type === "TaskDelete") {
    const { error } = await supabase
      .from("todos")
      .delete()
      .eq("ghl_task_id", taskId);

    if (error) {
      console.error("Error deleting todo:", error);
    } else {
      console.log("Todo deleted for task:", taskId);
    }
    return;
  }

  // Find lead if contact is associated
  let leadId = null;
  const contactId = task.contactId || task.contact_id || payload.contactId;
  if (contactId) {
    const { data: lead } = await supabase
      .from("leads")
      .select("id")
      .eq("ghl_contact_id", contactId)
      .eq("user_id", connection.user_id)
      .single();
    leadId = lead?.id;
  }

  // Determine priority based on task data
  let priority = "normal";
  if (task.priority === "high" || task.priority === "urgent") {
    priority = "dringend";
  }

  // Determine type based on task title or type
  // Allowed values: nachricht, anruf, besichtigung, finanzierung, dokument
  let todoType = "nachricht"; // Default fallback
  const title = (task.title || task.name || "Aufgabe").toLowerCase();
  if (title.includes("anruf") || title.includes("call") || title.includes("phone")) {
    todoType = "anruf";
  } else if (title.includes("besichtigung") || title.includes("termin") || title.includes("viewing")) {
    todoType = "besichtigung";
  } else if (title.includes("finanzierung") || title.includes("financing")) {
    todoType = "finanzierung";
  } else if (title.includes("dokument") || title.includes("document") || title.includes("unterlagen")) {
    todoType = "dokument";
  } else if (title.includes("nachricht") || title.includes("message")) {
    todoType = "nachricht";
  }

  const isCompleted = payload.type === "TaskComplete" ||
                      task.status === "completed" ||
                      task.completed === true;

  const todoData = {
    user_id: connection.user_id,
    lead_id: leadId,
    ghl_task_id: taskId,
    type: todoType,
    priority: priority,
    title: stripHtml(task.title || task.name) || "Aufgabe",
    subtitle: stripHtml(task.description || task.body || task.notes),
    completed: isCompleted,
    due_date: task.dueDate || task.due_date || null,
    ghl_data: payload,
  };

  // Check if todo exists
  const { data: existing } = await supabase
    .from("todos")
    .select("id")
    .eq("ghl_task_id", taskId)
    .single();

  if (existing) {
    // Update existing todo
    const { error } = await supabase
      .from("todos")
      .update(todoData)
      .eq("id", existing.id);

    if (error) {
      console.error("Error updating todo:", error);
    } else {
      console.log("Todo updated:", existing.id);
    }
  } else if (!isCompleted) {
    // Only create new todo if not already completed
    const { data: newTodo, error } = await supabase
      .from("todos")
      .insert(todoData)
      .select()
      .single();

    if (error) {
      console.error("Error creating todo:", error);
    } else {
      console.log("Todo created:", newTodo?.id);
    }
  }
}

function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  return html
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .trim() || null;
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
