/**
 * Generate Follow-up Edge Function V2
 *
 * Features:
 * - 2-Follow-Up System (FU1: reminder, FU2: SF pitch + exit)
 * - Checks if SF appointment already booked (sf_reached_beratung)
 * - Proper template mode handling (strips Hallo/Grüße)
 * - Tracks follow_up_number (1 or 2)
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Own account location IDs - NO follow-ups for these (only for Makler locations)
const EXCLUDED_LOCATION_IDS = [
  "iDLo7b4WOOCkE9voshIM", // Simpli Finance GmbH
  "dI8ofFbKIogmLSUTvTFn", // simpli.immo
  "MAMK21fjL4Z52qgcvpgq", // simpli.bot
];

interface GenerateFollowupRequest {
  lead_id: string;
  gemini_api_key?: string;
}

interface FollowupResult {
  success: boolean;
  followup_message: string;
  is_within_24h: boolean;
  formatted_message: string;
  prompt_version_id: string | null;
  conversation_summary: string;
  followup_reason: string;
  lead_name: string;
  makler_name: string | null;
  follow_up_date: string | null;
  date_reason: string;
  current_stage: string;
  target_stage: string;
  follow_up_number: number;
  no_follow_up?: boolean;
  no_follow_up_reason?: string;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { lead_id, gemini_api_key }: GenerateFollowupRequest = await req.json();

    if (!lead_id) {
      return new Response(
        JSON.stringify({ error: "lead_id is required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Get Lead with follow-up tracking and SF booking status
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select(`
        id,
        name,
        email,
        phone,
        ghl_contact_id,
        ghl_location_id,
        objekt_id,
        last_message_at,
        ai_improvement_suggestion,
        sf_reached_beratung,
        followup_1_sent_at,
        followup_2_sent_at
      `)
      .eq('id', lead_id)
      .single();

    if (leadError || !lead) {
      return new Response(
        JSON.stringify({ error: "Lead not found", details: leadError?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 1b. Check if lead is from excluded location (Simpli Immo, Simpli Finance, Simpli Bot)
    // Only generate follow-ups for Makler locations
    if (lead.ghl_location_id && EXCLUDED_LOCATION_IDS.includes(lead.ghl_location_id)) {
      console.log(`[GenerateFollowup] Lead ${lead_id} is from excluded location (${lead.ghl_location_id}), skipping`);
      return new Response(
        JSON.stringify({
          success: true,
          no_follow_up: true,
          no_follow_up_reason: "Kein Follow-up für eigene Accounts (nur Makler-Leads)"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Check if SF appointment already booked - NO follow-up needed
    if (lead.sf_reached_beratung === true) {
      console.log(`[GenerateFollowup] Lead ${lead_id} already booked SF appointment, skipping`);
      return new Response(
        JSON.stringify({
          success: true,
          no_follow_up: true,
          no_follow_up_reason: "Lead hat bereits einen Simpli Finance Termin gebucht"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Check follow-up count - max 2 follow-ups
    let followUpCount = 0;
    if (lead.followup_1_sent_at) followUpCount = 1;
    if (lead.followup_2_sent_at) followUpCount = 2;

    if (followUpCount >= 2) {
      console.log(`[GenerateFollowup] Lead ${lead_id} already received 2 follow-ups, skipping`);
      return new Response(
        JSON.stringify({
          success: true,
          no_follow_up: true,
          no_follow_up_reason: "Bereits 2 Follow-Ups gesendet (Maximum erreicht)"
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const nextFollowUpNumber = followUpCount + 1;
    console.log(`[GenerateFollowup] Lead ${lead_id}: Generating Follow-Up #${nextFollowUpNumber}`);

    // Get GHL connection info separately
    let connectionInfo = null;
    if (lead.ghl_location_id) {
      const { data: conn } = await supabase
        .from('ghl_connections')
        .select('id, location_id, location_name, user_id')
        .eq('location_id', lead.ghl_location_id)
        .single();
      connectionInfo = conn;
    }

    // 4. Get recent messages
    const { data: messages } = await supabase
      .from('messages')
      .select('content, type, created_at')
      .eq('lead_id', lead_id)
      .order('created_at', { ascending: true })
      .limit(30);

    if (!messages || messages.length === 0) {
      return new Response(
        JSON.stringify({ error: "No messages found for this lead" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 5. Check 24h window
    const lastIncomingMessage = messages
      .filter(m => m.type === 'incoming')
      .pop();

    let isWithin24h = false;
    if (lastIncomingMessage) {
      const hoursSinceLastMessage = (Date.now() - new Date(lastIncomingMessage.created_at).getTime()) / (1000 * 60 * 60);
      isWithin24h = hoursSinceLastMessage < 24;
    }

    // 6. Get active prompt version
    const { data: promptVersions } = await supabase
      .from('followup_prompt_versions')
      .select('*')
      .eq('is_active', true)
      .eq('category', 'standard_followup');

    let selectedPromptVersion = null;
    let promptTemplate = getDefaultPrompt();

    if (promptVersions && promptVersions.length > 0) {
      selectedPromptVersion = promptVersions[Math.floor(Math.random() * promptVersions.length)];
      promptTemplate = selectedPromptVersion.prompt_template;
    }

    // 7. Build conversation context
    const conversationHistory = messages
      .map(m => `${m.type === 'incoming' ? 'Kunde' : 'Makler'}: ${m.content}`)
      .join('\n');

    // 8. Get subaccount assignment for form type (du/sie)
    const { data: assignment } = await supabase
      .from('subaccount_prompt_assignments')
      .select('form_type')
      .eq('location_id', lead.ghl_location_id)
      .single();

    const formType = assignment?.form_type || 'sie';

    // 9. Generate follow-up with Gemini
    const apiKey = gemini_api_key || Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "No Gemini API key available" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const today = new Date().toISOString().split('T')[0];
    const lastMessageDate = messages[messages.length - 1]?.created_at
      ? new Date(messages[messages.length - 1].created_at).toISOString().split('T')[0]
      : 'Unbekannt';
    const daysSinceLastMessage = messages[messages.length - 1]?.created_at
      ? Math.floor((Date.now() - new Date(messages[messages.length - 1].created_at).getTime()) / (1000 * 60 * 60 * 24))
      : 0;

    // Replace template variables
    const systemPrompt = promptTemplate
      .replace(/\{\{FORM_TYPE\}\}/g, formType === 'du' ? 'Du' : 'Sie')
      .replace(/\{\{IS_TEMPLATE\}\}/g, isWithin24h ? 'false' : 'true')
      .replace(/\{\{TODAY\}\}/g, today);

    const userPrompt = `
KONVERSATION:
${conversationHistory}

LEAD-INFO:
- Name: ${lead.name || 'Unbekannt'}
- E-Mail: ${lead.email || 'Nicht angegeben'}
- Telefon: ${lead.phone || 'Nicht angegeben'}
- Letzte Nachricht: ${lastMessageDate} (vor ${daysSinceLastMessage} Tagen)

FOLLOW-UP STATUS:
- Bisherige Follow-Ups gesendet: ${followUpCount}
- Nächstes Follow-Up wäre: #${nextFollowUpNumber}
${followUpCount === 1 ? '- WICHTIG: Follow-Up 1 wurde bereits gesendet und ignoriert. Generiere jetzt Follow-Up 2 (Simpli Finance Pitch + Exit-Option)!' : ''}

${!isWithin24h ? `
TEMPLATE-MODUS AKTIV:
Das 24h-Fenster ist geschlossen. Generiere NUR den Kerninhalt der Nachricht:
- KEIN "Hallo", "Hey", "Hi" am Anfang
- KEIN "Viele Grüße", "LG", etc. am Ende
Das System fügt die Anrede und den Gruß automatisch aus dem WhatsApp-Template hinzu.
` : ''}

Generiere jetzt Follow-Up #${nextFollowUpNumber}.
`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [{ text: systemPrompt + '\n\n' + userPrompt }]
            }
          ],
          generationConfig: {
            temperature: 0.7,
            maxOutputTokens: 1000, // Increased for longer FU2 messages
          }
        })
      }
    );

    if (!geminiResponse.ok) {
      const errorText = await geminiResponse.text();
      console.error('Gemini API error:', errorText);
      return new Response(
        JSON.stringify({ error: "Failed to generate follow-up", details: errorText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const geminiData = await geminiResponse.json();
    const rawFollowup = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

    if (!rawFollowup) {
      return new Response(
        JSON.stringify({ error: "Empty response from AI" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 10. Parse response
    let followupMessage = rawFollowup;
    let followupReason = '';
    let conversationSummary = '';
    let followUpDate: string | null = null;
    let dateReason = '';
    let currentStage = '';
    let targetStage = '';
    let aiFollowUpNumber = nextFollowUpNumber;
    let noFollowUp = false;
    let noFollowUpReason = '';

    try {
      const jsonMatch = rawFollowup.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);

        // Check if AI says no follow-up needed
        if (parsed.no_follow_up === true) {
          noFollowUp = true;
          noFollowUpReason = parsed.reason || 'AI entschied: kein Follow-Up nötig';
        } else {
          followupMessage = parsed.message || parsed.followup_message || rawFollowup;
          followupReason = parsed.reason || parsed.followup_reason || '';
          conversationSummary = parsed.summary || parsed.conversation_summary || '';
          followUpDate = parsed.follow_up_date || null;
          dateReason = parsed.date_reason || '';
          currentStage = parsed.current_situation || parsed.current_stage || '';
          targetStage = parsed.target_action || parsed.target_stage || '';

          // Get follow_up_number from AI response if provided
          if (parsed.follow_up_number) {
            aiFollowUpNumber = parseInt(parsed.follow_up_number, 10) || nextFollowUpNumber;
          }
        }
      }
    } catch {
      followupMessage = rawFollowup;
    }

    // If AI says no follow-up, return early
    if (noFollowUp) {
      return new Response(
        JSON.stringify({
          success: true,
          no_follow_up: true,
          no_follow_up_reason: noFollowUpReason
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 11. Format message based on 24h window (TEMPLATE MODE)
    let formattedMessage = followupMessage;
    if (!isWithin24h) {
      // Aggressively strip any greetings/closings the AI might have added
      formattedMessage = followupMessage
        // Remove greetings at start
        .replace(/^(hallo|hi|hey|guten tag|guten morgen|guten abend|liebe[r]?\s+\w+|moin)[,!.\s]*/i, '')
        // Remove name after greeting (e.g., "Max,")
        .replace(/^[A-ZÄÖÜ][a-zäöüß]+[,!]?\s*/i, '')
        // Remove closings at end
        .replace(/\s*(viele grüße|liebe grüße|mit freundlichen grüßen|freundliche grüße|mfg|lg|beste grüße|herzliche grüße)[!.,\s]*$/i, '')
        // Remove signature names
        .replace(/\s*[-–]\s*\w+\s*$/i, '')
        .trim();

      // The WhatsApp template will wrap the message with greeting and closing
      // So we just use the core message as-is
    }

    // 12. Delete any existing pending approvals for this lead (only ONE at a time)
    const { data: deletedApprovals, error: deleteError } = await supabase
      .from('followup_approvals')
      .delete()
      .eq('lead_id', lead_id)
      .eq('status', 'pending')
      .select('id');

    if (deletedApprovals && deletedApprovals.length > 0) {
      console.log(`[GenerateFollowup] Deleted ${deletedApprovals.length} existing pending approvals for lead ${lead_id}`);
    }

    // 13. Create pending approval record (only ONE per lead)
    const { data: approval, error: approvalError } = await supabase
      .from('followup_approvals')
      .insert({
        lead_id: lead_id,
        lead_name: lead.name || null,
        lead_email: lead.email || null,
        lead_phone: lead.phone || null,
        ghl_location_id: lead.ghl_location_id,
        location_name: connectionInfo?.location_name || null,
        suggested_message: formattedMessage,
        prompt_version_id: selectedPromptVersion?.id || null,
        conversation_summary: conversationSummary,
        last_messages: messages.slice(-10),
        follow_up_reason: followupReason,
        is_template_required: !isWithin24h,
        status: 'pending',
        suggested_follow_up_date: followUpDate,
        suggested_date_reason: dateReason,
        follow_up_number: aiFollowUpNumber
      })
      .select()
      .single();

    if (approvalError) {
      console.error('Failed to create approval:', approvalError);
    }

    const result: FollowupResult = {
      success: true,
      followup_message: followupMessage,
      is_within_24h: isWithin24h,
      formatted_message: formattedMessage,
      prompt_version_id: selectedPromptVersion?.id || null,
      conversation_summary: conversationSummary,
      followup_reason: followupReason,
      lead_name: lead.name || lead.email || 'Unbekannt',
      makler_name: connectionInfo?.location_name || null,
      follow_up_date: followUpDate,
      date_reason: dateReason,
      current_stage: currentStage,
      target_stage: targetStage,
      follow_up_number: aiFollowUpNumber,
    };

    return new Response(
      JSON.stringify(result),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );

  } catch (error) {
    console.error('Error:', error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function getDefaultPrompt(): string {
  // Fallback prompt - should normally use the one from database
  return `Du bist ein intelligenter Follow-Up Assistent. Antworte im JSON-Format.`;
}
