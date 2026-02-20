import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

/**
 * EVA Performance: Conversation Analysis
 *
 * Analyzes ALL WhatsApp conversations in Makler accounts using Gemini 2.0 Flash.
 * Classifies lead temperature, conversion blockers, pitch quality, and intent signals.
 * Results are stored in lead_conversation_analysis table for the EVA Performance dashboard.
 *
 * Modes:
 * - No job_id: Start new analysis job (creates job, self-invokes for processing)
 * - With job_id: Continue existing job (process batch, self-invoke if more)
 * - full_rerun=true: Re-analyze ALL leads regardless of previous analysis
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Own accounts - not analyzed (not Makler customers)
const OWN_ACCOUNT_LOCATION_IDS: string[] = [
  "iDLo7b4WOOCkE9voshIM", // Simpli Finance GmbH
  "dI8ofFbKIogmLSUTvTFn", // simpli.immo
  "MAMK21fjL4Z52qgcvpgq", // simpli.bot
];

const SIMPLI_FINANCE_LOCATION_ID = "iDLo7b4WOOCkE9voshIM";

// Batch size - conversations can be long, keep smaller than sync-analyze-leads
const BATCH_SIZE = 10;

// Stage mapping for SF pipeline (same as sync-sf-opportunities)
const STAGE_MAPPING: Record<string, string> = {
  "finanzierungsberatung gebucht": "beratung_gebucht",
  "termin vereinbart": "beratung_gebucht",
  "unterlagen angefordert": "beratung_gebucht",
  "unterlagen in prufung": "beratung_gebucht",
  "finanzierungsbestatigung ausgestellt": "bestaetigung_ausgestellt",
  "finanzierbar aber objekt nicht gekauft": "bestaetigung_ausgestellt",
  "warte auf kreditentscheidung": "warte_auf_kredit",
  "vertrag unterschrieben": "vertrag_unterschrieben",
  "auszahlung erhalten": "auszahlung_erhalten",
  "finanzierung blockiert": "blockiert",
  "noshow": "no_show",
  "abgesagt": "abgesagt",
  "abgelehnt nicht geeignet lost": "abgelehnt",
};

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

function normalizeStageName(stageName: string): string {
  const stageKey = stageName
    .toLowerCase()
    .replace(/ü/g, "u")
    .replace(/ö/g, "o")
    .replace(/ä/g, "a")
    .replace(/ß/g, "ss")
    .replace(/[^\w\s]/g, "")
    .trim();
  return STAGE_MAPPING[stageKey] || stageName;
}

// Default analysis prompt - stored in code, can be overridden via system_settings
const DEFAULT_ANALYSIS_PROMPT = `Du bist ein Experte für Immobilien-Lead-Analyse. Du analysierst WhatsApp-Unterhaltungen zwischen einem KI-Assistenten namens "EVA" und Immobilien-Leads.

EVA arbeitet für Immobilienmakler und versucht, Leads für eine Finanzierungsberatung bei "Simpli Finance" zu begeistern und einen Termin zu buchen.

Analysiere die folgende Unterhaltung und den aktuellen Pipeline-Status des Leads.

## Unterhaltung:
{{conversation}}

## Lead-Info:
- Name: {{lead_name}}
- Erstellt am: {{created_at}}
- SF Pipeline Stage: {{sf_stage}}
- SF Tags: {{sf_tags}}
- Letzte Nachricht: {{last_message_at}}
- Tage seit letzter Nachricht: {{days_since_last_message}}

## Analyse-Aufgaben:

1. **Lead Temperature** (1-10 Score + Kategorie hot/warm/cold/dead):
   - 9-10 (hot): Aktives Interesse, fragt nach Details, bereit für Termin
   - 6-8 (warm): Zeigt Interesse, aber zögerlich oder braucht mehr Info
   - 3-5 (cold): Antwortet, aber kein echtes Interesse erkennbar
   - 1-2 (dead): Keine Antwort oder klare Absage

2. **Conversation Outcome**: Was ist das Ergebnis der Unterhaltung?
   Wähle GENAU EINEN der folgenden Werte:
   - termin_gebucht: Lead hat SF-Termin gebucht
   - termin_abgesagt: Lead hat Termin abgesagt
   - no_show: Lead ist nicht erschienen
   - interessiert_nicht_gebucht: Interesse gezeigt, aber nicht gebucht
   - kein_interesse: Kein Interesse an Finanzierung
   - nicht_erreicht: Lead hat nie geantwortet
   - unterhaltung_laeuft: Unterhaltung noch aktiv
   - abgebrochen: Unterhaltung abgebrochen (Lead antwortet nicht mehr)
   - nicht_qualifiziert: Lead passt nicht (z.B. Mieter, kein Käufer)
   - eigene_finanzierung: Hat eigene Finanzierung / Bank
   - sonstiges

3. **Primary Blocker**: Was ist der HAUPTGRUND warum der Lead NICHT gebucht hat?
   Wähle GENAU EINEN der folgenden Werte:
   - keine_antwort: Lead antwortet gar nicht
   - kein_interesse_finanzierung: Grundsätzlich kein Interesse an Finanzierung
   - hat_eigene_bank: Hat bereits Bank/Berater
   - zeitpunkt_passt_nicht: Will später / gerade nicht
   - vertrauen_fehlt: Misstrauen gegenüber Service
   - preis_zu_hoch: Finanzierung zu teuer / Konditionen
   - objekt_unklar: Hat noch kein konkretes Objekt
   - pitch_zu_schwach: EVA-Pitch war nicht überzeugend genug
   - pitch_zu_aggressiv: EVA war zu pushy
   - falsche_zielgruppe: Kein Käufer / nicht qualifiziert
   - technisch: Nachricht nicht zugestellt etc.
   - unbekannt: Nicht klar aus Unterhaltung
   - kein_blocker: Hat gebucht, kein Blocker vorhanden

4. **Pitch Quality** (1-10 Score + Kategorie excellent/good/average/poor/no_pitch):
   - Wie gut hat EVA den Simpli Finance Service gepitcht?
   - Hat EVA die Vorteile klar kommuniziert?
   - War der Pitch zum richtigen Zeitpunkt?
   - War der Ton angemessen (nicht zu aggressiv, nicht zu passiv)?

5. **Intent Signals**: Boolean-Flags
   - has_financing_need: Lead braucht Finanzierung
   - has_concrete_object: Lead hat konkretes Objekt im Blick
   - mentioned_budget: Budget/Eigenkapital erwähnt
   - mentioned_timeline: Zeitrahmen erwähnt
   - expressed_interest_sf: Interesse an Simpli Finance gezeigt
   - asked_questions: Lead hat Fragen zur Finanzierung gestellt

6. **Pitch Feedback**: 1-2 Sätze was am Pitch gut oder schlecht war

7. **Summary**: 2-3 Sätze die die Unterhaltung zusammenfassen

8. **Key Insights**: Die 1-2 wichtigsten Erkenntnisse aus dieser Unterhaltung

9. **Improvement Suggestion**: Was hätte EVA besser machen können? 1-2 konkrete Vorschläge.

Antworte NUR mit validem JSON (kein Markdown, keine Erklärung):
{
  "temperature_score": <number 1-10>,
  "lead_temperature": "<hot|warm|cold|dead>",
  "conversation_outcome": "<einer der oben genannten Werte>",
  "primary_blocker": "<einer der oben genannten Werte>",
  "pitch_quality_score": <number 1-10>,
  "pitch_quality": "<excellent|good|average|poor|no_pitch>",
  "pitch_feedback": "<string>",
  "has_financing_need": <boolean>,
  "has_concrete_object": <boolean>,
  "mentioned_budget": <boolean>,
  "mentioned_timeline": <boolean>,
  "expressed_interest_sf": <boolean>,
  "asked_questions": <boolean>,
  "conversation_summary": "<string>",
  "key_insights": "<string>",
  "improvement_suggestion": "<string>"
}`;

// Self-invoke to continue processing in background
function continueInBackground(
  supabaseUrl: string,
  supabaseKey: string,
  jobId: string,
  fullRerun: boolean,
  geminiKey: string
) {
  console.log(`[analyze-conversations] Triggering continuation for job ${jobId}`);

  fetch(`${supabaseUrl}/functions/v1/analyze-conversations`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({
      job_id: jobId,
      full_rerun: fullRerun,
      gemini_api_key: geminiKey,
    })
  }).then(response => {
    if (!response.ok) {
      console.error(`[analyze-conversations] Continuation returned status ${response.status}`);
    }
  }).catch(err => {
    console.error(`[analyze-conversations] Continuation failed for job ${jobId}:`, err);
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const {
      full_rerun = false,
      job_id,
      gemini_api_key,
    } = await req.json().catch(() => ({}));

    const geminiKey = gemini_api_key || Deno.env.get('GEMINI_API_KEY');

    if (!geminiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'GEMINI_API_KEY nicht konfiguriert' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Load custom prompt from system_settings (if exists)
    let analysisPrompt = DEFAULT_ANALYSIS_PROMPT;
    try {
      const { data: promptSetting } = await supabase
        .from('system_settings')
        .select('value')
        .eq('key', 'conversation_analysis_prompt')
        .single();

      if (promptSetting?.value?.prompt) {
        analysisPrompt = promptSetting.value.prompt;
        console.log('[analyze-conversations] Using custom prompt from system_settings');
      }
    } catch {
      // No custom prompt, use default
    }

    // ============ MODE 1: START NEW JOB ============
    if (!job_id) {
      console.log(`[analyze-conversations] Starting new job (full_rerun=${full_rerun})`);

      // Count leads that need analysis
      // Step 1: Get all Makler leads (excl own accounts)
      const { data: allLeads, error: leadsError } = await supabase
        .from('leads')
        .select('id, ghl_location_id, is_archived')
        .not('ghl_location_id', 'in', `(${OWN_ACCOUNT_LOCATION_IDS.join(',')})`)
        .eq('is_archived', false);

      if (leadsError) {
        return new Response(
          JSON.stringify({ success: false, error: 'Fehler beim Laden der Leads: ' + leadsError.message }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }

      const allLeadIds = (allLeads || []).map(l => l.id);

      if (allLeadIds.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: 'Keine Leads zu analysieren' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      let leadsToAnalyzeCount = allLeadIds.length;

      if (!full_rerun) {
        // Incremental: Only leads that are new or have new messages since last analysis
        // Get existing analyses
        const { data: existingAnalyses } = await supabase
          .from('lead_conversation_analysis')
          .select('lead_id, last_message_analyzed_at')
          .in('lead_id', allLeadIds);

        const analysisMap = new Map<string, string>();
        (existingAnalyses || []).forEach(a => {
          if (a.last_message_analyzed_at) {
            analysisMap.set(a.lead_id, a.last_message_analyzed_at);
          }
        });

        // For leads with existing analysis, check if they have new messages
        // For leads without analysis, always include them
        const leadsNeedingAnalysis = allLeadIds.filter(id => !analysisMap.has(id));

        // For leads with analysis, we'll check messages in the processing loop
        // For now, count conservatively
        leadsToAnalyzeCount = allLeadIds.length; // We'll filter during processing
      }

      // Create job record
      const { data: job, error: jobError } = await supabase
        .from('analysis_jobs')
        .insert({
          status: 'running',
          total_leads: leadsToAnalyzeCount,
          analyzed_leads: 0,
          skipped_no_messages: 0,
          failed_leads: 0,
          started_at: new Date().toISOString()
        })
        .select()
        .single();

      if (jobError || !job) {
        return new Response(
          JSON.stringify({ success: false, error: 'Fehler beim Erstellen des Jobs' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }

      // Self-invoke for background processing
      continueInBackground(supabaseUrl, supabaseKey, job.id, full_rerun, geminiKey);

      return new Response(
        JSON.stringify({
          success: true,
          job_id: job.id,
          total_leads: leadsToAnalyzeCount,
          message: `Conversation-Analyse gestartet für ${leadsToAnalyzeCount} Leads`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============ MODE 2: CONTINUE EXISTING JOB ============
    const { data: job, error: jobError } = await supabase
      .from('analysis_jobs')
      .select('*')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      return new Response(
        JSON.stringify({ success: false, error: 'Job nicht gefunden' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (job.status === 'completed' || job.status === 'failed') {
      return new Response(
        JSON.stringify({ success: true, job, message: 'Job bereits abgeschlossen' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get leads that need analysis
    // Fetch all Makler leads ordered by id for consistent batching
    const { data: allLeadsRaw } = await supabase
      .from('leads')
      .select('id, ghl_location_id, name, email, phone, created_at, is_archived, last_message_at')
      .not('ghl_location_id', 'in', `(${OWN_ACCOUNT_LOCATION_IDS.join(',')})`)
      .eq('is_archived', false)
      .order('id', { ascending: true });

    // Get existing conversation analyses for incremental check
    const allLeadIds = (allLeadsRaw || []).map(l => l.id);
    const { data: existingAnalyses } = await supabase
      .from('lead_conversation_analysis')
      .select('lead_id, last_message_analyzed_at, analyzed_at')
      .in('lead_id', allLeadIds.slice(0, 1000)); // Supabase limit

    // Get remaining if > 1000
    let allExistingAnalyses = existingAnalyses || [];
    if (allLeadIds.length > 1000) {
      const { data: moreAnalyses } = await supabase
        .from('lead_conversation_analysis')
        .select('lead_id, last_message_analyzed_at, analyzed_at')
        .in('lead_id', allLeadIds.slice(1000));
      allExistingAnalyses = [...allExistingAnalyses, ...(moreAnalyses || [])];
    }

    const analysisMap = new Map<string, { last_message_analyzed_at: string | null; analyzed_at: string }>();
    allExistingAnalyses.forEach(a => {
      analysisMap.set(a.lead_id, {
        last_message_analyzed_at: a.last_message_analyzed_at,
        analyzed_at: a.analyzed_at,
      });
    });

    // Filter leads: skip those already analyzed in THIS job run
    const jobStartedAt = new Date(job.started_at);
    const filteredLeads = (allLeadsRaw || []).filter(lead => {
      const existing = analysisMap.get(lead.id);

      // If analyzed in THIS job run, skip
      if (existing && new Date(existing.analyzed_at) >= jobStartedAt) {
        return false;
      }

      // If full_rerun, always include
      if (full_rerun) return true;

      // If no existing analysis, include
      if (!existing) return true;

      // If existing analysis but lead has newer messages, include
      if (existing.last_message_analyzed_at && lead.last_message_at) {
        return new Date(lead.last_message_at) > new Date(existing.last_message_analyzed_at);
      }

      // If we have analysis but no last_message_analyzed_at, re-analyze
      if (!existing.last_message_analyzed_at) return true;

      return false;
    });

    console.log(`[analyze-conversations] Job ${job_id}: ${allLeadsRaw?.length || 0} total leads, ${filteredLeads.length} remaining`);

    // Take batch
    const batch = filteredLeads.slice(0, BATCH_SIZE);

    if (batch.length === 0) {
      // Done!
      await supabase
        .from('analysis_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', job_id);

      console.log(`[analyze-conversations] Job ${job_id} completed`);

      return new Response(
        JSON.stringify({ success: true, job_id, status: 'completed' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Load messages for batch
    const batchLeadIds = batch.map(l => l.id);
    const { data: allMessages } = await supabase
      .from('messages')
      .select('id, lead_id, content, type, created_at')
      .in('lead_id', batchLeadIds)
      .order('created_at', { ascending: true });

    // Group messages by lead
    const messagesByLead: Record<string, any[]> = {};
    (allMessages || []).forEach(msg => {
      if (!messagesByLead[msg.lead_id]) {
        messagesByLead[msg.lead_id] = [];
      }
      messagesByLead[msg.lead_id].push(msg);
    });

    // Load SF leads for pipeline enrichment
    // Get all SF leads and build phone lookup
    const { data: sfLeads } = await supabase
      .from('leads')
      .select('id, phone, sf_pipeline_stage, ghl_tags')
      .eq('ghl_location_id', SIMPLI_FINANCE_LOCATION_ID);

    const sfLeadsByPhone = new Map<string, { stage: string | null; tags: string[] }>();
    (sfLeads || []).forEach(sfLead => {
      const phone = normalizePhone(sfLead.phone);
      if (phone) {
        sfLeadsByPhone.set(phone, {
          stage: sfLead.sf_pipeline_stage || null,
          tags: sfLead.ghl_tags || [],
        });
      }
    });

    // Get location names for context
    const { data: connections } = await supabase
      .from('ghl_connections')
      .select('location_id, location_name')
      .eq('is_active', true);

    const locationNames = new Map<string, string>();
    (connections || []).forEach(c => {
      locationNames.set(c.location_id, c.location_name || 'Unbekannt');
    });

    const now = new Date().toISOString();
    let analyzedCount = 0;
    let skippedCount = 0;
    let failedCount = 0;

    // Process each lead
    const analysisPromises = batch.map(async (lead) => {
      const messages = messagesByLead[lead.id] || [];

      // Filter system messages
      const realMessages = messages.filter((m: any) =>
        m.content &&
        !m.content.startsWith('Opportunity created') &&
        !m.content.startsWith('Opportunity updated')
      );

      const incomingMessages = realMessages.filter((m: any) => m.type === 'incoming');
      const outgoingMessages = realMessages.filter((m: any) => m.type === 'outgoing');

      // Calculate message metrics
      const totalMessages = realMessages.length;
      const firstMessageAt = realMessages.length > 0 ? realMessages[0].created_at : null;
      const lastMessageAt = realMessages.length > 0 ? realMessages[realMessages.length - 1].created_at : null;

      // Calculate average response time (time between outgoing → incoming)
      let totalResponseTime = 0;
      let responseCount = 0;
      for (let i = 1; i < realMessages.length; i++) {
        if (realMessages[i].type === 'incoming' && realMessages[i - 1].type === 'outgoing') {
          const respTime = new Date(realMessages[i].created_at).getTime() - new Date(realMessages[i - 1].created_at).getTime();
          if (respTime > 0 && respTime < 7 * 24 * 60 * 60 * 1000) { // Max 7 days
            totalResponseTime += respTime;
            responseCount++;
          }
        }
      }
      const avgResponseTimeMinutes = responseCount > 0
        ? Math.round(totalResponseTime / responseCount / 60000)
        : null;

      // Get SF pipeline data via phone matching
      const phone = normalizePhone(lead.phone);
      const sfData = phone ? sfLeadsByPhone.get(phone) : null;
      const sfStage = sfData?.stage || null;
      const sfTags = sfData?.tags || [];

      // Handle leads with no messages or no incoming messages
      if (totalMessages === 0) {
        return {
          leadId: lead.id,
          type: 'skip_no_messages' as const,
          data: {
            lead_id: lead.id,
            location_id: lead.ghl_location_id,
            total_messages: 0,
            incoming_messages: 0,
            outgoing_messages: 0,
            first_message_at: null,
            last_message_at: null,
            avg_response_time_minutes: null,
            lead_temperature: 'dead' as const,
            temperature_score: 1,
            conversation_outcome: 'nicht_erreicht' as const,
            primary_blocker: 'keine_antwort' as const,
            pitch_quality: 'no_pitch' as const,
            pitch_quality_score: 1,
            pitch_feedback: 'Keine Nachrichten vorhanden',
            has_financing_need: false,
            has_concrete_object: false,
            mentioned_budget: false,
            mentioned_timeline: false,
            expressed_interest_sf: false,
            asked_questions: false,
            conversation_summary: 'Noch keine Unterhaltung geführt.',
            key_insights: 'Kein Kontakt hergestellt.',
            improvement_suggestion: 'Erstkontakt herstellen.',
            sf_pipeline_stage: sfStage,
            sf_tags: sfTags,
            analyzed_at: now,
            messages_analyzed_count: 0,
            last_message_analyzed_at: null,
            updated_at: now,
          }
        };
      }

      if (incomingMessages.length === 0) {
        return {
          leadId: lead.id,
          type: 'skip_no_response' as const,
          data: {
            lead_id: lead.id,
            location_id: lead.ghl_location_id,
            total_messages: totalMessages,
            incoming_messages: 0,
            outgoing_messages: outgoingMessages.length,
            first_message_at: firstMessageAt,
            last_message_at: lastMessageAt,
            avg_response_time_minutes: null,
            lead_temperature: 'dead' as const,
            temperature_score: 1,
            conversation_outcome: 'nicht_erreicht' as const,
            primary_blocker: 'keine_antwort' as const,
            pitch_quality: outgoingMessages.length > 0 ? 'average' as const : 'no_pitch' as const,
            pitch_quality_score: outgoingMessages.length > 0 ? 5 : 1,
            pitch_feedback: 'Lead hat nicht geantwortet - Pitch-Qualität kann nicht bewertet werden.',
            has_financing_need: false,
            has_concrete_object: false,
            mentioned_budget: false,
            mentioned_timeline: false,
            expressed_interest_sf: false,
            asked_questions: false,
            conversation_summary: `EVA hat ${outgoingMessages.length} Nachrichten gesendet, aber keine Antwort erhalten.`,
            key_insights: 'Lead reagiert nicht auf Nachrichten.',
            improvement_suggestion: 'Alternative Kontaktmethode oder ansprechendere Erstansprache versuchen.',
            sf_pipeline_stage: sfStage,
            sf_tags: sfTags,
            analyzed_at: now,
            messages_analyzed_count: totalMessages,
            last_message_analyzed_at: lastMessageAt,
            updated_at: now,
          }
        };
      }

      // Build conversation text (limit to last 60 messages for context)
      const recentMessages = realMessages.slice(-60);
      const conversationText = recentMessages.map((m: any) => {
        const role = m.type === 'incoming' ? 'Lead' : 'EVA';
        const date = new Date(m.created_at);
        const dateStr = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}. ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
        return `[${dateStr}] ${role}: ${m.content}`;
      }).join('\n');

      // Days since last message
      const daysSinceLastMessage = lastMessageAt
        ? Math.floor((Date.now() - new Date(lastMessageAt).getTime()) / (1000 * 60 * 60 * 24))
        : 0;

      // Build prompt with placeholders replaced
      const promptWithData = analysisPrompt
        .replace('{{conversation}}', conversationText)
        .replace('{{lead_name}}', lead.name || 'Unbekannt')
        .replace('{{created_at}}', new Date(lead.created_at).toLocaleDateString('de-DE'))
        .replace('{{sf_stage}}', sfStage || 'nicht in Pipeline')
        .replace('{{sf_tags}}', sfTags.length > 0 ? sfTags.join(', ') : 'keine')
        .replace('{{last_message_at}}', lastMessageAt ? new Date(lastMessageAt).toLocaleDateString('de-DE') : 'unbekannt')
        .replace('{{days_since_last_message}}', String(daysSinceLastMessage));

      try {
        // Call Gemini 2.0 Flash
        const analysisResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: promptWithData }]
              }],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 2048,
              }
            })
          }
        );

        if (!analysisResponse.ok) {
          const errorText = await analysisResponse.text();
          console.error(`[analyze-conversations] Gemini API error for ${lead.id}:`, errorText);
          return { leadId: lead.id, type: 'error' as const, error: 'Gemini API error' };
        }

        const analysisData = await analysisResponse.json();
        const content = analysisData.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // Clean markdown and extract JSON
        const cleanedContent = content
          .replace(/```json\s*/gi, '')
          .replace(/```\s*/g, '')
          .trim();

        const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);
        if (!jsonMatch) {
          console.error(`[analyze-conversations] No JSON in response for ${lead.id}:`, content.substring(0, 200));
          return { leadId: lead.id, type: 'error' as const, error: 'No JSON in response' };
        }

        const analysis = JSON.parse(jsonMatch[0]);

        // Use SF pipeline data to override outcome if we have concrete pipeline info
        let conversationOutcome = analysis.conversation_outcome || 'sonstiges';
        let primaryBlocker = analysis.primary_blocker || 'unbekannt';

        // Override with SF pipeline data if available
        if (sfStage) {
          if (sfStage.includes('no_show')) {
            conversationOutcome = 'no_show';
          } else if (sfStage.includes('abgesagt')) {
            conversationOutcome = 'termin_abgesagt';
          } else if (sfStage.includes('beratung') || sfStage.includes('bestaetigung') ||
                     sfStage.includes('warte') || sfStage.includes('vertrag') ||
                     sfStage.includes('auszahlung')) {
            conversationOutcome = 'termin_gebucht';
            primaryBlocker = 'kein_blocker';
          }
        }

        return {
          leadId: lead.id,
          type: 'analyzed' as const,
          data: {
            lead_id: lead.id,
            location_id: lead.ghl_location_id,
            total_messages: totalMessages,
            incoming_messages: incomingMessages.length,
            outgoing_messages: outgoingMessages.length,
            first_message_at: firstMessageAt,
            last_message_at: lastMessageAt,
            avg_response_time_minutes: avgResponseTimeMinutes,
            lead_temperature: analysis.lead_temperature || 'cold',
            temperature_score: Math.max(1, Math.min(10, analysis.temperature_score || 5)),
            conversation_outcome: conversationOutcome,
            primary_blocker: primaryBlocker,
            pitch_quality: analysis.pitch_quality || 'average',
            pitch_quality_score: Math.max(1, Math.min(10, analysis.pitch_quality_score || 5)),
            pitch_feedback: analysis.pitch_feedback || '',
            has_financing_need: !!analysis.has_financing_need,
            has_concrete_object: !!analysis.has_concrete_object,
            mentioned_budget: !!analysis.mentioned_budget,
            mentioned_timeline: !!analysis.mentioned_timeline,
            expressed_interest_sf: !!analysis.expressed_interest_sf,
            asked_questions: !!analysis.asked_questions,
            conversation_summary: analysis.conversation_summary || '',
            key_insights: analysis.key_insights || '',
            improvement_suggestion: analysis.improvement_suggestion || '',
            sf_pipeline_stage: sfStage,
            sf_tags: sfTags,
            analyzed_at: now,
            messages_analyzed_count: totalMessages,
            last_message_analyzed_at: lastMessageAt,
            updated_at: now,
          }
        };

      } catch (e) {
        console.error(`[analyze-conversations] Analysis error for ${lead.id}:`, e);
        return { leadId: lead.id, type: 'error' as const, error: e.message };
      }
    });

    // Wait for all analyses
    const results = await Promise.all(analysisPromises);

    // Upsert results into lead_conversation_analysis
    for (const result of results) {
      if (result.type === 'error') {
        failedCount++;
        continue;
      }

      if (result.type === 'skip_no_messages') {
        skippedCount++;
      } else if (result.type === 'skip_no_response') {
        skippedCount++;
      } else {
        analyzedCount++;
      }

      // Upsert into lead_conversation_analysis
      try {
        const { error: upsertError } = await supabase
          .from('lead_conversation_analysis')
          .upsert(result.data, {
            onConflict: 'lead_id',
          });

        if (upsertError) {
          console.error(`[analyze-conversations] Upsert error for ${result.leadId}:`, upsertError);
          failedCount++;
          if (result.type !== 'error') analyzedCount--;
        }
      } catch (e) {
        console.error(`[analyze-conversations] Upsert exception for ${result.leadId}:`, e);
        failedCount++;
      }
    }

    // Update job progress
    const { data: updatedJob } = await supabase
      .from('analysis_jobs')
      .update({
        analyzed_leads: (job.analyzed_leads || 0) + analyzedCount,
        skipped_no_messages: (job.skipped_no_messages || 0) + skippedCount,
        failed_leads: (job.failed_leads || 0) + failedCount,
      })
      .eq('id', job_id)
      .select()
      .single();

    // Check if more leads to process
    const totalProcessed = batch.length;
    const remainingLeads = filteredLeads.length - totalProcessed;
    const isComplete = remainingLeads <= 0;

    console.log(`[analyze-conversations] Job ${job_id}: batch=${totalProcessed}, analyzed=${analyzedCount}, skipped=${skippedCount}, failed=${failedCount}, remaining=${remainingLeads}`);

    if (isComplete) {
      await supabase
        .from('analysis_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', job_id);

      console.log(`[analyze-conversations] Job ${job_id} completed!`);
    } else {
      // Continue processing
      continueInBackground(supabaseUrl, supabaseKey, job_id, full_rerun, geminiKey);
    }

    return new Response(
      JSON.stringify({
        success: true,
        job_id,
        status: isComplete ? 'completed' : 'running',
        batch_analyzed: analyzedCount,
        batch_skipped: skippedCount,
        batch_failed: failedCount,
        remaining: remainingLeads,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('[analyze-conversations] Error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
