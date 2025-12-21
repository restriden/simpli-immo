import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Batch size - process this many leads per function call
const BATCH_SIZE = 20; // Increased because Gemini is faster

// Self-invoke to continue processing in background
async function continueInBackground(supabaseUrl: string, supabaseKey: string, jobId: string, forceAll: boolean, geminiApiKey?: string) {
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
        gemini_api_key: geminiApiKey
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

    const { force_all = false, job_id, gemini_api_key } = await req.json().catch(() => ({}));

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
      continueInBackground(supabaseUrl, supabaseKey, job.id, force_all, geminiKey);

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
    let leadsQuery = supabase
      .from('leads')
      .select('id, ghl_location_id, name, email, phone, status, last_analyzed_at, last_message_at, conversation_status, is_archived')
      .in('ghl_location_id', locationIds)
      .or('is_archived.is.null,is_archived.eq.false');

    if (!force_all) {
      // Only get leads that need analysis
      leadsQuery = leadsQuery.or('last_analyzed_at.is.null,last_message_at.gt.last_analyzed_at');
    }

    const { data: allLeads } = await leadsQuery.limit(BATCH_SIZE);

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

    // Separate leads with and without messages
    const leadsWithMessages: typeof allLeads = [];
    const leadsWithoutMessages: typeof allLeads = [];

    for (const lead of allLeads) {
      const messages = messagesByLead[lead.id] || [];
      if (messages.length === 0) {
        leadsWithoutMessages.push(lead);
      } else {
        leadsWithMessages.push(lead);
      }
    }

    // Handle leads without messages (batch update)
    if (leadsWithoutMessages.length > 0) {
      const noMsgIds = leadsWithoutMessages.map(l => l.id);
      await supabase
        .from('leads')
        .update({
          last_analyzed_at: now,
          conversation_status: 'unterhaltung_laeuft',
          ai_improvement_suggestion: 'Noch keine Nachrichten - Erstkontakt herstellen'
        })
        .in('id', noMsgIds);
      skippedCount = leadsWithoutMessages.length;
    }

    // Process leads with messages in PARALLEL using Gemini 2.5 Flash
    const analysisPromises = leadsWithMessages.map(async (lead) => {
      const messages = messagesByLead[lead.id] || [];

      // Build conversation text (limit to last 30 messages for speed)
      const recentMessages = messages.slice(-30);
      const conversationText = recentMessages.map(m => {
        const role = m.type === 'incoming' ? 'Kunde' : 'KI/Makler';
        return `${role}: ${m.content}`;
      }).join('\n');

      // Get last message info for status calculation
      const lastMessage = messages[messages.length - 1];
      const lastMessageDate = new Date(lastMessage.created_at);
      const daysSinceLastMessage = Math.floor((Date.now() - lastMessageDate.getTime()) / (1000 * 60 * 60 * 24));

      // Calculate conversation status based on last message date
      let conversationStatus = 'unterhaltung_laeuft';
      if (daysSinceLastMessage > 3) {
        conversationStatus = 'unterhaltung_abgebrochen';
      }

      try {
        // Analyze with Gemini 2.5 Flash - simple 3-checkbox approach
        const analysisResponse = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiKey}`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              contents: [{
                parts: [{
                  text: `Analysiere diese Immobilien-Konversation und beantworte 3 Fragen mit true/false:

KONVERSATION:
${conversationText}

FRAGEN:
1. has_makler_termin: Wurde ein Besichtigungs- oder Beratungstermin mit dem Makler vereinbart/bestätigt?
2. simpli_platziert: Wurde Simpli Finance (Finanzierungspartner) im Gespräch erwähnt/vorgestellt?
3. simpli_interessiert: Hat der Kunde Interesse an Finanzierung/Simpli Finance gezeigt?

Antworte NUR mit JSON:
{"has_makler_termin":true/false,"simpli_platziert":true/false,"simpli_interessiert":true/false}`
                }]
              }],
              generationConfig: {
                temperature: 0.1,
                maxOutputTokens: 300
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
        const jsonMatch = content.match(/\{[\s\S]*\}/);

        if (!jsonMatch) {
          console.error('No JSON in Gemini response:', content);
          return { leadId: lead.id, success: false };
        }

        const analysis = JSON.parse(jsonMatch[0]);

        return {
          leadId: lead.id,
          success: true,
          data: {
            last_analyzed_at: now,
            conversation_status: conversationStatus,
            has_makler_termin: analysis.has_makler_termin === true,
            simpli_platziert: analysis.simpli_platziert === true,
            simpli_interessiert: analysis.simpli_interessiert === true
          }
        };

      } catch (e) {
        console.error('Analysis error for lead', lead.id, e);
        return { leadId: lead.id, success: false };
      }
    });

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

    // Update job progress
    const { data: updatedJob } = await supabase
      .from('analysis_jobs')
      .update({
        analyzed_leads: job.analyzed_leads + analyzedCount,
        skipped_no_messages: job.skipped_no_messages + skippedCount,
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
      continueInBackground(supabaseUrl, supabaseKey, job_id, force_all, geminiKey);
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
