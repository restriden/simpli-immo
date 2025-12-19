import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Valid conversation statuses
const CONVERSATION_STATUSES = [
  'unterhaltung_laeuft',
  'unterhaltung_abgebrochen',
  'termin_gebucht',
  'termin_angefragt',
  'simpli_interessiert',
  'simpli_nicht_interessiert',
  'abgeschlossen'
] as const;

interface AnalysisResult {
  lead_id: string;
  lead_name: string;
  location_name: string;
  conversation_status: string;
  ai_quality_score: number;
  ai_improvement_suggestion: string;
  message_count: number;
  last_message_at: string;
  is_new_analysis: boolean;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const anthropicKey = Deno.env.get('ANTHROPIC_API_KEY')!;

    const supabase = createClient(supabaseUrl, supabaseKey);

    const { force_all = false } = await req.json().catch(() => ({}));

    // Get all active connections
    const { data: connections } = await supabase
      .from('ghl_connections')
      .select('id, user_id, location_id, location_name')
      .eq('is_active', true);

    if (!connections || connections.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: 'Keine aktiven Verbindungen', analyzed: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Map user_id to location_name
    const userToLocation: Record<string, string> = {};
    connections.forEach(c => {
      userToLocation[c.user_id] = c.location_name || 'Unbekannt';
    });

    const userIds = connections.map(c => c.user_id);

    // First, update last_message_at for all leads manually
    // (No RPC needed - just do it directly)
    {
      // Get latest message per lead
      const { data: latestMessages } = await supabase
        .from('messages')
        .select('lead_id, created_at')
        .order('created_at', { ascending: false });

      if (latestMessages) {
        const leadMessageMap: Record<string, string> = {};
        latestMessages.forEach(m => {
          if (!leadMessageMap[m.lead_id]) {
            leadMessageMap[m.lead_id] = m.created_at;
          }
        });

        // Update each lead's last_message_at
        for (const [leadId, lastMessageAt] of Object.entries(leadMessageMap)) {
          await supabase
            .from('leads')
            .update({ last_message_at: lastMessageAt })
            .eq('id', leadId);
        }
      }
    }

    // Get leads that need analysis (new messages since last analysis)
    let leadsQuery = supabase
      .from('leads')
      .select('id, user_id, name, email, phone, status, last_analyzed_at, last_message_at, conversation_status')
      .in('user_id', userIds);

    if (!force_all) {
      // Only get leads where last_message_at > last_analyzed_at OR never analyzed
      leadsQuery = leadsQuery.or('last_analyzed_at.is.null,last_message_at.gt.last_analyzed_at');
    }

    const { data: leads, error: leadsError } = await leadsQuery;

    if (leadsError) {
      console.error('Error fetching leads:', leadsError);
      throw new Error('Failed to fetch leads: ' + leadsError.message);
    }

    if (!leads || leads.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: 'Keine neuen Konversationen zu analysieren',
          analyzed: 0,
          results: []
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${leads.length} leads to analyze`);

    // Get messages for these leads
    const leadIds = leads.map(l => l.id);
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

    const results: AnalysisResult[] = [];
    const now = new Date().toISOString();

    // Analyze each lead
    for (const lead of leads) {
      const messages = messagesByLead[lead.id] || [];

      if (messages.length === 0) {
        // No messages - mark as needs attention
        await supabase
          .from('leads')
          .update({
            last_analyzed_at: now,
            conversation_status: 'unterhaltung_laeuft',
            ai_improvement_suggestion: 'Noch keine Nachrichten - Erstkontakt herstellen'
          })
          .eq('id', lead.id);
        continue;
      }

      // Build conversation text
      const conversationText = messages.map(m => {
        const role = m.type === 'incoming' ? 'Kunde' : 'KI/Makler';
        return `${role}: ${m.content}`;
      }).join('\n');

      // Get last message info
      const lastMessage = messages[messages.length - 1];
      const lastMessageDate = new Date(lastMessage.created_at);
      const daysSinceLastMessage = Math.floor((Date.now() - lastMessageDate.getTime()) / (1000 * 60 * 60 * 24));

      // Analyze with Claude
      const analysisResponse = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': anthropicKey,
          'anthropic-version': '2023-06-01',
        },
        body: JSON.stringify({
          model: 'claude-3-haiku-20240307',
          max_tokens: 1500,
          messages: [{
            role: 'user',
            content: `Du bist ein Analyse-Experte für Immobilien-Kundenservice. Analysiere diese Konversation und bewerte die KI-Performance.

KONVERSATION:
${conversationText}

KONTEXT:
- Tage seit letzter Nachricht: ${daysSinceLastMessage}
- Letzte Nachricht war von: ${lastMessage.type === 'incoming' ? 'Kunde' : 'KI/Makler'}
- Anzahl Nachrichten: ${messages.length}

Bestimme:
1. Den aktuellen Status der Konversation
2. Die Qualität der KI-Antworten (1-10)
3. Einen konkreten Verbesserungsvorschlag für die KI

Antworte NUR mit einem JSON-Objekt:
{
  "conversation_status": "<einer von: unterhaltung_laeuft, unterhaltung_abgebrochen, termin_gebucht, termin_angefragt, simpli_interessiert, simpli_nicht_interessiert, abgeschlossen>",
  "ai_quality_score": <1-10>,
  "improvement_suggestion": "<Konkreter Verbesserungsvorschlag in 1-2 Sätzen, z.B. 'Die KI sollte aktiver nach einem Besichtigungstermin fragen' oder 'Die KI hat die Finanzierungsfrage nicht beantwortet - Simpli Finance erwähnen'>"
}

REGELN für conversation_status:
- "unterhaltung_laeuft": Aktiver Dialog, Kunde antwortet
- "unterhaltung_abgebrochen": Keine Kundenantwort seit >3 Tagen nach KI-Nachricht
- "termin_gebucht": Kunde hat Termin bestätigt
- "termin_angefragt": Kunde fragt nach Termin oder Rückruf
- "simpli_interessiert": Kunde zeigt Interesse an Finanzierung
- "simpli_nicht_interessiert": Kunde lehnt Finanzierung ab
- "abgeschlossen": Gespräch ist beendet (Kauf, Absage, etc.)`
          }]
        })
      });

      if (!analysisResponse.ok) {
        console.error('Claude API error for lead', lead.id);
        continue;
      }

      const analysisData = await analysisResponse.json();
      let analysis;

      try {
        const content = analysisData.content[0].text;
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          console.error('No JSON found for lead', lead.id);
          continue;
        }
      } catch (e) {
        console.error('Failed to parse analysis for lead', lead.id, e);
        continue;
      }

      // Validate status
      let status = analysis.conversation_status;
      if (!CONVERSATION_STATUSES.includes(status)) {
        status = 'unterhaltung_laeuft';
      }

      // Override status if no response for too long
      if (daysSinceLastMessage > 3 && lastMessage.type === 'outgoing' && status === 'unterhaltung_laeuft') {
        status = 'unterhaltung_abgebrochen';
      }

      // Update lead in database
      const { error: updateError } = await supabase
        .from('leads')
        .update({
          last_analyzed_at: now,
          conversation_status: status,
          ai_quality_score: analysis.ai_quality_score || 5,
          ai_improvement_suggestion: analysis.improvement_suggestion || null
        })
        .eq('id', lead.id);

      if (updateError) {
        console.error('Failed to update lead', lead.id, updateError);
      }

      results.push({
        lead_id: lead.id,
        lead_name: lead.name || lead.email || 'Unbekannt',
        location_name: userToLocation[lead.user_id],
        conversation_status: status,
        ai_quality_score: analysis.ai_quality_score || 5,
        ai_improvement_suggestion: analysis.improvement_suggestion || '',
        message_count: messages.length,
        last_message_at: lastMessage.created_at,
        is_new_analysis: !lead.last_analyzed_at
      });
    }

    // Calculate summary stats
    const statusCounts: Record<string, number> = {};
    results.forEach(r => {
      statusCounts[r.conversation_status] = (statusCounts[r.conversation_status] || 0) + 1;
    });

    const avgQuality = results.length > 0
      ? Math.round((results.reduce((sum, r) => sum + r.ai_quality_score, 0) / results.length) * 10) / 10
      : 0;

    return new Response(
      JSON.stringify({
        success: true,
        analyzed: results.length,
        summary: {
          avg_quality_score: avgQuality,
          status_breakdown: statusCounts,
          needs_attention: results.filter(r =>
            r.conversation_status === 'unterhaltung_abgebrochen' ||
            r.ai_quality_score < 5
          ).length
        },
        results
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
