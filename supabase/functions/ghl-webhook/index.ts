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
      case "MessageStatusUpdate":
      case "ConversationUnreadUpdate":
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

  // === DELIVERY STATUS TRACKING ===
  // Extract status from GHL payload
  const ghlStatus = payload.status || payload.messageStatus || payload.deliveryStatus || "";
  const ghlError = payload.error || payload.errorMessage || payload.failureReason ||
                   payload.meta?.error || payload.message?.error || "";

  // Map GHL status to our delivery_status
  let deliveryStatus = "pending";
  let errorMessage = null;

  if (ghlStatus) {
    const statusLower = ghlStatus.toLowerCase();
    // "completed" = message was successfully sent/delivered in GHL
    if (statusLower === "delivered" || statusLower === "read" || statusLower === "sent" || statusLower === "completed") {
      deliveryStatus = statusLower === "read" ? "read" : "delivered";
    } else if (statusLower === "failed" || statusLower === "undelivered" || statusLower === "error") {
      deliveryStatus = "failed";
      errorMessage = ghlError || "Nachricht konnte nicht zugestellt werden";

      // Check for 24h window error
      if (ghlError.toLowerCase().includes("24") ||
          ghlError.toLowerCase().includes("window") ||
          ghlError.toLowerCase().includes("session") ||
          ghlError.toLowerCase().includes("template")) {
        errorMessage = "WhatsApp 24-Stunden-Fenster geschlossen. Der Kontakt muss zuerst antworten.";
      }
    } else if (statusLower === "pending" || statusLower === "queued" || statusLower === "sending") {
      deliveryStatus = "pending";
    }
  } else if (!isInbound) {
    // Outbound without status = assume sent
    deliveryStatus = "sent";
  } else {
    // Inbound messages are always delivered
    deliveryStatus = "delivered";
  }

  console.log("Extracted - contactId:", contactId, "messageBody:", messageBody?.substring(0, 50));
  console.log("Delivery status:", deliveryStatus, "Error:", errorMessage);

  if (!contactId) {
    console.error("Missing contactId in payload. Available keys:", Object.keys(payload));
    return;
  }

  // Allow status updates for messages without body (pure status webhook)
  if (!messageBody && !ghlStatus) {
    console.error("Missing message body and status in payload");
    return;
  }

  // Find the lead for this contact
  // Use ghl_location_id instead of user_id to support SimpliOS mode (where user_id is NULL)
  let leadQuery = supabase
    .from("leads")
    .select("id")
    .eq("ghl_contact_id", contactId);

  // In SimpliOS mode, user_id is NULL - use location_id instead
  if (connection.user_id) {
    leadQuery = leadQuery.eq("user_id", connection.user_id);
  } else {
    // SimpliOS mode: find by location
    leadQuery = leadQuery.eq("ghl_location_id", payload.locationId);
  }

  const { data: lead, error: leadError } = await leadQuery.single();

  if (leadError || !lead) {
    console.log("Lead not found for contact:", contactId, "Error:", leadError?.message);
    // Optionally create the lead here
    return;
  }

  console.log("Found lead:", lead.id);

  // Create message record
  const messageData: any = {
    user_id: connection.user_id,
    lead_id: lead.id,
    ghl_message_id: messageId,
    ghl_conversation_id: conversationId,
    content: messageBody,
    type: isInbound ? "incoming" : "outgoing",
    is_template: false,
    ghl_data: payload,
    created_at: payload.dateAdded || payload.createdAt || payload.timestamp || new Date().toISOString(),
    delivery_status: deliveryStatus,
    error_message: errorMessage,
    updated_at: new Date().toISOString(),
  };

  console.log("Processing message:", messageData.ghl_message_id, "Status:", deliveryStatus);

  // Check if message already exists
  const { data: existing } = await supabase
    .from("messages")
    .select("id, delivery_status")
    .eq("ghl_message_id", messageData.ghl_message_id)
    .single();

  if (existing) {
    // Message exists - update delivery status if changed
    console.log("Message exists, updating status from", existing.delivery_status, "to", deliveryStatus);

    const updateData: any = {
      delivery_status: deliveryStatus,
      updated_at: new Date().toISOString(),
      ghl_data: payload, // Update with latest payload
    };

    if (errorMessage) {
      updateData.error_message = errorMessage;
    }

    const { error: updateError } = await supabase
      .from("messages")
      .update(updateData)
      .eq("id", existing.id);

    if (updateError) {
      console.error("Error updating message status:", updateError);
    } else {
      console.log("Message status updated to:", deliveryStatus);
    }
    return;
  }

  // New message - insert
  const { error: insertError } = await supabase.from("messages").insert(messageData);

  if (insertError) {
    console.error("Error inserting message:", insertError);
    return;
  }

  console.log("Message inserted successfully with status:", deliveryStatus);

  // Update lead's last_message_at
  await supabase
    .from("leads")
    .update({
      last_message_at: messageData.created_at,
      updated_at: new Date().toISOString(),
    })
    .eq("id", lead.id);

  console.log("Updated lead last_message_at to:", messageData.created_at);

  // === DELETE PENDING FOLLOW-UP APPROVALS ON NEW INCOMING MESSAGE ===
  // When a lead responds, any pending follow-up is no longer relevant
  if (isInbound) {
    const { data: deletedApprovals, error: deleteError } = await supabase
      .from("followup_approvals")
      .delete()
      .eq("lead_id", lead.id)
      .eq("status", "pending")
      .select("id");

    if (deletedApprovals && deletedApprovals.length > 0) {
      console.log(`[Webhook] Deleted ${deletedApprovals.length} pending follow-up approvals for lead ${lead.id} - new incoming message received`);
    }
    if (deleteError) {
      console.error("Error deleting pending follow-ups:", deleteError);
    }
  }

  // === TRIGGER LEAD ANALYSIS IN BACKGROUND ===
  // This updates the lead status, follow-up date, and all analysis fields
  try {
    const analyzeUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/sync-analyze-leads`;
    fetch(analyzeUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        lead_id: lead.id,
      }),
    }).then(async (res) => {
      if (res.ok) {
        const result = await res.json();
        console.log("Lead analysis triggered:", result.success ? "success" : "skipped", result.quality_score || "");
      } else {
        console.error("Lead analysis failed:", await res.text());
      }
    }).catch(err => console.error("Lead analysis error:", err));
  } catch (analyzeError) {
    console.error("Error triggering lead analysis:", analyzeError);
  }

  // === TRIGGER FOLLOW-UP RE-GENERATION IN BACKGROUND ===
  // This generates a new follow-up suggestion based on the updated conversation
  // The generate-followup function will check if a follow-up is needed
  try {
    const followupUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/generate-followup`;
    fetch(followupUrl, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
      },
      body: JSON.stringify({
        lead_id: lead.id,
      }),
    }).then(async (res) => {
      if (res.ok) {
        const result = await res.json();
        if (result.no_follow_up) {
          console.log("Follow-up not needed:", result.no_follow_up_reason);
        } else if (result.success) {
          console.log("Follow-up generated, FU#:", result.follow_up_number);
        }
      } else {
        console.error("Follow-up generation failed:", await res.text());
      }
    }).catch(err => console.error("Follow-up generation error:", err));
  } catch (followupError) {
    console.error("Error triggering follow-up generation:", followupError);
  }

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
  console.log("Checking objekt assignment - existing?.objekt_id:", existing?.objekt_id);
  console.log("Contact customFields:", JSON.stringify(contact.customFields || contact.customField || 'none'));

  if (!existing?.objekt_id) {
    console.log("No existing objekt_id, calling objekt-matcher...");
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

      const matchResultText = await matchResponse.text();
      console.log("Objekt-matcher response status:", matchResponse.status);
      console.log("Objekt-matcher response:", matchResultText);

      if (matchResponse.ok) {
        const matchResult = JSON.parse(matchResultText);
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

// Simpli Finance Location ID - used for Eva KPI tracking
const SIMPLI_FINANCE_LOCATION_ID = "iDLo7b4WOOCkE9voshIM";

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.toLowerCase().trim();
}

async function handleAppointment(supabase: any, connection: any, payload: any) {
  console.log("=== HANDLING APPOINTMENT ===");

  const event = payload.appointment || payload;
  const locationId = payload.locationId;

  if (!event.id) {
    console.error("No event ID in payload");
    return;
  }

  console.log("Appointment location:", locationId, "SF location:", SIMPLI_FINANCE_LOCATION_ID);

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

  // === EVA KPI TRACKING ===
  // If this appointment is from Simpli Finance, track it for the Eva KPI board
  if (locationId === SIMPLI_FINANCE_LOCATION_ID && event.contactId) {
    console.log("SF Appointment detected - tracking for Eva KPI");

    try {
      // Fetch contact details from SF GHL to get email/phone
      const sfConnection = await supabase
        .from("ghl_connections")
        .select("access_token")
        .eq("location_id", SIMPLI_FINANCE_LOCATION_ID)
        .eq("is_active", true)
        .single();

      if (sfConnection.data?.access_token) {
        const contactUrl = `https://services.leadconnectorhq.com/contacts/${event.contactId}`;
        const contactRes = await fetch(contactUrl, {
          headers: {
            "Authorization": `Bearer ${sfConnection.data.access_token}`,
            "Version": "2021-07-28",
          }
        });

        if (contactRes.ok) {
          const contactData = await contactRes.json();
          const contact = contactData.contact || contactData;
          console.log("SF Contact:", contact.email, contact.phone);

          const email = normalizeEmail(contact.email);
          const phone = normalizePhone(contact.phone);

          // Find matching Makler lead by email or phone
          let matchedLead = null;

          if (email) {
            const { data: leadByEmail } = await supabase
              .from("leads")
              .select("id, sf_reached_beratung")
              .ilike("email", email)
              .neq("ghl_location_id", SIMPLI_FINANCE_LOCATION_ID)
              .or("is_archived.is.null,is_archived.eq.false")
              .single();
            matchedLead = leadByEmail;
          }

          if (!matchedLead && phone) {
            // Try phone match - need to match last 10 digits
            const { data: leads } = await supabase
              .from("leads")
              .select("id, phone, sf_reached_beratung")
              .not("phone", "is", null)
              .neq("ghl_location_id", SIMPLI_FINANCE_LOCATION_ID)
              .or("is_archived.is.null,is_archived.eq.false");

            if (leads) {
              for (const lead of leads) {
                if (normalizePhone(lead.phone) === phone) {
                  matchedLead = lead;
                  break;
                }
              }
            }
          }

          if (matchedLead) {
            console.log("Matched lead for Eva KPI:", matchedLead.id);

            // Set sf_reached_beratung = true for Eva KPI tracking
            const { error: updateError } = await supabase
              .from("leads")
              .update({
                sf_reached_beratung: true,
                sf_pipeline_stage: "beratung_gebucht",
                sf_pipeline_updated_at: new Date().toISOString(),
                sf_contact_id: event.contactId,
              })
              .eq("id", matchedLead.id);

            if (updateError) {
              console.error("Error updating lead for Eva KPI:", updateError);
            } else {
              console.log("Lead updated for Eva KPI - sf_reached_beratung = true");
            }
          } else {
            console.log("No matching Makler lead found for SF contact:", email, phone);
          }
        } else {
          console.error("Failed to fetch SF contact:", await contactRes.text());
        }
      }
    } catch (err) {
      console.error("Error in Eva KPI tracking:", err);
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
  // Use ghl_location_id for SimpliOS mode (where user_id is NULL)
  let leadId = null;
  const contactId = task.contactId || task.contact_id || payload.contactId;
  if (contactId) {
    let taskLeadQuery = supabase
      .from("leads")
      .select("id")
      .eq("ghl_contact_id", contactId);

    if (connection.user_id) {
      taskLeadQuery = taskLeadQuery.eq("user_id", connection.user_id);
    } else {
      taskLeadQuery = taskLeadQuery.eq("ghl_location_id", payload.locationId);
    }

    const { data: lead } = await taskLeadQuery.single();
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
