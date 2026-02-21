// Using Deno.serve (built-in) instead of legacy import
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

/**
 * EVA Performance: Multi-Step Conversation Analysis (v2)
 *
 * 2-Phase Architecture:
 *   Phase 1: AI Analysis per lead (conversation-focused, NO SF pipeline knowledge)
 *   Phase 2: SF Pipeline Enrichment (data join from leads table, no AI)
 *
 * The AI prompt analyzes ONLY what's IN the conversation:
 *   - Property interest (genuine buyer vs viewing tourist)
 *   - Conversation flow (where it breaks off, who wrote last)
 *   - Lead scoring (response speed, tone, engagement)
 *   - EVA pitch quality (visible in messages)
 *
 * SF pipeline data is added AFTER the AI analysis as a separate enrichment step.
 */

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Own accounts - not analyzed
const OWN_ACCOUNT_LOCATION_IDS: string[] = [
  "iDLo7b4WOOCkE9voshIM", // Simpli Finance GmbH
  "dI8ofFbKIogmLSUTvTFn", // simpli.immo
  "MAMK21fjL4Z52qgcvpgq", // simpli.bot
];

const SIMPLI_FINANCE_LOCATION_ID = "iDLo7b4WOOCkE9voshIM";
const BATCH_SIZE = 10;

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

