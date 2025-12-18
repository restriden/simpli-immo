import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GHL_CLIENT_ID = "69432ebdab47804bce51b78a-mjalsvpx";
const GHL_CLIENT_SECRET = Deno.env.get("GHL_CLIENT_SECRET") || "";
const GHL_TOKEN_URL = "https://services.leadconnectorhq.com/oauth/token";
const GHL_API_BASE = "https://services.leadconnectorhq.com";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GHLConnection {
  id: string;
  user_id: string;
  location_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  is_active: boolean;
}

interface SyncResult {
  contacts: { synced: number; errors: number };
  conversations: { synced: number; errors: number };
  appointments: { synced: number; errors: number };
  tasks: { synced: number; errors: number };
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get request body
    const body = await req.json().catch(() => ({}));
    const { user_id, sync_type = "full" } = body;

    // Validate authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization header" }, 401);
    }

    // If user_id provided, sync only that user; otherwise sync all active connections
    let connections: GHLConnection[];

    if (user_id) {
      const { data, error } = await supabase
        .from("ghl_connections")
        .select("*")
        .eq("user_id", user_id)
        .eq("is_active", true)
        .single();

      if (error || !data) {
        return jsonResponse({ error: "No active GHL connection found" }, 404);
      }
      connections = [data];
    } else {
      // For scheduled/admin syncs - get all active connections
      const { data, error } = await supabase
        .from("ghl_connections")
        .select("*")
        .eq("is_active", true);

      if (error) {
        return jsonResponse({ error: "Failed to fetch connections" }, 500);
      }
      connections = data || [];
    }

    console.log(`Starting sync for ${connections.length} connection(s)`);

    const results: Record<string, SyncResult> = {};

    for (const connection of connections) {
      try {
        // Refresh token if needed
        const validConnection = await ensureValidToken(supabase, connection);

        // Perform sync based on type
        const result = await syncConnection(supabase, validConnection, sync_type);
        results[connection.user_id] = result;

        // Update last_sync_at
        await supabase
          .from("ghl_connections")
          .update({ last_sync_at: new Date().toISOString() })
          .eq("id", connection.id);

        // Log success
        await logSync(supabase, connection.id, sync_type, "success", result);
      } catch (err) {
        console.error(`Sync failed for user ${connection.user_id}:`, err);
        await logSync(supabase, connection.id, sync_type, "error", { error: err.message });
        results[connection.user_id] = {
          contacts: { synced: 0, errors: 1 },
          conversations: { synced: 0, errors: 1 },
          appointments: { synced: 0, errors: 1 },
        };
      }
    }

    return jsonResponse({
      success: true,
      synced_connections: connections.length,
      results,
    });
  } catch (err) {
    console.error("Sync error:", err);
    return jsonResponse({ error: err.message || "Internal server error" }, 500);
  }
});

async function ensureValidToken(
  supabase: any,
  connection: GHLConnection
): Promise<GHLConnection> {
  const expiresAt = new Date(connection.token_expires_at);
  const now = new Date();

  // Refresh if token expires in less than 5 minutes
  const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  if (expiresAt <= fiveMinutesFromNow) {
    console.log(`Refreshing token for user ${connection.user_id}`);

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
  }

  return connection;
}

