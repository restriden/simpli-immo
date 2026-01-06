import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Parse multipart form data
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const userId = formData.get("user_id") as string;
    const leadId = formData.get("lead_id") as string;
    const mediaType = formData.get("media_type") as string;

    if (!file || !userId || !leadId) {
      return new Response(
        JSON.stringify({ error: "Missing required fields: file, user_id, lead_id" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    console.log(`[GHL-SEND-MEDIA] Processing ${mediaType} for lead ${leadId}`);

    // Get lead data
    const { data: lead, error: leadError } = await supabase
      .from("leads")
      .select("id, ghl_contact_id, ghl_location_id, name")
      .eq("id", leadId)
      .single();

    if (leadError || !lead) {
      return new Response(
        JSON.stringify({ error: "Lead not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!lead.ghl_contact_id || !lead.ghl_location_id) {
      return new Response(
        JSON.stringify({ error: "Lead not connected to GHL" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Get GHL connection for this location
    const { data: connection, error: connError } = await supabase
      .from("ghl_connections")
      .select("*")
      .eq("location_id", lead.ghl_location_id)
      .eq("is_active", true)
      .single();

    if (connError || !connection) {
      return new Response(
        JSON.stringify({ error: "GHL connection not found for this location" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Upload file to Supabase storage first
    const fileBuffer = await file.arrayBuffer();
    const fileName = `${leadId}/${Date.now()}_${file.name}`;

    const { data: uploadData, error: uploadError } = await supabase.storage
      .from("chat-media")
      .upload(fileName, fileBuffer, {
        contentType: file.type,
        upsert: false,
      });

    if (uploadError) {
      console.error("[GHL-SEND-MEDIA] Upload error:", uploadError);
      // Continue anyway - we'll try to send via GHL
    }

    // Get public URL if uploaded successfully
    let mediaUrl = "";
    if (uploadData) {
      const { data: urlData } = supabase.storage
        .from("chat-media")
        .getPublicUrl(fileName);
      mediaUrl = urlData.publicUrl;
    }

    // Send message via GHL with attachment
    const ghlHeaders = {
      "Authorization": `Bearer ${connection.access_token}`,
      "Content-Type": "application/json",
      "Version": "2021-07-28",
    };

    // GHL expects a message with attachments
    const messagePayload: any = {
      type: "WhatsApp",
      contactId: lead.ghl_contact_id,
    };

    // If we have a media URL, send it as an attachment
    if (mediaUrl) {
      messagePayload.attachments = [mediaUrl];
      messagePayload.message = ""; // Empty message with attachment
    } else {
      // Fallback: send as text with placeholder
      const typeLabel = mediaType === "audio" ? "Sprachnachricht" : mediaType === "video" ? "Video" : "Bild";
      messagePayload.message = `[${typeLabel} gesendet]`;
    }

    console.log("[GHL-SEND-MEDIA] Sending to GHL:", JSON.stringify(messagePayload));

    const ghlResponse = await fetch(
      `${GHL_API_BASE}/conversations/messages`,
      {
        method: "POST",
        headers: ghlHeaders,
        body: JSON.stringify(messagePayload),
      }
    );

    const ghlResult = await ghlResponse.json();
    console.log("[GHL-SEND-MEDIA] GHL response:", JSON.stringify(ghlResult));

    if (!ghlResponse.ok) {
      // Still save locally even if GHL fails
      const typeLabel = mediaType === "audio" ? "Sprachnachricht" : mediaType === "video" ? "Video" : "Bild";

      await supabase.from("messages").insert({
        lead_id: leadId,
        user_id: userId,
        content: `[${typeLabel}]${mediaUrl ? ` ${mediaUrl}` : ""}`,
        type: "outgoing",
        is_template: false,
        ghl_data: { media_type: mediaType, media_url: mediaUrl, ghl_error: ghlResult },
      });

      return new Response(
        JSON.stringify({
          success: false,
          error: ghlResult.message || "GHL send failed",
          saved_locally: true,
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Save message locally
    const typeLabel = mediaType === "audio" ? "Sprachnachricht" : mediaType === "video" ? "Video" : "Bild";
    const { data: message, error: msgError } = await supabase
      .from("messages")
      .insert({
        lead_id: leadId,
        user_id: userId,
        content: `[${typeLabel}]`,
        type: "outgoing",
        is_template: false,
        ghl_message_id: ghlResult.messageId || ghlResult.id,
        ghl_data: { media_type: mediaType, media_url: mediaUrl },
      })
      .select()
      .single();

    if (msgError) {
      console.error("[GHL-SEND-MEDIA] Error saving message:", msgError);
    }

    return new Response(
      JSON.stringify({
        success: true,
        message_id: ghlResult.messageId || ghlResult.id,
        media_url: mediaUrl,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error("[GHL-SEND-MEDIA] Error:", error);
    return new Response(
      JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