// Default analysis prompt - conversation-focused, NO SF pipeline data
const DEFAULT_ANALYSIS_PROMPT = `Du bist ein Experte für Immobilien-Lead-Analyse. Du analysierst WhatsApp-Unterhaltungen zwischen einem KI-Assistenten namens "EVA" und Immobilien-Leads.

EVA arbeitet für Immobilienmakler. Sie kontaktiert Leads die Interesse an Immobilien gezeigt haben. EVA versucht:
1. Das Interesse des Leads an der Immobilie zu qualifizieren
2. Einen Termin für eine kostenlose Finanzierungsberatung bei "Simpli Finance" zu buchen

## Unterhaltung:
{{conversation}}

## Lead-Info:
- Name: {{lead_name}}
- Erstellt am: {{created_at}}
- Letzte Nachricht: {{last_message_at}}
- Tage seit letzter Nachricht: {{days_since_last_message}}
- Anzahl Nachrichten: {{total_messages}} (Lead: {{incoming_count}}, EVA: {{outgoing_count}})

## Analyse-Aufgaben:

1. **IMMOBILIEN-INTERESSE** - Hat der Lead am Ende des Gesprächs noch Interesse an der Immobilie?
   - Falls Interesse verloren: Warum genau? (z.B. Preis zu hoch, anderes Objekt gefunden, nur geguckt, etc.)
   - Bewertung: stark / mittel / gering / kein / unklar

2. **GESPRÄCHS-VERLAUF** - Wo genau bricht die Unterhaltung ab?
   - Nach welcher Nachricht / welchem Thema wurde das Gespräch beendet oder pausiert?
   - Wer hat zuletzt geschrieben (Lead oder EVA)?
   - Beschreibe den Abbruchpunkt in 1-2 Sätzen.

3. **LEAD-SCORING**
   - Antwort-Verhalten: Wie schnell antwortet der Lead typischerweise?
     sehr_schnell (Minuten) / schnell (< 1 Stunde) / normal (Stunden) / langsam (Tage) / keine_antwort
   - Ton des Leads: begeistert / freundlich / neutral / skeptisch / ablehnend / unklar
   - Lead-Typ: Echter Kaufinteressent, Besichtigungstourist (schaut nur), Investor, oder unklar?
   - Engagement-Score (1-10): Gesamtbewertung wie engagiert der Lead ist
     (10 = sehr engagiert, stellt Fragen, antwortet schnell; 1 = gar nicht engagiert)

4. **LEAD-TEMPERATUR** (1-10 Score + Kategorie)
   Basierend auf Immobilien-Interesse + Engagement + Antwortverhalten:
   - 9-10 (hot): Aktives Interesse, fragt nach Details, bereit für Termin
   - 6-8 (warm): Zeigt Interesse, aber zögerlich oder braucht mehr Info
   - 3-5 (cold): Antwortet, aber kein echtes Interesse erkennbar
   - 1-2 (dead): Keine Antwort oder klare Absage

5. **GESPRÄCHS-ERGEBNIS** - Was ist das Ergebnis der Unterhaltung?
   Wähle GENAU EINEN Wert:
   - termin_gebucht: Lead hat SF-Termin gebucht
   - interessiert_nicht_gebucht: Interesse gezeigt, aber nicht gebucht
   - kein_interesse: Kein Interesse an Finanzierung/Immobilie
   - nicht_erreicht: Lead hat nie geantwortet
   - unterhaltung_laeuft: Unterhaltung noch aktiv
   - abgebrochen: Unterhaltung abgebrochen (Lead antwortet nicht mehr)
   - nicht_qualifiziert: Lead passt nicht (z.B. Mieter, kein Käufer)
   - sonstiges

6. **CONVERSION-BLOCKER** - Hauptgrund warum der Lead nicht weiter konvertiert
   Wähle GENAU EINEN Wert:
   - keine_antwort: Lead antwortet gar nicht
   - kein_interesse: Grundsätzlich kein Interesse
   - zeitpunkt_passt_nicht: Will später / gerade nicht
   - vertrauen_fehlt: Misstrauen gegenüber Service
   - preis_zu_hoch: Immobilie/Finanzierung zu teuer
   - objekt_unklar: Hat noch kein konkretes Objekt
   - falsche_zielgruppe: Kein Käufer / nicht qualifiziert
   - hat_eigene_bank: Hat bereits eigene Bank/Berater
   - unbekannt: Nicht klar aus Unterhaltung
   - kein_blocker: Hat gebucht oder Unterhaltung läuft noch positiv

7. **EVA PITCH-QUALITÄT** - Nur bewerten wenn EVA Simpli Finance erwähnt hat
   - Hat EVA Simpli Finance überhaupt erwähnt? Wenn nein: no_pitch
   - Score 1-10 + Kategorie: excellent / good / average / poor / no_pitch
   - Was hätte EVA besser machen können? (1-2 Sätze)

8. **INTENT-SIGNALE** (Boolean)
   - has_financing_need: Lead braucht Finanzierung
   - has_concrete_object: Lead hat konkretes Objekt im Blick
   - mentioned_budget: Budget/Eigenkapital erwähnt
   - mentioned_timeline: Zeitrahmen erwähnt
   - expressed_interest_sf: Interesse an Simpli Finance gezeigt
   - asked_questions: Lead hat Fragen gestellt

9. **FINANZIERUNG**
   - Wollte der Lead eine Finanzierung? (ja/nein)
   - Falls nein: Warum nicht? (1 Satz, z.B. "hat eigene Bank", "kein Kaufinteresse", "nur gemietet", etc.)
   - Falls aus dem Gespräch nicht erkennbar: finanzierung_gewollt = false, Grund = "nicht thematisiert"

10. **AI-EINSCHÄTZUNG**
   - Erkläre in 1-2 Sätzen WARUM du den Lead so eingeschätzt hast.
   - Sei konkret und nenne Belege aus dem Gespräch. Beispiele:
     "Lead fragt nur nach Grundriss und Lage, zeigt kein Kaufinteresse - typischer Besichtigungstourist"
     "Hat nach Finanzierungskonditionen gefragt und Eigenkapital erwähnt - echter Kaufinteressent"
     "Lead hat nach Terminvorschlag nicht mehr geantwortet - Interesse wahrscheinlich erloschen"

11. **ZUSAMMENFASSUNG**
   - conversation_summary: 2-3 Sätze Zusammenfassung
   - key_insights: 1-2 wichtigste Erkenntnisse
   - improvement_suggestion: Konkreter Vorschlag was EVA besser machen könnte

Antworte NUR mit validem JSON (kein Markdown, keine Erklärung):
{
  "immobilien_interesse": "<stark|mittel|gering|kein|unklar>",
  "interesse_verlust_grund": "<string oder null wenn Interesse noch da>",
  "abbruch_punkt": "<string - Beschreibung wo/warum Gespräch endet>",
  "lead_typ": "<kaufinteressent|besichtigungstourist|investor|unklar>",
  "antwort_verhalten": "<sehr_schnell|schnell|normal|langsam|keine_antwort>",
  "ton_analyse": "<begeistert|freundlich|neutral|skeptisch|ablehnend|unklar>",
  "engagement_score": <number 1-10>,
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
  "finanzierung_gewollt": <boolean>,
  "finanzierung_ablehnungsgrund": "<string oder null wenn finanzierung_gewollt=true>",
  "ai_einschaetzung": "<string - 1-2 Sätze konkrete Begründung der Einschätzung>",
  "conversation_summary": "<string>",
  "key_insights": "<string>",
  "improvement_suggestion": "<string>"
}`;