async function syncConnection(
  supabase: any,
  connection: GHLConnection,
  syncType: string
): Promise<SyncResult> {
  console.log("=== STARTING SYNC ===");
  console.log("User ID:", connection.user_id);
  console.log("Location ID:", connection.location_id);
  console.log("Sync Type:", syncType);
  console.log("Token length:", connection.access_token?.length || 0);
  console.log("Token expires at:", connection.token_expires_at);

  const result: SyncResult = {
    contacts: { synced: 0, errors: 0 },
    conversations: { synced: 0, errors: 0 },
    appointments: { synced: 0, errors: 0 },
    tasks: { synced: 0, errors: 0 },
  };

  const headers = {
    Authorization: `Bearer ${connection.access_token}`,
    Version: "2021-07-28",
    Accept: "application/json",
  };

  console.log("Headers prepared (Version:", headers.Version, ")");

  // Sync Contacts
  if (syncType === "full" || syncType === "contacts") {
    try {
      result.contacts = await syncContacts(supabase, connection, headers);
    } catch (err) {
      console.error("Contacts sync error:", err);
      result.contacts.errors = 1;
    }
  }

  // Sync Conversations
  if (syncType === "full" || syncType === "conversations") {
    try {
      result.conversations = await syncConversations(supabase, connection, headers);
    } catch (err) {
      console.error("Conversations sync error:", err);
      result.conversations.errors = 1;
    }
  }

  // Sync Appointments
  if (syncType === "full" || syncType === "appointments") {
    try {
      result.appointments = await syncAppointments(supabase, connection, headers);
    } catch (err) {
      console.error("Appointments sync error:", err);
      result.appointments.errors = 1;
    }
  }

  // Sync Tasks
  if (syncType === "full" || syncType === "tasks") {
    try {
      result.tasks = await syncTasks(supabase, connection, headers);
    } catch (err) {
      console.error("Tasks sync error:", err);
      result.tasks.errors = 1;
    }
  }

  return result;
}

