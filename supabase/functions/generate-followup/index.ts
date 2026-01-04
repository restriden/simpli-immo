/**
 * Generate Follow-up Edge Function
 *
 * Self-improving follow-up generation with:
 * - Prompt versioning for A/B testing
 * - 24h window template detection
 * - Training data collection
 */

import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

interface GenerateFollowupRequest {
  lead_id: string;
  gemini_api_key?: string;
}

interface FollowupResult {
  success: boolean;
  followup_message: string;
  is_within_24h: boolean;
  formatted_message: string; // With "Hallo ... Viele Grüße!" if outside 24h
  prompt_version_id: string | null;
  conversation_summary: string;
  followup_reason: string;
  lead_name: string;
  makler_name: string | null;
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

    // 1. Get Lead with GHL connection info
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
        connection:ghl_connections!inner (
          id,
          location_id,
          location_name,
          user_id
        )
      `)
      .eq('id', lead_id)
      .single();

    if (leadError || !lead) {
      return new Response(
        JSON.stringify({ error: "Lead not found", details: leadError?.message }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Get recent messages
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

    // 3. Check 24h window
    const lastIncomingMessage = messages
      .filter(m => m.type === 'incoming')
      .pop();

    let isWithin24h = false;
    if (lastIncomingMessage) {
      const hoursSinceLastMessage = (Date.now() - new Date(lastIncomingMessage.created_at).getTime()) / (1000 * 60 * 60);
      isWithin24h = hoursSinceLastMessage < 24;
    }

    // 4. Get active prompt version for A/B testing
    const { data: promptVersions } = await supabase
      .from('followup_prompt_versions')
      .select('*')
      .eq('is_active', true)
      .eq('category', 'standard_followup');

    let selectedPromptVersion = null;
    let promptTemplate = getDefaultPrompt();

    if (promptVersions && promptVersions.length > 0) {
      // Simple A/B: randomly select if multiple active
      selectedPromptVersion = promptVersions[Math.floor(Math.random() * promptVersions.length)];
      promptTemplate = selectedPromptVersion.prompt_template;
    }

    // 5. Build conversation context
    const conversationHistory = messages
      .map(m => `${m.type === 'incoming' ? 'Kunde' : 'Makler'}: ${m.content}`)
      .join('\n');

    // 6. Get subaccount assignment for form type (du/sie)
    const { data: assignment } = await supabase
      .from('subaccount_prompt_assignments')
      .select('form_type')
      .eq('location_id', lead.ghl_location_id)
      .single();

    const formType = assignment?.form_type || 'sie';

    // 7. Generate follow-up with Gemini
    const apiKey = gemini_api_key || Deno.env.get("GEMINI_API_KEY");
    if (!apiKey) {
      return new Response(
        JSON.stringify({ error: "No Gemini API key available" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const systemPrompt = promptTemplate
      .replace('{{FORM_TYPE}}', formType === 'du' ? 'Du' : 'Sie')
      .replace('{{IS_TEMPLATE}}', isWithin24h ? 'false' : 'true');

    const userPrompt = `
KONVERSATION:
${conversationHistory}

LEAD-INFO:
- Name: ${lead.name || 'Unbekannt'}
- E-Mail: ${lead.email || 'Nicht angegeben'}
- Telefon: ${lead.phone || 'Nicht angegeben'}

Generiere jetzt eine passende Follow-up Nachricht.
${isWithin24h ? '' : 'WICHTIG: Da das 24h-Fenster geschlossen ist, generiere NUR den Kerninhalt der Nachricht OHNE Anrede und Grußformel. Das System fügt "Hallo ... Viele Grüße!" automatisch hinzu.'}
`;

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`,
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
            maxOutputTokens: 500,
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

    // 8. Parse response - expect JSON with message and reason
    let followupMessage = rawFollowup;
    let followupReason = '';
    let conversationSummary = '';

    try {
      // Try to parse as JSON
      const jsonMatch = rawFollowup.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        followupMessage = parsed.message || parsed.followup_message || rawFollowup;
        followupReason = parsed.reason || parsed.followup_reason || '';
        conversationSummary = parsed.summary || parsed.conversation_summary || '';
      }
    } catch {
      // If not JSON, use raw text as message
      followupMessage = rawFollowup;
    }

    // 9. Format message based on 24h window
    let formattedMessage = followupMessage;
    if (!isWithin24h) {
      // Remove any existing greetings/closings the AI might have added
      formattedMessage = followupMessage
        .replace(/^(hallo|hi|hey|guten tag|liebe[r]?\s+\w+)[,!]?\s*/i, '')
        .replace(/\s*(viele grüße|liebe grüße|mit freundlichen grüßen|mfg|lg)[!.]?\s*$/i, '')
        .trim();

      // Apply template format
      formattedMessage = `Hallo ${followupMessage} Viele Grüße!`;
    }

    // 10. Create pending approval record
    const { data: approval, error: approvalError } = await supabase
      .from('followup_approvals')
      .insert({
        lead_id: lead_id,
        lead_name: lead.name || null,
        lead_email: lead.email || null,
        lead_phone: lead.phone || null,
        ghl_location_id: lead.ghl_location_id,
        location_name: lead.connection?.location_name || null,
        suggested_message: formattedMessage, // The formatted message ready to send
        prompt_version_id: selectedPromptVersion?.id || null,
        conversation_summary: conversationSummary,
        last_messages: messages.slice(-10),
        follow_up_reason: followupReason,
        is_template_required: !isWithin24h,
        status: 'pending'
      })
      .select()
      .single();

    if (approvalError) {
      console.error('Failed to create approval:', approvalError);
      // Continue anyway, just log the error
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
      makler_name: lead.connection?.location_name || null,
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
  return `Du bist ein erfahrener Immobilien-Follow-up-Spezialist. Deine Aufgabe ist es, eine personalisierte Follow-up Nachricht zu generieren.

ANREDEFORM: {{FORM_TYPE}}
TEMPLATE-MODUS: {{IS_TEMPLATE}}

REGELN:
1. Analysiere die Konversation und erkenne den aktuellen Stand
2. Generiere eine natürliche, persönliche Nachricht
3. Beziehe dich auf vorherige Gesprächspunkte
4. Halte die Nachricht kurz und prägnant (max 3-4 Sätze)
5. Wenn TEMPLATE-MODUS true ist: Generiere NUR den Kerninhalt OHNE "Hallo" am Anfang und OHNE "Viele Grüße" am Ende

Antworte im JSON-Format:
{
  "message": "Die Follow-up Nachricht",
  "reason": "Warum diese Nachricht jetzt sinnvoll ist",
  "summary": "Kurze Zusammenfassung der Konversation"
}`;
}
