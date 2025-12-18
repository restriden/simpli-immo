import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CreateTaskRequest {
  user_id: string;
  lead_id?: string;
  title: string;
  description?: string;
  type?: string;
  priority?: string;
  due_date?: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const body: CreateTaskRequest = await req.json();
    const { user_id, lead_id, title, description, type = "nachricht", priority = "normal", due_date } = body;

    console.log("=== CREATE TASK REQUEST ===");
    console.log("User ID:", user_id);
    console.log("Lead ID:", lead_id);
    console.log("Title:", title);

    if (!user_id || !title) {
      return jsonResponse({ error: "Missing required fields (user_id, title)" }, 400);
    }

    // Get GHL connection
    const { data: connection, error: connError } = await supabase
      .from("ghl_connections")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .single();

    let ghlTaskId = null;
    let contactId = null;

    // If we have a lead, get the contact ID
    if (lead_id) {
      const { data: lead } = await supabase
        .from("leads")
        .select("ghl_contact_id")
        .eq("id", lead_id)
        .single();
      contactId = lead?.ghl_contact_id;
    }

    // Create task in GHL if we have a connection and contact
    if (connection && contactId) {
      try {
        const headers = {
          Authorization: `Bearer ${connection.access_token}`,
          Version: "2021-07-28",
          "Content-Type": "application/json",
        };

        const ghlTaskData: any = {
          title,
          dueDate: due_date || new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Default: tomorrow
        };

        if (description) {
          ghlTaskData.body = description;
        }

        console.log("Creating task in GHL for contact:", contactId);
        const createUrl = `${GHL_API_BASE}/contacts/${contactId}/tasks`;

        const ghlResponse = await fetch(createUrl, {
          method: "POST",
          headers,
          body: JSON.stringify(ghlTaskData),
        });

        if (ghlResponse.ok) {
          const ghlResult = await ghlResponse.json();
          ghlTaskId = ghlResult.task?.id || ghlResult.id;
          console.log("Task created in GHL:", ghlTaskId);
        } else {
          const errorText = await ghlResponse.text();
          console.error("GHL task creation failed:", ghlResponse.status, errorText);
        }
      } catch (ghlErr) {
        console.error("GHL API error:", ghlErr);
      }
    }

    // Create task in local database
    const todoData = {
      user_id,
      lead_id: lead_id || null,
      ghl_task_id: ghlTaskId,
      title,
      subtitle: description || null,
      type,
      priority,
      completed: false,
      due_date: due_date || null,
      ghl_data: ghlTaskId ? { contactId, ghlTaskId } : null,
    };

    const { data: newTodo, error: insertError } = await supabase
      .from("todos")
      .insert(todoData)
      .select()
      .single();

    if (insertError) {
      console.error("Error creating todo:", insertError);
      return jsonResponse({ error: "Failed to create task" }, 500);
    }

    console.log("Task created locally:", newTodo.id);

    return jsonResponse({
      success: true,
      todo: newTodo,
      synced_to_ghl: !!ghlTaskId,
    });
  } catch (err) {
    console.error("Create task error:", err);
    return jsonResponse({ error: err.message || "Internal error" }, 500);
  }
});

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