async function syncContacts(
  supabase: any,
  connection: GHLConnection,
  headers: Record<string, string>
): Promise<{ synced: number; errors: number }> {
  let synced = 0;
  let errors = 0;
  let nextPageUrl: string | null = `${GHL_API_BASE}/contacts/?locationId=${connection.location_id}&limit=100`;

  console.log("=== SYNC CONTACTS ===");
  console.log("Location ID:", connection.location_id);
  console.log("Initial URL:", nextPageUrl);

  while (nextPageUrl) {
    console.log("Fetching:", nextPageUrl);
    const response = await fetch(nextPageUrl, { headers });

    console.log("Response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Contacts API error:", response.status, errorText);
      throw new Error(`Failed to fetch contacts: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    console.log("Contacts response keys:", Object.keys(data));
    console.log("Total contacts in response:", data.contacts?.length || 0);
    console.log("Meta:", data.meta);

    const contacts = data.contacts || [];

    for (const contact of contacts) {
      try {
        // Map GHL contact to our leads table
        const leadData = {
          user_id: connection.user_id,
          ghl_contact_id: contact.id,
          ghl_location_id: connection.location_id,
          name: `${contact.firstName || ""} ${contact.lastName || ""}`.trim() || "Unbekannt",
          email: contact.email || null,
          phone: contact.phone || null,
          status: mapGHLTagsToStatus(contact.tags || []),
          source: "extern" as const,
          notes: contact.customFields
            ? JSON.stringify(contact.customFields)
            : null,
          ghl_data: contact, // Store full GHL data
          updated_at: new Date().toISOString(),
        };

        // Try to upsert based on ghl_contact_id
        // If constraint doesn't exist, fall back to checking and inserting/updating manually
        let { error } = await supabase.from("leads").upsert(leadData, {
          onConflict: "ghl_contact_id",
          ignoreDuplicates: false,
        });

        // If upsert fails due to missing constraint, try manual approach
        if (error && error.code === "42P10") {
          console.log("Upsert constraint missing, trying manual insert/update for:", contact.id);

          // Check if contact already exists
          const { data: existing } = await supabase
            .from("leads")
            .select("id")
            .eq("ghl_contact_id", contact.id)
            .single();

          if (existing) {
            // Update existing
            const { error: updateError } = await supabase
              .from("leads")
              .update(leadData)
              .eq("id", existing.id);
            error = updateError;
          } else {
            // Insert new
            const { error: insertError } = await supabase
              .from("leads")
              .insert(leadData);
            error = insertError;
          }
        }

        if (error) {
          console.error("Error saving contact:", error);
          errors++;
        } else {
          synced++;
        }
      } catch (err) {
        console.error("Error processing contact:", err);
        errors++;
      }
    }

    // Check for next page
    nextPageUrl = data.meta?.nextPageUrl || null;

    // Rate limiting
    await sleep(100);
  }

  console.log(`Contacts synced: ${synced}, errors: ${errors}`);
  return { synced, errors };
}

async function syncConversations(
  supabase: any,
  connection: GHLConnection,
  headers: Record<string, string>
): Promise<{ synced: number; errors: number }> {
  let synced = 0;
  let errors = 0;

  console.log("=== SYNC CONVERSATIONS ===");
  console.log("Location ID:", connection.location_id);

  // GHL API requires getting conversations per contact
  // First get all leads with ghl_contact_id
  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("id, ghl_contact_id")
    .eq("user_id", connection.user_id)
    .not("ghl_contact_id", "is", null);

  if (leadsError || !leads) {
    console.error("Error fetching leads:", leadsError);
    return { synced: 0, errors: 1 };
  }

  console.log("Found leads with GHL contact IDs:", leads.length);

  // For each lead, get their conversations by searching with contactId
  for (const lead of leads) {
    try {
      console.log(`Searching conversations for contact: ${lead.ghl_contact_id}`);

      // Use the conversations endpoint with contactId query parameter
      // This should find all conversation types including WhatsApp
      const conversationsUrl = `${GHL_API_BASE}/conversations?locationId=${connection.location_id}&contactId=${lead.ghl_contact_id}`;
      console.log(`Conversations URL: ${conversationsUrl}`);

      const conversationsResponse = await fetch(conversationsUrl, { headers });

      if (!conversationsResponse.ok) {
        const errorText = await conversationsResponse.text();
        console.error(`Conversations fetch failed:`, conversationsResponse.status, errorText);

        // Try alternative endpoint for WhatsApp
        const altUrl = `${GHL_API_BASE}/conversations/search?locationId=${connection.location_id}&contactId=${lead.ghl_contact_id}`;
        console.log(`Trying alternative URL: ${altUrl}`);

        const altResponse = await fetch(altUrl, {
          method: "GET",
          headers,
        });

        if (altResponse.ok) {
          const altData = await altResponse.json();
          console.log(`Alt response keys:`, Object.keys(altData));
          const conversations = altData.conversations || [];
          console.log(`Found ${conversations.length} conversations via alt endpoint`);

          for (const conv of conversations) {
            console.log(`Conversation type: ${conv.type}, id: ${conv.id}`);
            const result = await syncMessagesForConversation(
              supabase,
              connection,
              headers,
              conv.id,
              lead.id
            );
            synced += result.synced;
            errors += result.errors;
          }
        }
        continue;
      }

      const conversationsData = await conversationsResponse.json();
      console.log(`Conversations response keys:`, Object.keys(conversationsData));

      const conversations = conversationsData.conversations || [];
      console.log(`Found ${conversations.length} conversations for contact`);

      for (const conv of conversations) {
        console.log(`Conversation type: ${conv.type}, id: ${conv.id}`);
        const result = await syncMessagesForConversation(
          supabase,
          connection,
          headers,
          conv.id,
          lead.id
        );
        synced += result.synced;
        errors += result.errors;
      }

      // Rate limiting
      await sleep(150);
    } catch (err) {
      console.error("Error processing lead conversations:", err);
      errors++;
    }
  }

  console.log(`Conversations synced: ${synced}, errors: ${errors}`);
  return { synced, errors };
}

async function syncMessagesForConversation(
  supabase: any,
  connection: GHLConnection,
  headers: Record<string, string>,
  conversationId: string,
  leadId: string
): Promise<{ synced: number; errors: number }> {
  let synced = 0;
  let errors = 0;

  try {
    const messagesUrl = `${GHL_API_BASE}/conversations/${conversationId}/messages`;
    console.log(`Fetching messages for conversation: ${conversationId}`);

    const messagesResponse = await fetch(messagesUrl, { headers });

    if (!messagesResponse.ok) {
      const errorText = await messagesResponse.text();
      console.error("Messages fetch failed:", messagesResponse.status, errorText);
      return { synced: 0, errors: 1 };
    }

    const messagesData = await messagesResponse.json();
    console.log(`Messages response keys:`, Object.keys(messagesData));

    // Handle different response formats from GHL API
    let messages: any[] = [];
    if (Array.isArray(messagesData.messages)) {
      messages = messagesData.messages;
    } else if (Array.isArray(messagesData)) {
      messages = messagesData;
    } else if (messagesData.messages?.messages && Array.isArray(messagesData.messages.messages)) {
      messages = messagesData.messages.messages;
    } else if (messagesData.data && Array.isArray(messagesData.data)) {
      messages = messagesData.data;
    }

    console.log(`Found ${messages.length} messages`);

    // Process last 50 messages
    for (const message of messages.slice(-50)) {
      const messageData = {
        user_id: connection.user_id,
        lead_id: leadId,
        ghl_message_id: message.id,
        ghl_conversation_id: conversationId,
        content: message.body || message.text || "",
        type: message.direction === "inbound" ? "incoming" : "outgoing",
        is_template: false,
        ghl_data: message,
        created_at: message.dateAdded || new Date().toISOString(),
      };

      // Try upsert, fallback to manual insert/update
      let { error } = await supabase.from("messages").upsert(messageData, {
        onConflict: "ghl_message_id",
        ignoreDuplicates: false,
      });

      if (error && error.code === "42P10") {
        // Constraint missing, try manual approach
        const { data: existing } = await supabase
          .from("messages")
          .select("id")
          .eq("ghl_message_id", message.id)
          .single();

        if (existing) {
          const { error: updateError } = await supabase
            .from("messages")
            .update(messageData)
            .eq("id", existing.id);
          error = updateError;
        } else {
          const { error: insertError } = await supabase
            .from("messages")
            .insert(messageData);
          error = insertError;
        }
      }

      if (error) {
        console.error("Error saving message:", error);
        errors++;
      } else {
        synced++;
      }
    }

    // Update lead's last_message_at
    if (messages.length > 0) {
      const lastMessage = messages[messages.length - 1];
      await supabase
        .from("leads")
        .update({
          last_message_at: lastMessage.dateAdded,
          updated_at: new Date().toISOString(),
        })
        .eq("id", leadId);
    }
  } catch (err) {
    console.error("Error syncing messages for conversation:", err);
    errors++;
  }

  return { synced, errors };
}

async function syncAppointments(
  supabase: any,
  connection: GHLConnection,
  headers: Record<string, string>
): Promise<{ synced: number; errors: number }> {
  let synced = 0;
  let errors = 0;

  console.log("=== SYNC APPOINTMENTS ===");
  console.log("Location ID:", connection.location_id);

  // First, get all calendars for this location
  const calendarsUrl = `${GHL_API_BASE}/calendars/?locationId=${connection.location_id}`;
  console.log("Calendars URL:", calendarsUrl);

  const calendarsResponse = await fetch(calendarsUrl, { headers });
  console.log("Calendars response status:", calendarsResponse.status);

  if (!calendarsResponse.ok) {
    const errorText = await calendarsResponse.text();
    console.error("Calendars API error:", calendarsResponse.status, errorText);
    console.log("Calendar API not available or no access");
    return { synced: 0, errors: 0 };
  }

  const calendarsData = await calendarsResponse.json();
  const calendars = calendarsData.calendars || [];
  console.log("Total calendars found:", calendars.length);

  if (calendars.length === 0) {
    console.log("No calendars found for this location");
    return { synced: 0, errors: 0 };
  }

  // Get appointments for next 30 days from each calendar
  const startDate = new Date();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);

  const allEvents: any[] = [];

  for (const calendar of calendars) {
    console.log(`Fetching events for calendar: ${calendar.id} (${calendar.name})`);

    const eventsUrl = `${GHL_API_BASE}/calendars/events?calendarId=${calendar.id}&startTime=${startDate.getTime()}&endTime=${endDate.getTime()}`;
    console.log("Events URL:", eventsUrl);

    const response = await fetch(eventsUrl, { headers });
    console.log("Events response status:", response.status);

    if (!response.ok) {
      const errorText = await response.text();
      console.error("Events API error for calendar", calendar.id, ":", response.status, errorText);
      continue;
    }

    const data = await response.json();
    console.log("Events in calendar:", data.events?.length || 0);

    if (data.events) {
      allEvents.push(...data.events);
    }

    // Rate limiting
    await sleep(100);
  }

  console.log("Total events across all calendars:", allEvents.length);
  const events = allEvents;

  for (const event of events) {
    try {
      // Find the lead for this appointment
      let leadId = null;
      if (event.contactId) {
        const { data: lead } = await supabase
          .from("leads")
          .select("id")
          .eq("ghl_contact_id", event.contactId)
          .single();
        leadId = lead?.id;
      }

      // Create a todo for the appointment
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
        created_at: event.dateAdded || new Date().toISOString(),
      };

      const { error } = await supabase.from("todos").upsert(todoData, {
        onConflict: "ghl_event_id",
        ignoreDuplicates: false,
      });

      if (error) {
        errors++;
      } else {
        synced++;
      }
    } catch (err) {
      console.error("Error processing appointment:", err);
      errors++;
    }
  }

  console.log(`Appointments synced: ${synced}, errors: ${errors}`);
  return { synced, errors };
}

function mapGHLTagsToStatus(tags: string[]): string {
  const tagLower = tags.map((t) => t.toLowerCase());

  if (tagLower.includes("käufer") || tagLower.includes("gekauft")) {
    return "gekauft";
  }
  if (tagLower.includes("besichtigt") || tagLower.includes("besichtigung")) {
    return "besichtigt";
  }
  if (tagLower.includes("finanziert") || tagLower.includes("simpli")) {
    return "simpli_bestaetigt";
  }
  if (tagLower.includes("kontaktiert")) {
    return "kontaktiert";
  }

  return "neu";
}

async function syncTasks(
  supabase: any,
  connection: GHLConnection,
  headers: Record<string, string>
): Promise<{ synced: number; errors: number }> {
  let synced = 0;
  let errors = 0;

  console.log("=== SYNC TASKS ===");
  console.log("Location ID:", connection.location_id);

  // Get all leads with ghl_contact_id for this user
  const { data: leads, error: leadsError } = await supabase
    .from("leads")
    .select("id, ghl_contact_id")
    .eq("user_id", connection.user_id)
    .not("ghl_contact_id", "is", null);

  if (leadsError || !leads) {
    console.error("Error fetching leads:", leadsError);
    return { synced: 0, errors: 1 };
  }

  console.log("Leads with GHL contact ID:", leads.length);

  // Fetch tasks for each contact
  for (const lead of leads) {
    try {
      const tasksUrl = `${GHL_API_BASE}/contacts/${lead.ghl_contact_id}/tasks`;
      console.log("Fetching tasks for contact:", lead.ghl_contact_id);

      const response = await fetch(tasksUrl, { headers });

      if (!response.ok) {
        if (response.status === 404) {
          // No tasks for this contact
          continue;
        }
        console.error("Tasks API error:", response.status);
        errors++;
        continue;
      }

      const data = await response.json();
      const tasks = data.tasks || [];
      console.log("Tasks found for contact:", tasks.length);

      for (const task of tasks) {
        try {
          // Determine priority
          let priority = "normal";
          if (task.priority === "high" || task.priority === "urgent") {
            priority = "dringend";
          }

          // Determine type based on task title
          let todoType = "nachricht";
          const title = (task.title || task.name || "Aufgabe").toLowerCase();
          if (title.includes("anruf") || title.includes("call") || title.includes("phone")) {
            todoType = "anruf";
          } else if (title.includes("besichtigung") || title.includes("termin") || title.includes("viewing")) {
            todoType = "besichtigung";
          } else if (title.includes("finanzierung") || title.includes("financing")) {
            todoType = "finanzierung";
          } else if (title.includes("dokument") || title.includes("document") || title.includes("unterlagen")) {
            todoType = "dokument";
          }

          const isCompleted = task.status === "completed" || task.completed === true;

          // Strip HTML first
          const rawTitle = stripHtml(task.title || task.name) || "Aufgabe";
          const rawDescription = stripHtml(task.description || task.body || task.notes);

          // Translate to German if needed
          const { translated: translatedTitle, wasTranslated: titleTranslated } = await translateToGerman(rawTitle);
          const { translated: translatedDescription, wasTranslated: descTranslated } = await translateToGerman(rawDescription);

          const todoData = {
            user_id: connection.user_id,
            lead_id: lead.id,
            ghl_task_id: task.id,
            type: todoType,
            priority: priority,
            title: translatedTitle || "Aufgabe",
            subtitle: translatedDescription,
            completed: isCompleted,
            due_date: task.dueDate || task.due_date || null,
            ghl_data: task,
          };

          // Upsert: update if exists, insert if not
          const { data: existing } = await supabase
            .from("todos")
            .select("id")
            .eq("ghl_task_id", task.id)
            .single();

          if (existing) {
            await supabase
              .from("todos")
              .update(todoData)
              .eq("id", existing.id);
          } else {
            await supabase
              .from("todos")
              .insert(todoData);
          }

          // If translated, update in GHL too
          if ((titleTranslated || descTranslated) && lead.ghl_contact_id) {
            try {
              const updateUrl = `${GHL_API_BASE}/contacts/${lead.ghl_contact_id}/tasks/${task.id}`;
              const updateBody: any = {};
              if (titleTranslated) updateBody.title = translatedTitle;
              if (descTranslated) {
                updateBody.body = translatedDescription;
                updateBody.description = translatedDescription; // Try both field names
              }

              console.log("Updating GHL task:", updateUrl, JSON.stringify(updateBody));

              const ghlResponse = await fetch(updateUrl, {
                method: "PUT",
                headers: {
                  ...headers,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify(updateBody),
              });

              if (ghlResponse.ok) {
                console.log("Updated task in GHL with German translation");
              } else {
                const errorText = await ghlResponse.text();
                console.error("GHL task update failed:", ghlResponse.status, errorText);
              }
            } catch (ghlErr) {
              console.error("Failed to update GHL task with translation:", ghlErr);
            }
          }

          synced++;
        } catch (taskErr) {
          console.error("Error syncing task:", taskErr);
          errors++;
        }
      }

      // Rate limiting
      await sleep(100);
    } catch (err) {
      console.error("Error fetching tasks for contact:", lead.ghl_contact_id, err);
      errors++;
    }
  }

  console.log("Tasks sync complete. Synced:", synced, "Errors:", errors);
  return { synced, errors };
}

async function logSync(
  supabase: any,
  connectionId: string,
  syncType: string,
  status: string,
  metadata: any
) {
  await supabase.from("ghl_sync_logs").insert({
    connection_id: connectionId,
    sync_type: syncType,
    status,
    message: status === "success" ? "Sync completed" : "Sync failed",
    metadata,
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function stripHtml(html: string | null | undefined): string | null {
  if (!html) return null;
  // Remove HTML tags and decode common entities
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

/**
 * Translate text to German if not already German
 * Returns { translated: string, wasTranslated: boolean }
 */
async function translateToGerman(text: string | null): Promise<{ translated: string | null; wasTranslated: boolean }> {
  if (!text || text.trim().length < 3) {
    return { translated: text, wasTranslated: false };
  }

  if (!ANTHROPIC_API_KEY) {
    console.log("No Anthropic API key, skipping translation");
    return { translated: text, wasTranslated: false };
  }

  try {
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: `Du bist ein Übersetzer für eine Immobilien-App. Analysiere diesen Text einer Aufgabe/To-Do:

Text: "${text}"

Regeln:
1. Prüfe ob der Text bereits auf Deutsch ist
2. Wenn nicht Deutsch, übersetze SINNGEMÄSS (nicht wörtlich!) ins Deutsche
3. Behalte den geschäftlichen Kontext bei (Immobilien, Kunden, Makler)
4. "Let's go" → "Los geht's" oder "Starten" (NICHT "Lass los")
5. "Call back" → "Rückruf" (NICHT "Zurückrufen")
6. Kurze, professionelle Formulierungen bevorzugen

Antworte NUR mit diesem JSON (kein anderer Text):
{"isGerman": true/false, "translation": "Deutsche Übersetzung oder Original wenn bereits Deutsch"}`
          }
        ],
      }),
    });

    if (!response.ok) {
      console.error("Translation API error:", response.status);
      return { translated: text, wasTranslated: false };
    }

    const data = await response.json();
    const content = data.content?.[0]?.text || "";

    // Parse JSON from response
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const result = JSON.parse(jsonMatch[0]);
      if (!result.isGerman && result.translation) {
        console.log(`Translated: "${text}" -> "${result.translation}"`);
        return { translated: result.translation, wasTranslated: true };
      }
    }

    return { translated: text, wasTranslated: false };
  } catch (error) {
    console.error("Translation error:", error);
    return { translated: text, wasTranslated: false };
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
