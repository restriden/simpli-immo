import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Batch size - process this many leads per function call
const BATCH_SIZE = 20; // Increased because Gemini is faster

// Self-invoke to continue processing in background
async function continueInBackground(supabaseUrl: string, supabaseKey: string, jobId: string, forceAll: boolean, geminiApiKey?: string, customPrompt?: string) {
  try {
    // Fire and forget - don't await
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
    }).catch(err => console.error('Background continuation failed:', err));
  } catch (e) {
    console.error('Failed to trigger background continuation:', e);
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { force_all = false, job_id, gemini_api_key, custom_prompt } = await req.json().catch(() => ({}));

    // Use provided key or fallback to env var
    const geminiKey = gemini_api_key || Deno.env.get('GEMINI_API_KEY');

    if (!geminiKey) {
      return new Response(
        JSON.stringify({ success: false, error: 'GEMINI_API_KEY nicht konfiguriert. Bitte in SimpliOS unter Einstellungen > APIs eingeben.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
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

      // Filter leads
      let leads = (allLeads || []).filter(lead => !lead.is_archived);

      if (!force_all) {
        leads = leads.filter(lead => {
          if (!lead.last_analyzed_at) return true;
          if (lead.last_message_at && new Date(lead.last_message_at) > new Date(lead.last_analyzed_at)) return true;
          return false;
        });
      }

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

    // Get leads that still need analysis
    // First get all leads, then filter in memory to avoid complex Supabase query issues
    const { data: allLeadsRaw } = await supabase
      .from('leads')
      .select('id, ghl_location_id, name, email, phone, status, last_analyzed_at, last_message_at, conversation_status, is_archived')
      .in('ghl_location_id', locationIds);

    // Filter leads in memory
    let allLeads = (allLeadsRaw || []).filter(lead => {
      // Skip archived leads
      if (lead.is_archived === true) return false;

      if (force_all) {
        // For force_all: skip leads already analyzed in THIS job (started_at)
        if (lead.last_analyzed_at && new Date(lead.last_analyzed_at) >= new Date(job.started_at)) {
          return false;
        }
        return true;
      } else {
        // Normal mode: only leads that need re-analysis
        if (!lead.last_analyzed_at) return true;
        if (lead.last_message_at && new Date(lead.last_message_at) > new Date(lead.last_analyzed_at)) return true;
        return false;
      }
    }).slice(0, BATCH_SIZE);

    if (!allLeads || allLeads.length === 0) {
      // All done!
      await supabase
        .from('analysis_jobs')
        .update({
          status: 'completed',
          completed_at: new Date().toISOString()
        })
        .eq('id', job_id);

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
            simpli_platzierung: 'nicht',
            lead_interesse: 'kein',
            termin_status: 'kein',
            gespraechs_status: 'offen',
            follow_up: ['Erstkontakt herstellen'],
            verbesserung: 'Erstkontakt mit Lead aufnehmen'
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
            simpli_platzierung: 'nicht',
            lead_interesse: 'kein',
            termin_status: 'kein',
            gespraechs_status: 'offen',
            follow_up: ['Erneut kontaktieren', 'Alternative Kontaktmethode versuchen'],
            verbesserung: 'Lead erneut ansprechen oder andere Ansprache wählen'
          })
        })
        .in('id', noResponseIds);
      noResponseCount = leadsNoResponse.length;
    }

    // Default analysis prompt
    const defaultPrompt = `Du bist ein Senior Conversation-, Sales- und Funnel-Analyst mit Fokus auf Immobilien, Finanzierungsberatung und KI-gestützte Lead-Qualifizierung.

Der folgende Chat ist ein Gespräch zwischen einem Interessenten (Lead) und der KI des Maklers.
Ziel der Makler-KI ist es, Simpli Finance (Finanzierungspartner) sinnvoll und glaubwürdig zu platzieren, sodass der Lead Interesse entwickelt und einen Termin buchen möchte.

KONVERSATION:
{{conversation}}

Analysiere und bewerte:

1. SIMPLI_PLATZIERUNG - Wurde Simpli Finance sinnvoll platziert?
   - erfolg: Erfolgreich und natürlich platziert, Mehrwert klar
   - teilweise: Erwähnt aber verbesserungsfähig (Timing, Erklärung)
   - nicht: Nicht erwähnt oder unpassend platziert

2. LEAD_INTERESSE - Hat der Lead Interesse an Simpli Finance/Finanzierung gezeigt?
   - klar: Klares Interesse, Nachfragen, positive Reaktionen
   - unsicher: Latentes/unklares Interesse, Finanzierung relevant
   - kein: Kein erkennbares Interesse

3. TERMIN_STATUS - Stand bezüglich Terminen:
   - gebucht: Termin mit Simpli Finance ODER Makler gebucht/bestätigt
   - interesse: Interesse an Termin gezeigt, aber nicht gebucht
   - kein: Kein Termininteresse erkennbar

4. GESPRAECHS_STATUS - Qualifizierungsstatus:
   - qualifiziert: Erfolgreich qualifiziert & übergeben
   - offen: Interesse vorhanden, Abschluss noch offen
   - abgebrochen: Früh abgebrochen, kein Interesse, nicht qualifiziert

5. FOLLOW_UP - Maximal 3 konkrete Follow-up Punkte (was nachgefasst werden sollte)

6. VERBESSERUNG - Ein konkreter Satz was die KI besser machen könnte

7. ZUSAMMENFASSUNG - Ein Satz der den aktuellen Stand beschreibt

Antworte NUR mit JSON (keine Markdown-Blöcke):
{
  "simpli_platzierung": "erfolg|teilweise|nicht",
  "lead_interesse": "klar|unsicher|kein",
  "termin_status": "gebucht|interesse|kein",
  "gespraechs_status": "qualifiziert|offen|abgebrochen",
  "follow_up": ["Punkt 1", "Punkt 2"],
  "verbesserung": "Konkreter Verbesserungsvorschlag",
  "zusammenfassung": "Kurze Zusammenfassung"
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
        const promptWithConversation = analysisPrompt.replace('{{conversation}}', conversationText);

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
        const conversationStatus = analysis.gespraechs_status === 'qualifiziert'
          ? 'abgeschlossen'
          : analysis.gespraechs_status === 'abgebrochen'
            ? 'unterhaltung_abgebrochen'
            : 'unterhaltung_laeuft';

        return {
          leadId: lead.id,
          success: true,
          data: {
            last_analyzed_at: now,
            conversation_status: conversationStatus,
            has_makler_termin: analysis.termin_status === 'gebucht',
            simpli_platziert: analysis.simpli_platzierung !== 'nicht',
            simpli_interessiert: analysis.lead_interesse !== 'kein',
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

      // Simpli Platzierung
      if (analysis.simpli_platzierung === 'erfolg') score += 2;
      else if (analysis.simpli_platzierung === 'teilweise') score += 1;
      else score -= 1;

      // Lead Interesse
      if (analysis.lead_interesse === 'klar') score += 2;
      else if (analysis.lead_interesse === 'unsicher') score += 1;
      else score -= 1;

      // Termin Status
      if (analysis.termin_status === 'gebucht') score += 2;
      else if (analysis.termin_status === 'interesse') score += 1;

      // Gesprächs Status
      if (analysis.gespraechs_status === 'qualifiziert') score += 1;
      else if (analysis.gespraechs_status === 'abgebrochen') score -= 2;

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
