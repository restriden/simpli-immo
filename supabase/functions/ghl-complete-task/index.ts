import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface CompleteTaskRequest {
  user_id: string;
  todo_id: string;
  completed: boolean;
}

/**
 * Complete or uncomplete a task in GHL
 * Syncs the task status from the app to GHL
 */
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

    const body: CompleteTaskRequest = await req.json();
    const { user_id, todo_id, completed = true } = body;

    console.log("=== COMPLETE TASK REQUEST ===");
    console.log("User ID:", user_id);
    console.log("Todo ID:", todo_id);
    console.log("Completed:", completed);

    if (!user_id || !todo_id) {
      return jsonResponse({ error: "Missing required fields" }, 400);
    }

    // Get the todo to find the GHL task ID
    const { data: todo, error: todoError } = await supabase
      .from("todos")
      .select("ghl_task_id, ghl_event_id")
      .eq("id", todo_id)
      .single();

    if (todoError || !todo) {
      return jsonResponse({ error: "Todo not found" }, 404);
    }

    const ghlTaskId = todo.ghl_task_id || todo.ghl_event_id;

    if (!ghlTaskId) {
      // No GHL task ID - just update locally
      console.log("No GHL task ID, updating locally only");
      const { error: updateError } = await supabase
        .from("todos")
        .update({ completed, updated_at: new Date().toISOString() })
        .eq("id", todo_id);

      if (updateError) {
        return jsonResponse({ error: "Failed to update todo" }, 500);
      }

      return jsonResponse({ success: true, synced_to_ghl: false });
    }

    // Get the GHL connection for this user
    const { data: connection, error: connError } = await supabase
      .from("ghl_connections")
      .select("*")
      .eq("user_id", user_id)
      .eq("is_active", true)
      .single();

    if (connError || !connection) {
      // No GHL connection - just update locally
      console.log("No GHL connection, updating locally only");
      const { error: updateError } = await supabase
        .from("todos")
        .update({ completed, updated_at: new Date().toISOString() })
        .eq("id", todo_id);

      if (updateError) {
        return jsonResponse({ error: "Failed to update todo" }, 500);
      }

      return jsonResponse({ success: true, synced_to_ghl: false });
    }

    // Update the task in GHL
    const headers = {
      Authorization: `Bearer ${connection.access_token}`,
      Version: "2021-07-28",
      "Content-Type": "application/json",
    };

    console.log("Updating task in GHL:", ghlTaskId);

    // Try to update the task status in GHL
    const updateUrl = `${GHL_API_BASE}/contacts/tasks/${ghlTaskId}/status`;
    const updateResponse = await fetch(updateUrl, {
      method: "PUT",
      headers,
      body: JSON.stringify({
        completed: completed,
      }),
    });

    let ghlSynced = false;
    if (updateResponse.ok) {
      console.log("Task updated in GHL successfully");
      ghlSynced = true;
    } else {
      const errorText = await updateResponse.text();
      console.error("Failed to update task in GHL:", updateResponse.status, errorText);

      // Try alternative endpoint
      const altUrl = `${GHL_API_BASE}/contacts/tasks/${ghlTaskId}`;
      const altResponse = await fetch(altUrl, {
        method: "PUT",
        headers,
        body: JSON.stringify({
          status: completed ? "completed" : "pending",
          completed: completed,
        }),
      });

      if (altResponse.ok) {
        console.log("Task updated in GHL via alternative endpoint");
        ghlSynced = true;
      } else {
        console.error("Alternative endpoint also failed:", await altResponse.text());
      }
    }

    // Update locally
    const { error: updateError } = await supabase
      .from("todos")
      .update({ completed, updated_at: new Date().toISOString() })
      .eq("id", todo_id);

    if (updateError) {
      console.error("Error updating todo locally:", updateError);
      return jsonResponse({ error: "Failed to update todo locally" }, 500);
    }

    return jsonResponse({
      success: true,
      synced_to_ghl: ghlSynced,
      ghl_task_id: ghlTaskId,
    });
  } catch (err) {
    console.error("Complete task error:", err);
    return jsonResponse({ error: err.message || "Internal error" }, 500);
  }
});

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