Deno.serve(async (req) => {
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

    // ============ MODE 1: START NEW JOB (if no job_id, create one then fall through) ============
    let activeJobId = job_id;

    if (!activeJobId) {
      console.log(`[analyze-conversations] Starting new job (full_rerun=${full_rerun})`);

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

      const { data: newJob, error: newJobError } = await supabase
        .from('analysis_jobs')
        .insert({
          status: 'running',
          total_leads: allLeadIds.length,
          analyzed_leads: 0,
          skipped_no_messages: 0,
          failed_leads: 0,
          started_at: new Date().toISOString()
        })
        .select()
        .single();

      if (newJobError || !newJob) {
        return new Response(
          JSON.stringify({ success: false, error: 'Fehler beim Erstellen des Jobs' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }

      activeJobId = newJob.id;
      console.log(`[analyze-conversations] Created job ${activeJobId} for ${allLeadIds.length} leads, falling through to processing`);
    }

    // ============ MODE 2: PROCESS JOB IN A LOOP ============
    const invocationStart = Date.now();
    const TIME_LIMIT_MS = 50_000; // 50s guard for 60s Edge Function timeout

    const { data: job, error: jobError } = await supabase
      .from('analysis_jobs')
      .select('*')
      .eq('id', activeJobId)
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

    // Load SF data once (used across all batches)
    const { data: sfLeads } = await supabase
      .from('leads')
      .select('id, phone, sf_pipeline_stage, ghl_tags')
      .eq('ghl_location_id', SIMPLI_FINANCE_LOCATION_ID);

    const sfLeadsByPhone = new Map();
    (sfLeads || []).forEach(sfLead => {
      const phone = normalizePhone(sfLead.phone);
      if (phone) {
        sfLeadsByPhone.set(phone, {
          stage: sfLead.sf_pipeline_stage || null,
          tags: sfLead.ghl_tags || [],
        });
      }
    });

    let totalAnalyzedCount = 0;
    let totalSkippedCount = 0;
    let totalFailedCount = 0;
    let totalBatches = 0;
    let remainingLeads = 0;
    let timedOut = false;
    const verifyHistory: any[] = []; // Track DB row counts after each batch

    // === LOAD ALL LEADS ONCE (with proper pagination to get ALL rows) ===
    let allLeadsRaw: any[] = [];
    let page = 0;
    const PAGE_SIZE = 1000;
    while (true) {
      const { data: pageData, error: pageErr } = await supabase
        .from('leads')
        .select('id, ghl_location_id, name, email, phone, created_at, is_archived, last_message_at, sf_pipeline_stage, ghl_tags, booking_page_visited, booking_page_visited_at')
        .not('ghl_location_id', 'in', `(${OWN_ACCOUNT_LOCATION_IDS.join(',')})`)
        .eq('is_archived', false)
        .order('id', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);

      if (pageErr || !pageData || pageData.length === 0) break;
      allLeadsRaw = [...allLeadsRaw, ...pageData];
      if (pageData.length < PAGE_SIZE) break;
      page++;
    }
    console.log(`[analyze-conversations] Loaded ${allLeadsRaw.length} total leads`);

    // Get existing analyses for incremental check
    const allLeadIds = allLeadsRaw.map(l => l.id);
    let allExistingAnalyses: any[] = [];
    for (let i = 0; i < allLeadIds.length; i += 1000) {
      const chunk = allLeadIds.slice(i, i + 1000);
      const { data: chunkAnalyses } = await supabase
        .from('lead_conversation_analysis')
        .select('lead_id, last_message_analyzed_at, analyzed_at')
        .in('lead_id', chunk);
      if (chunkAnalyses) allExistingAnalyses = [...allExistingAnalyses, ...chunkAnalyses];
    }

    const analysisMap = new Map();
    allExistingAnalyses.forEach(a => {
      analysisMap.set(a.lead_id, {
        last_message_analyzed_at: a.last_message_analyzed_at,
        analyzed_at: a.analyzed_at,
      });
    });

    // Filter leads that need processing
    const jobStartedAt = new Date(job.started_at);
    const filteredLeads = allLeadsRaw.filter(lead => {
      const existing = analysisMap.get(lead.id);
      if (existing && new Date(existing.analyzed_at) >= jobStartedAt) return false;
      if (full_rerun) return true;
      if (!existing) return true;
      if (existing.last_message_analyzed_at && lead.last_message_at) {
        return new Date(lead.last_message_at) > new Date(existing.last_message_analyzed_at);
      }
      if (!existing.last_message_analyzed_at) return true;
      return false;
    });

    console.log(`[analyze-conversations] ${filteredLeads.length} leads to process, ${allExistingAnalyses.length} already analyzed`);

    // Track processed lead index
    let leadIndex = 0;

    // === BATCH LOOP: process all leads in batches of BATCH_SIZE ===
    while (leadIndex < filteredLeads.length) {
      // Time guard: stop before the 60s Edge Function timeout
      const elapsed = Date.now() - invocationStart;
      if (elapsed > TIME_LIMIT_MS) {
        console.log(`[analyze-conversations] Job ${activeJobId}: Time guard hit at ${elapsed}ms, stopping to avoid timeout`);
        timedOut = true;
        break;
      }

      remainingLeads = filteredLeads.length - leadIndex;
      const batch = filteredLeads.slice(leadIndex, leadIndex + BATCH_SIZE);
      console.log(`[analyze-conversations] Job ${activeJobId}: processing batch #${totalBatches + 1}, leads ${leadIndex}-${leadIndex + batch.length - 1} of ${filteredLeads.length}`);

      if (batch.length === 0) {
        // No more leads to process
        break;
      }

      // Load messages for batch
      const batchLeadIds = batch.map(l => l.id);
      const { data: allMessages } = await supabase
        .from('messages')
        .select('id, lead_id, content, type, created_at')
        .in('lead_id', batchLeadIds)
        .order('created_at', { ascending: true });

      const messagesByLead: any = {};
      (allMessages || []).forEach(msg => {
        if (!messagesByLead[msg.lead_id]) {
          messagesByLead[msg.lead_id] = [];
        }
        messagesByLead[msg.lead_id].push(msg);
      });

      const now = new Date().toISOString();
      let analyzedCount = 0;
      let skippedCount = 0;
      let failedCount = 0;

      // === PHASE 1: AI Analysis (conversation-focused, NO SF data in prompt) ===
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

        const totalMessages = realMessages.length;
        const firstMessageAt = realMessages.length > 0 ? realMessages[0].created_at : null;
        const lastMessageAt = realMessages.length > 0 ? realMessages[realMessages.length - 1].created_at : null;

        // Calculate average response time (outgoing -> incoming)
        let totalResponseTime = 0;
        let responseCount = 0;
        for (let i = 1; i < realMessages.length; i++) {
          if (realMessages[i].type === 'incoming' && realMessages[i - 1].type === 'outgoing') {
            const respTime = new Date(realMessages[i].created_at).getTime() - new Date(realMessages[i - 1].created_at).getTime();
            if (respTime > 0 && respTime < 7 * 24 * 60 * 60 * 1000) {
              totalResponseTime += respTime;
              responseCount++;
            }
          }
        }
        const avgResponseTimeMinutes = responseCount > 0
          ? Math.round(totalResponseTime / responseCount / 60000)
          : null;

        // Handle leads with no messages
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
              // AI fields - defaults for no-message leads
              immobilien_interesse: 'unklar' as const,
              interesse_verlust_grund: null,
              abbruch_punkt: 'Kein Kontakt hergestellt',
              lead_typ: 'unklar' as const,
              antwort_verhalten: 'keine_antwort' as const,
              ton_analyse: 'unklar' as const,
              engagement_score: 1,
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
              finanzierung_gewollt: false,
              finanzierung_ablehnungsgrund: null,
              ai_einschaetzung: 'Kein Kontakt hergestellt - keine Einschätzung möglich.',
              booking_page_summary: null,
              // SF enrichment placeholder (filled in Phase 2)
              sf_pipeline_stage: null,
              sf_tags: [],
              analyzed_at: now,
              messages_analyzed_count: 0,
              last_message_analyzed_at: null,
              updated_at: now,
            }
          };
        }

        // Handle leads with no incoming messages (no response)
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
              immobilien_interesse: 'unklar' as const,
              interesse_verlust_grund: null,
              abbruch_punkt: `EVA hat ${outgoingMessages.length} Nachrichten gesendet, Lead hat nie geantwortet`,
              lead_typ: 'unklar' as const,
              antwort_verhalten: 'keine_antwort' as const,
              ton_analyse: 'unklar' as const,
              engagement_score: 1,
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
              finanzierung_gewollt: false,
              finanzierung_ablehnungsgrund: null,
              ai_einschaetzung: 'Lead hat auf keine Nachricht reagiert - Interesse nicht bewertbar.',
              booking_page_summary: null,
              sf_pipeline_stage: null,
              sf_tags: [],
              analyzed_at: now,
              messages_analyzed_count: totalMessages,
              last_message_analyzed_at: lastMessageAt,
              updated_at: now,
            }
          };
        }

        // === PHASE 1: AI Analysis - conversation only, NO SF data ===
        const recentMessages = realMessages.slice(-60);
        const conversationText = recentMessages.map((m: any) => {
          const role = m.type === 'incoming' ? 'Lead' : 'EVA';
          const date = new Date(m.created_at);
          const dateStr = `${date.getDate().toString().padStart(2, '0')}.${(date.getMonth() + 1).toString().padStart(2, '0')}. ${date.getHours().toString().padStart(2, '0')}:${date.getMinutes().toString().padStart(2, '0')}`;
          return `[${dateStr}] ${role}: ${m.content}`;
        }).join('\n');

        const daysSinceLastMessage = lastMessageAt
          ? Math.floor((Date.now() - new Date(lastMessageAt).getTime()) / (1000 * 60 * 60 * 24))
          : 0;

        // Build prompt - NO SF pipeline data, only conversation + basic lead info
        const promptWithData = analysisPrompt
          .replace('{{conversation}}', conversationText)
          .replace('{{lead_name}}', lead.name || 'Unbekannt')
          .replace('{{created_at}}', new Date(lead.created_at).toLocaleDateString('de-DE'))
          .replace('{{last_message_at}}', lastMessageAt ? new Date(lastMessageAt).toLocaleDateString('de-DE') : 'unbekannt')
          .replace('{{days_since_last_message}}', String(daysSinceLastMessage))
          .replace('{{total_messages}}', String(totalMessages))
          .replace('{{incoming_count}}', String(incomingMessages.length))
          .replace('{{outgoing_count}}', String(outgoingMessages.length));

        try {
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
              // New v2 fields from AI
              immobilien_interesse: analysis.immobilien_interesse || 'unklar',
              interesse_verlust_grund: analysis.interesse_verlust_grund || null,
              abbruch_punkt: analysis.abbruch_punkt || null,
              lead_typ: analysis.lead_typ || 'unklar',
              antwort_verhalten: analysis.antwort_verhalten || 'normal',
              ton_analyse: analysis.ton_analyse || 'unklar',
              engagement_score: Math.max(1, Math.min(10, analysis.engagement_score || 5)),
              // Existing fields from AI
              lead_temperature: analysis.lead_temperature || 'cold',
              temperature_score: Math.max(1, Math.min(10, analysis.temperature_score || 5)),
              conversation_outcome: analysis.conversation_outcome || 'sonstiges',
              primary_blocker: analysis.primary_blocker || 'unbekannt',
              pitch_quality: analysis.pitch_quality || 'no_pitch',
              pitch_quality_score: Math.max(1, Math.min(10, analysis.pitch_quality_score || 1)),
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
              // v3 fields
              finanzierung_gewollt: !!analysis.finanzierung_gewollt,
              finanzierung_ablehnungsgrund: analysis.finanzierung_ablehnungsgrund || null,
              ai_einschaetzung: analysis.ai_einschaetzung || '',
              booking_page_summary: null, // Filled in Phase 3
              // SF enrichment placeholder (filled in Phase 2)
              sf_pipeline_stage: null,
              sf_tags: [],
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

      // Wait for all Phase 1 AI analyses
      const results = await Promise.all(analysisPromises);

      // === PHASE 2: SF Pipeline Enrichment (data join, no AI) ===
      for (const result of results) {
        if (result.type === 'error') continue;

        const lead = batch.find(l => l.id === result.leadId);
        if (!lead) continue;

        // Get SF data: first from leads table directly, then fallback to phone matching
        let sfStage = lead.sf_pipeline_stage || null;
        let sfTags = lead.ghl_tags || [];

        if (!sfStage) {
          const phone = normalizePhone(lead.phone);
          const sfData = phone ? sfLeadsByPhone.get(phone) : null;
          if (sfData) {
            sfStage = sfData.stage;
            sfTags = sfData.tags;
          }
        }

        // Write SF data into analysis result
        result.data.sf_pipeline_stage = sfStage;
        result.data.sf_tags = sfTags;

        // Override conversation_outcome with SF ground truth if available
        if (sfStage) {
          if (sfStage.includes('no_show')) {
            result.data.conversation_outcome = 'no_show';
          } else if (sfStage.includes('abgesagt')) {
            result.data.conversation_outcome = 'termin_abgesagt';
          } else if (
            sfStage.includes('beratung') ||
            sfStage.includes('bestaetigung') ||
            sfStage.includes('warte') ||
            sfStage.includes('vertrag') ||
            sfStage.includes('auszahlung')
          ) {
            result.data.conversation_outcome = 'termin_gebucht';
            result.data.primary_blocker = 'kein_blocker';
          }
        }
      }

      // === PHASE 3: Booking Page Enrichment (data join, no AI) ===
      const batchLeadIdsBooking = results
        .filter(r => r.type !== 'error')
        .map(r => r.leadId);

      let bookingEventsByLead: any = {};
      if (batchLeadIdsBooking.length > 0) {
        const { data: bookingEvents } = await supabase
          .from('booking_page_events')
          .select('lead_id, event_type, device_type, session_id, created_at')
          .in('lead_id', batchLeadIdsBooking);

        for (const evt of (bookingEvents || [])) {
          if (!evt.lead_id) continue;
          if (!bookingEventsByLead[evt.lead_id]) bookingEventsByLead[evt.lead_id] = [];
          bookingEventsByLead[evt.lead_id].push(evt);
        }
      }

      for (const result of results) {
        if (result.type === 'error') continue;

        const events = bookingEventsByLead[result.leadId] || [];
        const lead = batch.find(l => l.id === result.leadId);

        if (events.length === 0) {
          // Fallback: check leads table for booking_page_visited flag
          if (lead?.booking_page_visited) {
            result.data.booking_page_summary = {
              visited: true,
              visited_at: lead.booking_page_visited_at || null,
              max_scroll_pct: 0,
              time_on_page_seconds: 0,
              calendar_opened: false,
              calendar_time_selected: false,
              form_submitted: false,
              sessions_count: 0,
              device_type: null,
            };
          }
          continue;
        }

        // Aggregate booking page events
        let maxScroll = 0;
        for (const evt of events) {
          if (evt.event_type === 'scroll_25') maxScroll = Math.max(maxScroll, 25);
          if (evt.event_type === 'scroll_50') maxScroll = Math.max(maxScroll, 50);
          if (evt.event_type === 'scroll_75') maxScroll = Math.max(maxScroll, 75);
          if (evt.event_type === 'scroll_100') maxScroll = Math.max(maxScroll, 100);
        }

        let maxTime = 0;
        for (const evt of events) {
          if (evt.event_type === 'time_5s') maxTime = Math.max(maxTime, 5);
          if (evt.event_type === 'time_30s') maxTime = Math.max(maxTime, 30);
          if (evt.event_type === 'time_60s') maxTime = Math.max(maxTime, 60);
          if (evt.event_type === 'time_120s') maxTime = Math.max(maxTime, 120);
        }

        const uniqueSessions = new Set(events.map((e: any) => e.session_id));
        const sortedEvents = [...events].sort((a, b) =>
          new Date(a.created_at).getTime() - new Date(b.created_at).getTime()
        );

        result.data.booking_page_summary = {
          visited: true,
          visited_at: sortedEvents[0]?.created_at || null,
          max_scroll_pct: maxScroll,
          time_on_page_seconds: maxTime,
          calendar_opened: events.some((e: any) => e.event_type === 'calendar_open'),
          calendar_time_selected: events.some((e: any) => e.event_type === 'calendar_time_selected'),
          form_submitted: events.some((e: any) => e.event_type === 'form_submitted'),
          sessions_count: uniqueSessions.size,
          device_type: sortedEvents[0]?.device_type || null,
        };
      }

      // === Upsert all results ===
      const successResults: any[] = [];
      for (const result of results) {
        if (result.type === 'error') {
          failedCount++;
          continue;
        }

        if (result.type === 'skip_no_messages' || result.type === 'skip_no_response') {
          skippedCount++;
        } else {
          analyzedCount++;
        }
        successResults.push(result);
      }

      // Batch upsert using direct REST API with external URL (fresh fetch per batch)
      if (successResults.length > 0) {
        const upsertData = successResults.map(r => r.data);
        const externalUrl = 'https://hsfrdovpgxtqbitmkrhs.supabase.co';
        console.log(`[analyze-conversations] Upserting ${upsertData.length} results for batch #${totalBatches + 1}, first lead_id: ${upsertData[0]?.lead_id}`);

        try {
          const upsertResp = await fetch(
            `${externalUrl}/rest/v1/lead_conversation_analysis?on_conflict=lead_id`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'apikey': supabaseKey,
                'Authorization': `Bearer ${supabaseKey}`,
                'Prefer': 'resolution=merge-duplicates,return=representation',
                'Connection': 'close',
              },
              body: JSON.stringify(upsertData),
            }
          );

          const respText = await upsertResp.text();
          if (!upsertResp.ok) {
            console.error(`[analyze-conversations] Batch upsert FAILED: ${upsertResp.status} ${respText.substring(0, 500)}`);
            failedCount += successResults.length;
            analyzedCount = 0;
            skippedCount = 0;
          } else {
            // Parse to verify row count
            try {
              const rows = JSON.parse(respText);
              console.log(`[analyze-conversations] Batch upsert OK: ${upsertResp.status}, ${Array.isArray(rows) ? rows.length : '?'} rows returned`);
            } catch {
              console.log(`[analyze-conversations] Batch upsert OK: ${upsertResp.status}, body length=${respText.length}`);
            }
          }
        } catch (e) {
          console.error(`[analyze-conversations] Batch upsert exception:`, e);
          failedCount += successResults.length;
          analyzedCount = 0;
          skippedCount = 0;
        }

        // Verification: count total rows after this batch
        const { count: verifyCount } = await supabase
          .from('lead_conversation_analysis')
          .select('*', { count: 'exact', head: true });
        console.log(`[analyze-conversations] VERIFY: total rows in lead_conversation_analysis = ${verifyCount}`);
        verifyHistory.push({ batch: totalBatches + 1, count: verifyCount });
      }

      // Accumulate totals
      totalAnalyzedCount += analyzedCount;
      totalSkippedCount += skippedCount;
      totalFailedCount += failedCount;
      totalBatches++;
      leadIndex += batch.length;

      // Update job progress after each batch
      await supabase
        .from('analysis_jobs')
        .update({
          analyzed_leads: totalAnalyzedCount,
          skipped_no_messages: totalSkippedCount,
          failed_leads: totalFailedCount,
        })
        .eq('id', activeJobId);

      remainingLeads = filteredLeads.length - leadIndex;

      console.log(`[analyze-conversations] Job ${activeJobId}: batch #${totalBatches} done, batch_size=${batch.length}, analyzed=${analyzedCount}, skipped=${skippedCount}, failed=${failedCount}, remaining=${remainingLeads}`);

    } // end while loop

    // === Determine final status ===
    const isComplete = remainingLeads <= 0 && !timedOut;

    if (isComplete) {
      // === PHASE 4: Meta-Summary (second AI call with all summaries) ===
      try {
        console.log(`[analyze-conversations] Phase 4: Generating meta-summaries for job ${activeJobId}`);

        // Fetch ALL analysis summaries
        const { data: allAnalyses } = await supabase
          .from('lead_conversation_analysis')
          .select('lead_id, conversation_summary, ai_einschaetzung, conversation_outcome, primary_blocker, immobilien_interesse, lead_typ, engagement_score, ton_analyse, finanzierung_gewollt, finanzierung_ablehnungsgrund, booking_page_summary, created_at')
          .not('conversation_summary', 'is', null);

        // Get leads for period filtering
        const { data: allLeadsForMeta } = await supabase
          .from('leads')
          .select('id, created_at')
          .not('ghl_location_id', 'in', `(${OWN_ACCOUNT_LOCATION_IDS.join(',')})`)
          .eq('is_archived', false);

        const leadCreatedMap = new Map();
        for (const l of (allLeadsForMeta || [])) {
          leadCreatedMap.set(l.id, new Date(l.created_at));
        }

        const nowForMeta = new Date();
        const periods = [
          { key: '30d', ms: 30 * 24 * 60 * 60 * 1000 },
          { key: '90d', ms: 90 * 24 * 60 * 60 * 1000 },
          { key: 'all', ms: 0 },
        ];

        for (const period of periods) {
          const startDate = period.ms > 0 ? new Date(nowForMeta.getTime() - period.ms) : new Date('2024-01-01');

          const periodAnalyses = (allAnalyses || []).filter((a: any) => {
            const leadDate = leadCreatedMap.get(a.lead_id);
            return leadDate && leadDate >= startDate && leadDate <= nowForMeta;
          });

          if (periodAnalyses.length === 0) continue;

          // Build compact summary lines for AI
          const summaryLines = periodAnalyses.map((a: any, i: number) =>
            `Lead ${i + 1}: Ergebnis=${a.conversation_outcome}, Interesse=${a.immobilien_interesse || 'unklar'}, Typ=${a.lead_typ || 'unklar'}, Engagement=${a.engagement_score || '?'}/10, Ton=${a.ton_analyse || 'unklar'}, Finanzierung=${a.finanzierung_gewollt ? 'ja' : 'nein'}, Booking=${a.booking_page_summary?.visited ? 'ja' : 'nein'}, Zusammenfassung: ${a.conversation_summary || '-'}`
          ).join('\n');

          const metaPrompt = `Du bist ein Experte fuer Lead-Analyse im Immobilienbereich. Du hast gerade ${periodAnalyses.length} WhatsApp-Unterhaltungen zwischen einem KI-Assistenten "EVA" und Immobilien-Leads analysiert.

Hier sind die Zusammenfassungen aller Leads:
${summaryLines}

Erstelle eine uebergreifende Meta-Analyse. Schreibe auf Deutsch. Antworte NUR mit validem JSON (kein Markdown):
{
  "meta_text": "<string - 3-5 Saetze natuerlichsprachige Zusammenfassung. Nenne konkrete Zahlen. Z.B. 'Von ${periodAnalyses.length} Leads haben X abgebrochen weil..., Y haben gebucht weil..., Z zeigen starkes Interesse'>",
  "sentiment_score": <number 1-100 - Wie positiv erleben die Leads den Kontakt mit EVA? 100=sehr positiv, 50=neutral, 1=sehr negativ>,
  "top_recommendations": ["<string>", "<string>", "<string>"],
  "notable_patterns": ["<string - auffaelliges Muster>", "<string>"]
}`;

          const metaResponse = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
            {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                contents: [{ parts: [{ text: metaPrompt }] }],
                generationConfig: { temperature: 0.3, maxOutputTokens: 2048 },
              }),
            }
          );

          if (metaResponse.ok) {
            const metaData = await metaResponse.json();
            const metaContent = metaData.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const cleanedMeta = metaContent.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            const metaJsonMatch = cleanedMeta.match(/\{[\s\S]*\}/);
            if (metaJsonMatch) {
              const metaJson = JSON.parse(metaJsonMatch[0]);

              await supabase
                .from('system_settings')
                .upsert({
                  key: `conversation_analysis_meta_${period.key}`,
                  value: {
                    ...metaJson,
                    generated_at: new Date().toISOString(),
                    job_id: activeJobId,
                    leads_analyzed_count: periodAnalyses.length,
                  },
                  updated_at: new Date().toISOString(),
                }, { onConflict: 'key' });

              console.log(`[analyze-conversations] Phase 4: Meta-summary for ${period.key} stored (${periodAnalyses.length} leads)`);
            }
          }
        }
      } catch (metaError) {
        console.error(`[analyze-conversations] Phase 4 meta-summary error:`, metaError);
        // Don't fail the job if meta-summary fails
      }

      await supabase
        .from('analysis_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
        })
        .eq('id', activeJobId);

      console.log(`[analyze-conversations] Job ${activeJobId} completed!`);
    } else if (timedOut) {
      console.log(`[analyze-conversations] Job ${activeJobId} timed out after ${totalBatches} batches, ~${remainingLeads} remaining. Frontend should re-trigger.`);
    }

    const finalStatus = isComplete ? 'completed' : (timedOut ? 'timed_out' : 'running');

    return new Response(
      JSON.stringify({
        success: true,
        job_id: activeJobId,
        status: finalStatus,
        total_batches: totalBatches,
        total_analyzed: totalAnalyzedCount,
        total_skipped: totalSkippedCount,
        total_failed: totalFailedCount,
        remaining: remainingLeads,
        elapsed_ms: Date.now() - invocationStart,
        verify_history: verifyHistory,
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
