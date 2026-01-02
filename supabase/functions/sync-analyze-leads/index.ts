import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Own Account Location IDs - Subaccounts die uns gehören (nicht Makler-Kunden)
// Diese werden NICHT analysiert da es eigene Kunden sind
const OWN_ACCOUNT_LOCATION_IDS: string[] = [
  "iDLo7b4WOOCkE9voshIM", // Simpli Finance GmbH
  "dI8ofFbKIogmLSUTvTFn", // simpli.immo
  "MAMK21fjL4Z52qgcvpgq", // simpli.bot
];

function isOwnAccount(locationId: string | null): boolean {
  if (!locationId) return false;
  return OWN_ACCOUNT_LOCATION_IDS.includes(locationId);
}

// Batch size - process this many leads per function call
const BATCH_SIZE = 20; // Increased because Gemini is faster

// Self-invoke to continue processing in background (fire-and-forget with logging)
function continueInBackground(supabaseUrl: string, supabaseKey: string, jobId: string, forceAll: boolean, geminiApiKey?: string, customPrompt?: string) {
  console.log(`Triggering background continuation for job ${jobId}`);

  // Fire and forget - don't await, but log errors
  fetch(`${supabaseUrl}/functions/v1/sync-analyze-leads`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${supabaseKey}`,
    },
    body: JSON.stringify({
      job_id: jobId,
      force_all: forceAll,
      gemini_api_key: geminiApiKey,
      custom_prompt: customPrompt
    })
  }).then(response => {
    if (!response.ok) {
      console.error(`Background continuation returned status ${response.status}`);
    } else {
      console.log(`Background continuation triggered successfully for job ${jobId}`);
    }
  }).catch(err => {
    console.error(`Background continuation failed for job ${jobId}:`, err);
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

    const { force_all = false, job_id, gemini_api_key, custom_prompt, lead_id } = await req.json().catch(() => ({}));

    // Use provided key or fallback to env var
    const geminiKey = gemini_api_key || Deno.env.get('GEMINI_API_KEY');

    if (!geminiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'GEMINI_API_KEY nicht konfiguriert. Bitte in SimpliOS unter Einstellungen > APIs eingeben.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // ============ MODE 0: SINGLE LEAD ANALYSIS (triggered by webhook) ============
    if (lead_id) {
      console.log('Single lead analysis triggered for:', lead_id);

      // Get the lead
      const { data: lead, error: leadError } = await supabase
        .from('leads')
        .select('id, ghl_location_id, name, email, phone, status, is_archived')
        .eq('id', lead_id)
        .single();

      if (leadError || !lead) {
        return new Response(
          JSON.stringify({ success: false, error: 'Lead nicht gefunden' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 404 }
        );
      }

      if (lead.is_archived) {
        return new Response(
          JSON.stringify({ success: true, message: 'Lead ist archiviert, wird nicht analysiert' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Skip analysis for own account leads (Simpli.bot, Simpli Immo, Simpli Finance)
      if (isOwnAccount(lead.ghl_location_id)) {
        console.log('Skipping analysis for own account lead:', lead.ghl_location_id);
        return new Response(
          JSON.stringify({ success: true, message: 'Eigener Account - keine Analyse erforderlich', skipped: true }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Get messages for this lead
      const { data: messages } = await supabase
        .from('messages')
        .select('id, content, type, created_at')
        .eq('lead_id', lead_id)
        .order('created_at', { ascending: true });

      // Filter out system messages
      const realMessages = (messages || []).filter(m =>
        m.content &&
        !m.content.startsWith('Opportunity created') &&
        !m.content.startsWith('Opportunity updated')
      );

      const now = new Date().toISOString();
      const today = new Date();
      const todayStr = today.toISOString().split('T')[0];

      // Check if lead has any messages
      if (realMessages.length === 0) {
        await supabase
          .from('leads')
          .update({
            last_analyzed_at: now,
            conversation_status: 'unterhaltung_laeuft',
            ai_quality_score: null,
            ai_improvement_suggestion: JSON.stringify({
              status: 'no_messages',
              zusammenfassung: 'Noch keine Konversation - Erstkontakt herstellen',
              sf_pitch: 'nein',
              sf_interesse: 'nein',
              sf_termin: 'nein',
              besichtigung: 'nein',
              follow_up_reason: 'Erstkontakt muss hergestellt werden',
              follow_up_date: null,
              follow_up_message: null
            })
          })
          .eq('id', lead_id);

        return new Response(
          JSON.stringify({ success: true, message: 'Keine Nachrichten zum Analysieren' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Check if there are any incoming messages (from the lead)
      const incomingMessages = realMessages.filter(m => m.type === 'incoming');
      if (incomingMessages.length === 0) {
        await supabase
          .from('leads')
          .update({
            last_analyzed_at: now,
            conversation_status: 'unterhaltung_laeuft',
            ai_quality_score: 1,
            ai_improvement_suggestion: JSON.stringify({
              status: 'no_response',
              zusammenfassung: 'Keine Antwort - Lead hat nicht reagiert',
              sf_pitch: 'nein',
              sf_interesse: 'nein',
              sf_termin: 'nein',
              besichtigung: 'nein',
              follow_up_reason: 'Lead hat nicht geantwortet - erneut kontaktieren',
              follow_up_date: null,
              follow_up_message: null
            })
          })
          .eq('id', lead_id);

        return new Response(
          JSON.stringify({ success: true, message: 'Lead hat noch nicht geantwortet' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Build conversation text (limit to last 50 messages)
      const recentMessages = realMessages.slice(-50);
      const conversationText = recentMessages.map(m => {
        const role = m.type === 'incoming' ? 'Kunde' : 'KI/Makler';
        return `${role}: ${m.content}`;
      }).join('\n');

      // Default analysis prompt
      const analysisPrompt = custom_prompt || `Du bist ein Conversation-Analyst für Immobilien und Finanzierungsberatung.

Der Chat ist zwischen einem Interessenten (Lead) und der KI eines Maklers.
Ziel: Simpli Finance (Finanzierungspartner) platzieren und Termine vermitteln.

HEUTIGES DATUM: ${todayStr}

KONVERSATION:
${conversationText}

Analysiere folgende Kategorien:

1. SF_PITCH - Wurde Simpli Finance im Gespräch erwähnt/vorgestellt?
   - ja: SF wurde klar vorgestellt mit Mehrwert
   - teilweise: SF erwähnt aber nicht gut erklärt
   - nein: SF wurde nicht erwähnt

2. SF_INTERESSE - Zeigt der Lead Interesse an Finanzierungsberatung durch Simpli Finance?
   - ja: Klares Interesse, Nachfragen zur Finanzierung
   - vielleicht: Unklares/latentes Interesse
   - nein: Kein Interesse an Finanzierungshilfe

3. SF_TERMIN - Status bezüglich Termin mit Simpli Finance Berater:
   - gebucht: Beratungstermin mit SF ist vereinbart
   - interesse: Lead zeigt Interesse an SF-Termin
   - nein: Kein SF-Termin-Interesse

4. BESICHTIGUNG - Status bezüglich Besichtigungstermin:
   - gebucht: Besichtigung ist vereinbart
   - interesse: Lead will besichtigen
   - nein: Keine Besichtigung geplant

5. MAKLER_TERMIN - Hat der Lead einen Termin beim Makler (Besichtigung ODER Telefontermin)?
   - gebucht: Termin ist vereinbart (Besichtigung, Telefonat, oder anderer Termin)
   - makler_meldet_sich: Makler soll sich melden um Termin zu vereinbaren
   - interesse: Lead zeigt Interesse an einem Termin
   - nein: Kein Termin vereinbart oder geplant

6. ZUSAMMENFASSUNG - 1-2 Sätze: Was ist passiert? Was ist der aktuelle Stand?

7. FOLLOW_UP_REASON - Warum braucht dieser Lead ein Follow-up? Oder warum nicht?
   Falls kein Follow-up nötig (z.B. Termin bereits gebucht, kein Interesse): Erkläre warum.

8. FOLLOW_UP_DATE - Datum für Follow-up (YYYY-MM-DD) oder null wenn keins nötig.
   Regeln: Nicht am Wochenende. Dringend = 1-2 Tage, Normal = 3-5 Tage.

9. FOLLOW_UP_MESSAGE - WhatsApp-Nachricht für Follow-up (oder null wenn keins nötig):

   ANREDE: Analysiere ausgehende Nachrichten - wenn "Sie" verwendet wurde → siezen, wenn "du" → duzen.

   STIL:
   - Menschlich, warm, authentisch
   - 2-3 kurze Sätze
   - Bezug auf das Gespräch (Objekt, Situation)
   - KEINE Floskeln ("Ich hoffe es geht Ihnen gut")
   - Echten Mehrwert liefern

   SIMPLI FINANCE INFOS (nutze passend):
   - Netzwerk aus Top-Finanzierungsexperten
   - Kostenlos für Käufer, unabhängig
   - 24h-Finanzierungscheck für Klarheit
   - Käufer wissen VOR Besichtigung was sie sich leisten können

Antworte NUR mit JSON:
{
  "sf_pitch": "ja|teilweise|nein",
  "sf_interesse": "ja|vielleicht|nein",
  "sf_termin": "gebucht|interesse|nein",
  "besichtigung": "gebucht|interesse|nein",
  "makler_termin": "gebucht|makler_meldet_sich|interesse|nein",
  "zusammenfassung": "Kurze Zusammenfassung",
  "follow_up_reason": "Warum Follow-up nötig/nicht nötig",
  "follow_up_date": "YYYY-MM-DD oder null",
  "follow_up_message": "Nachricht oder null"
}`;

      try {
        // Call Gemini 2.0 Flash
        const analysisResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: analysisPrompt }]
              }],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 1000
              }
            })
          }
        );

        if (!analysisResponse.ok) {
          const errorText = await analysisResponse.text();
          console.error('Gemini API error:', errorText);
          return new Response(
            JSON.stringify({ success: false, error: 'Gemini API Fehler' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
          );
        }

        const analysisData = await analysisResponse.json();
        const content = analysisData.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // Clean up markdown and extract JSON
        const cleanedContent = content
          .replace(/```json\s*/gi, '')
          .replace(/```\s*/g, '')
          .trim();

        const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
          console.error('No JSON in Gemini response:', content);
          return new Response(
            JSON.stringify({ success: false, error: 'Ungültige Gemini Antwort' }),
            { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
          );
        }

        const analysis = JSON.parse(jsonMatch[0]);

        // Map analysis to database fields
        // SF Termin gebucht = abgeschlossen, sonst läuft noch
        const conversationStatus = analysis.sf_termin === 'gebucht'
          ? 'abgeschlossen'
          : 'unterhaltung_laeuft';

        // Calculate quality score (1-10)
        let score = 5;
        // SF Pitch
        if (analysis.sf_pitch === 'ja') score += 2;
        else if (analysis.sf_pitch === 'teilweise') score += 1;
        else score -= 1;
        // SF Interesse
        if (analysis.sf_interesse === 'ja') score += 2;
        else if (analysis.sf_interesse === 'vielleicht') score += 1;
        else score -= 1;
        // SF Termin (wichtigster Faktor)
        if (analysis.sf_termin === 'gebucht') score += 3;
        else if (analysis.sf_termin === 'interesse') score += 1;
        // Besichtigung
        if (analysis.besichtigung === 'gebucht') score += 2;
        else if (analysis.besichtigung === 'interesse') score += 1;
        const qualityScore = Math.max(1, Math.min(10, score));

        // Update the lead
        await supabase
          .from('leads')
          .update({
            last_analyzed_at: now,
            conversation_status: conversationStatus,
            has_makler_termin: analysis.makler_termin === 'gebucht' || analysis.makler_termin === 'makler_meldet_sich',
            simpli_platziert: analysis.sf_pitch !== 'nein',
            simpli_interessiert: analysis.sf_interesse !== 'nein',
            ai_quality_score: qualityScore,
            ai_improvement_suggestion: JSON.stringify(analysis)
          })
          .eq('id', lead_id);

        console.log('Single lead analysis completed for:', lead_id, 'Score:', qualityScore);

        return new Response(
          JSON.stringify({
            success: true,
            lead_id,
            analysis,
            quality_score: qualityScore
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );

      } catch (analysisError) {
        console.error('Analysis error for lead', lead_id, analysisError);
        return new Response(
          JSON.stringify({ success: false, error: 'Analyse-Fehler: ' + analysisError.message }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
        );
      }
    }

    // ============ MODE 1: START NEW JOB ============
    if (!job_id) {
      // Get all active connections
      const { data: connections, error: connError } = await supabase
        .from('ghl_connections')
        .select('id, user_id, location_id, location_name')
        .eq('is_active', true);

      if (connError || !connections || connections.length === 0) {
        return new Response(
          JSON.stringify({ success: false, error: 'Keine aktiven Verbindungen' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      const locationIds = connections.map(c => c.location_id);

      // Get leads to analyze
      const { data: allLeads, error: leadsError } = await supabase
        .from('leads')
        .select('id, ghl_location_id, name, email, last_analyzed_at, last_message_at, is_archived')
        .in('ghl_location_id', locationIds);

      if (leadsError) {
        return new Response(
          JSON.stringify({ success: false, error: 'Fehler beim Laden der Leads' }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Filter leads - always analyze ALL Makler leads (not just new ones)
      let leads = (allLeads || []).filter(lead => {
        // Skip archived leads
        if (lead.is_archived) return false;
        // Skip own account leads (Simpli.bot, Simpli Immo, Simpli Finance)
        if (isOwnAccount(lead.ghl_location_id)) return false;
        return true;
      });

      // Note: We now always analyze all leads by default (like force_all)
      // The old behavior filtered to only new/updated leads, but this caused issues

      if (leads.length === 0) {
        return new Response(
          JSON.stringify({ success: true, message: 'Keine Leads zu analysieren', job_id: null }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create job record (force_all is passed separately, not stored in DB)
      const { data: job, error: jobError } = await supabase
        .from('analysis_jobs')
        .insert({
          status: 'running',
          total_leads: leads.length,
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
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Immediately start background processing (self-invoke)
      continueInBackground(supabaseUrl, supabaseKey, job.id, force_all, geminiKey, custom_prompt);

      return new Response(
        JSON.stringify({
          success: true,
          job_id: job.id,
          total_leads: leads.length,
          message: `Analyse gestartet für ${leads.length} Leads (läuft im Hintergrund)`
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // ============ MODE 2: CONTINUE EXISTING JOB ============
    // Get job status
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

    // Get connections for location mapping
    const { data: connections } = await supabase
      .from('ghl_connections')
      .select('location_id, location_name')
      .eq('is_active', true);

    const locationToName: Record<string, string> = {};
    (connections || []).forEach(c => {
      locationToName[c.location_id] = c.location_name || 'Unbekannt';
    });

    const locationIds = Object.keys(locationToName);
    console.log(`Job ${job_id}: ${connections?.length || 0} active connections, ${locationIds.length} location IDs`);

    // Get leads that still need analysis
    // First get all leads, then filter in memory to avoid complex Supabase query issues
    // Use ORDER BY id to ensure consistent ordering across batches
    const { data: allLeadsRaw } = await supabase
      .from('leads')
      .select('id, ghl_location_id, name, email, phone, status, last_analyzed_at, last_message_at, conversation_status, is_archived')
      .in('ghl_location_id', locationIds)
      .order('id', { ascending: true });

    // Filter leads in memory - always analyze all leads (skip only those already done in THIS job)
    const filteredLeads = (allLeadsRaw || []).filter(lead => {
      // Skip archived leads
      if (lead.is_archived === true) return false;

      // Skip own account leads (Simpli.bot, Simpli Immo, Simpli Finance)
      if (isOwnAccount(lead.ghl_location_id)) return false;

      // Skip leads already analyzed in THIS job (based on job.started_at)
      if (lead.last_analyzed_at && new Date(lead.last_analyzed_at) >= new Date(job.started_at)) {
        return false;
      }

      return true;
    });

    const remainingLeadsCount = filteredLeads.length;
    const totalRawLeads = allLeadsRaw?.length || 0;
    console.log(`Job ${job_id}: ${totalRawLeads} total leads in DB, ${remainingLeadsCount} remaining after filter, force_all=${force_all}`);

    // Take batch for processing
    let allLeads = filteredLeads.slice(0, BATCH_SIZE);
    console.log(`Job ${job_id}: Processing batch of ${allLeads.length} leads`);

    if (!allLeads || allLeads.length === 0) {
      // Check if really done or if there's a mismatch
      const processedSoFar = (job.analyzed_leads || 0) + (job.skipped_no_messages || 0) + (job.failed_leads || 0);
      const actuallyComplete = processedSoFar >= job.total_leads || remainingLeadsCount === 0;

      if (actuallyComplete) {
        // All done!
        await supabase
          .from('analysis_jobs')
          .update({
            status: 'completed',
            completed_at: new Date().toISOString()
          })
          .eq('id', job_id);

        console.log(`Job ${job_id} completed: ${processedSoFar}/${job.total_leads} leads processed`);

        return new Response(
          JSON.stringify({
            success: true,
            job_id,
            status: 'completed',
            analyzed_leads: job.analyzed_leads,
            total_leads: job.total_leads
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      } else {
        // Something went wrong - leads exist but weren't selected
        console.error(`Job ${job_id}: Filter returned 0 leads but ${job.total_leads - processedSoFar} leads remain unprocessed!`);

        // Mark job as failed
        await supabase
          .from('analysis_jobs')
          .update({
            status: 'failed',
            error_message: `Filter-Fehler: ${job.total_leads - processedSoFar} Leads nicht verarbeitet`,
            completed_at: new Date().toISOString()
          })
          .eq('id', job_id);

        return new Response(
          JSON.stringify({
            success: false,
            job_id,
            status: 'failed',
            error: `Filter returned no leads but ${job.total_leads - processedSoFar} leads remain unprocessed`,
            analyzed_leads: job.analyzed_leads,
            total_leads: job.total_leads
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }
    }

    // Get messages for these leads
    const leadIds = allLeads.map(l => l.id);
    const { data: allMessages } = await supabase
      .from('messages')
      .select('id, lead_id, content, type, created_at')
      .in('lead_id', leadIds)
      .order('created_at', { ascending: true });

    // Group messages by lead
    const messagesByLead: Record<string, any[]> = {};
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
    let noResponseCount = 0;

    // Separate leads into 3 categories:
    // 1. No messages at all
    // 2. Only outgoing messages (no response from lead)
    // 3. Has incoming messages (can be analyzed)
    const leadsWithMessages: typeof allLeads = [];
    const leadsWithoutMessages: typeof allLeads = [];
    const leadsNoResponse: typeof allLeads = [];

    for (const lead of allLeads) {
      const messages = messagesByLead[lead.id] || [];
      // Filter out system messages
      const realMessages = messages.filter(m =>
        m.content &&
        !m.content.startsWith('Opportunity created') &&
        !m.content.startsWith('Opportunity updated')
      );

      if (realMessages.length === 0) {
        // No messages at all
        leadsWithoutMessages.push(lead);
      } else {
        // Check if there are any INCOMING messages (from the lead)
        const incomingMessages = realMessages.filter(m => m.type === 'incoming');
        if (incomingMessages.length === 0) {
          // Only outgoing messages - lead never responded
          leadsNoResponse.push(lead);
        } else {
          // Has incoming messages - can be analyzed
          leadsWithMessages.push(lead);
        }
      }
    }

    // Handle leads without any messages (batch update)
    if (leadsWithoutMessages.length > 0) {
      const noMsgIds = leadsWithoutMessages.map(l => l.id);
      await supabase
        .from('leads')
        .update({
          last_analyzed_at: now,
          conversation_status: 'unterhaltung_laeuft',
          ai_quality_score: null,
          ai_improvement_suggestion: JSON.stringify({
            status: 'no_messages',
            zusammenfassung: 'Noch keine Konversation - Erstkontakt herstellen',
            sf_pitch: 'nein',
            sf_interesse: 'nein',
            sf_termin: 'nein',
            besichtigung: 'nein',
            follow_up_reason: 'Erstkontakt muss hergestellt werden',
            follow_up_date: null,
            follow_up_message: null
          })
        })
        .in('id', noMsgIds);
      skippedCount = leadsWithoutMessages.length;
    }

    // Handle leads with NO RESPONSE (only outgoing messages)
    if (leadsNoResponse.length > 0) {
      const noResponseIds = leadsNoResponse.map(l => l.id);
      await supabase
        .from('leads')
        .update({
          last_analyzed_at: now,
          conversation_status: 'unterhaltung_laeuft',
          ai_quality_score: 1, // Lowest score - no engagement
          ai_improvement_suggestion: JSON.stringify({
            status: 'no_response',
            zusammenfassung: 'Keine Antwort - Lead hat nicht reagiert',
            sf_pitch: 'nein',
            sf_interesse: 'nein',
            sf_termin: 'nein',
            besichtigung: 'nein',
            follow_up_reason: 'Lead hat nicht geantwortet - erneut kontaktieren',
            follow_up_date: null,
            follow_up_message: null
          })
        })
        .in('id', noResponseIds);
      noResponseCount = leadsNoResponse.length;
    }

    // Get today's date for follow-up calculation
    const today = new Date();
    const todayStr = today.toISOString().split('T')[0]; // YYYY-MM-DD format

    // Default analysis prompt with new categories
    const defaultPrompt = `Du bist ein Conversation-Analyst für Immobilien und Finanzierungsberatung.

Der Chat ist zwischen einem Interessenten (Lead) und der KI eines Maklers.
Ziel: Simpli Finance (Finanzierungspartner) platzieren und Termine vermitteln.

HEUTIGES DATUM: {{today}}

KONVERSATION:
{{conversation}}

Analysiere folgende Kategorien:

1. SF_PITCH - Wurde Simpli Finance im Gespräch erwähnt/vorgestellt?
   - ja: SF wurde klar vorgestellt mit Mehrwert
   - teilweise: SF erwähnt aber nicht gut erklärt
   - nein: SF wurde nicht erwähnt

2. SF_INTERESSE - Zeigt der Lead Interesse an Finanzierungsberatung durch Simpli Finance?
   - ja: Klares Interesse, Nachfragen zur Finanzierung
   - vielleicht: Unklares/latentes Interesse
   - nein: Kein Interesse an Finanzierungshilfe

3. SF_TERMIN - Status bezüglich Termin mit Simpli Finance Berater:
   - gebucht: Beratungstermin mit SF ist vereinbart
   - interesse: Lead zeigt Interesse an SF-Termin
   - nein: Kein SF-Termin-Interesse

4. BESICHTIGUNG - Status bezüglich Besichtigungstermin:
   - gebucht: Besichtigung ist vereinbart
   - interesse: Lead will besichtigen
   - nein: Keine Besichtigung geplant

5. MAKLER_TERMIN - Hat der Lead einen Termin beim Makler (Besichtigung ODER Telefontermin)?
   - gebucht: Termin ist vereinbart (Besichtigung, Telefonat, oder anderer Termin)
   - makler_meldet_sich: Makler soll sich melden um Termin zu vereinbaren
   - interesse: Lead zeigt Interesse an einem Termin
   - nein: Kein Termin vereinbart oder geplant

6. ZUSAMMENFASSUNG - 1-2 Sätze: Was ist passiert? Was ist der aktuelle Stand?

7. FOLLOW_UP_REASON - Warum braucht dieser Lead ein Follow-up? Oder warum nicht?
   Falls kein Follow-up nötig (z.B. Termin bereits gebucht, kein Interesse): Erkläre warum.

8. FOLLOW_UP_DATE - Datum für Follow-up (YYYY-MM-DD) oder null wenn keins nötig.
   Regeln: Nicht am Wochenende. Dringend = 1-2 Tage, Normal = 3-5 Tage.

9. FOLLOW_UP_MESSAGE - WhatsApp-Nachricht für Follow-up (oder null wenn keins nötig):

   ANREDE: Analysiere ausgehende Nachrichten - wenn "Sie" verwendet wurde → siezen, wenn "du" → duzen.

   STIL:
   - Menschlich, warm, authentisch
   - 2-3 kurze Sätze
   - Bezug auf das Gespräch (Objekt, Situation)
   - KEINE Floskeln ("Ich hoffe es geht Ihnen gut")
   - Echten Mehrwert liefern

   SIMPLI FINANCE INFOS (nutze passend):
   - Netzwerk aus Top-Finanzierungsexperten
   - Kostenlos für Käufer, unabhängig
   - 24h-Finanzierungscheck für Klarheit
   - Käufer wissen VOR Besichtigung was sie sich leisten können

Antworte NUR mit JSON:
{
  "sf_pitch": "ja|teilweise|nein",
  "sf_interesse": "ja|vielleicht|nein",
  "sf_termin": "gebucht|interesse|nein",
  "besichtigung": "gebucht|interesse|nein",
  "makler_termin": "gebucht|makler_meldet_sich|interesse|nein",
  "zusammenfassung": "Kurze Zusammenfassung",
  "follow_up_reason": "Warum Follow-up nötig/nicht nötig",
  "follow_up_date": "YYYY-MM-DD oder null",
  "follow_up_message": "Nachricht oder null"
}`;

    // Use custom prompt if provided, otherwise default
    const analysisPrompt = custom_prompt || defaultPrompt;

    // Process leads with messages in PARALLEL using Gemini 2.0 Flash
    const analysisPromises = leadsWithMessages.map(async (lead) => {
      const messages = messagesByLead[lead.id] || [];

      // Filter out system messages
      const realMessages = messages.filter(m =>
        m.content &&
        !m.content.startsWith('Opportunity created') &&
        !m.content.startsWith('Opportunity updated')
      );

      // Build conversation text (limit to last 50 messages)
      const recentMessages = realMessages.slice(-50);
      const conversationText = recentMessages.map(m => {
        const role = m.type === 'incoming' ? 'Kunde' : 'KI/Makler';
        return `${role}: ${m.content}`;
      }).join('\n');

      // Get last message info for status calculation
      const lastMessage = realMessages[realMessages.length - 1] || messages[messages.length - 1];
      const lastMessageDate = new Date(lastMessage?.created_at || Date.now());
      const daysSinceLastMessage = Math.floor((Date.now() - lastMessageDate.getTime()) / (1000 * 60 * 60 * 24));

      try {
        // Analyze with Gemini 2.0 Flash - detailed analysis
        const promptWithConversation = analysisPrompt
          .replace('{{today}}', todayStr)
          .replace('{{conversation}}', conversationText);

        const analysisResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{ text: promptWithConversation }]
              }],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 1000
              }
            })
          }
        );

        if (!analysisResponse.ok) {
          const errorText = await analysisResponse.text();
          console.error('Gemini API error:', errorText);
          return { leadId: lead.id, success: false };
        }

        const analysisData = await analysisResponse.json();
        const content = analysisData.candidates?.[0]?.content?.parts?.[0]?.text || '';

        // Clean up markdown and extract JSON
        const cleanedContent = content
          .replace(/```json\s*/gi, '')
          .replace(/```\s*/g, '')
          .trim();

        const jsonMatch = cleanedContent.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
          console.error('No JSON in Gemini response:', content);
          return { leadId: lead.id, success: false };
        }

        const analysis = JSON.parse(jsonMatch[0]);

        // Map analysis to database fields
        // SF Termin gebucht = abgeschlossen, sonst läuft noch
        const conversationStatus = analysis.sf_termin === 'gebucht'
          ? 'abgeschlossen'
          : 'unterhaltung_laeuft';

        return {
          leadId: lead.id,
          success: true,
          data: {
            last_analyzed_at: now,
            conversation_status: conversationStatus,
            has_makler_termin: analysis.makler_termin === 'gebucht' || analysis.makler_termin === 'makler_meldet_sich',
            simpli_platziert: analysis.sf_pitch !== 'nein',
            simpli_interessiert: analysis.sf_interesse !== 'nein',
            ai_quality_score: calculateQualityScore(analysis),
            ai_improvement_suggestion: JSON.stringify(analysis)
          }
        };

      } catch (e) {
        console.error('Analysis error for lead', lead.id, e);
        return { leadId: lead.id, success: false };
      }
    });

    // Helper function to calculate quality score (1-10)
    function calculateQualityScore(analysis: any): number {
      let score = 5; // Base score

      // SF Pitch
      if (analysis.sf_pitch === 'ja') score += 2;
      else if (analysis.sf_pitch === 'teilweise') score += 1;
      else score -= 1;

      // SF Interesse
      if (analysis.sf_interesse === 'ja') score += 2;
      else if (analysis.sf_interesse === 'vielleicht') score += 1;
      else score -= 1;

      // SF Termin (wichtigster Faktor)
      if (analysis.sf_termin === 'gebucht') score += 3;
      else if (analysis.sf_termin === 'interesse') score += 1;

      // Besichtigung
      if (analysis.besichtigung === 'gebucht') score += 2;
      else if (analysis.besichtigung === 'interesse') score += 1;

      return Math.max(1, Math.min(10, score));
    }

    // Wait for all analyses to complete in parallel
    const results = await Promise.all(analysisPromises);

    // Update leads with successful analyses
    for (const result of results) {
      if (result.success && result.data) {
        await supabase
          .from('leads')
          .update(result.data)
          .eq('id', result.leadId);
        analyzedCount++;
      } else {
        failedCount++;
      }
    }

    // Update job progress (noResponseCount counts as skipped since they're not analyzed)
    const { data: updatedJob } = await supabase
      .from('analysis_jobs')
      .update({
        analyzed_leads: job.analyzed_leads + analyzedCount,
        skipped_no_messages: job.skipped_no_messages + skippedCount + noResponseCount,
        failed_leads: job.failed_leads + failedCount
      })
      .eq('id', job_id)
      .select()
      .single();

    // Check if more leads to process
    const processedTotal = (updatedJob?.analyzed_leads || 0) + (updatedJob?.skipped_no_messages || 0) + (updatedJob?.failed_leads || 0);
    const isComplete = processedTotal >= job.total_leads;

    if (isComplete) {
      await supabase
        .from('analysis_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString(),
          current_lead_name: null
        })
        .eq('id', job_id);
    } else {
      // Continue processing in background (self-invoke)
      continueInBackground(supabaseUrl, supabaseKey, job_id, force_all, geminiKey, custom_prompt);
    }

    return new Response(
      JSON.stringify({
        success: true,
        job_id,
        status: isComplete ? 'completed' : 'running',
        analyzed_leads: updatedJob?.analyzed_leads || 0,
        skipped_no_messages: updatedJob?.skipped_no_messages || 0,
        failed_leads: updatedJob?.failed_leads || 0,
        total_leads: job.total_leads,
        batch_analyzed: analyzedCount,
        batch_skipped: skippedCount,
        batch_no_response: noResponseCount,
        batch_failed: failedCount,
        has_more: !isComplete
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Sync-analyze error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
