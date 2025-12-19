import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
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

    const { message, history = [] }: { message: string; history: ChatMessage[] } = await req.json();

    if (!message) {
      return new Response(
        JSON.stringify({ success: false, error: 'Keine Nachricht angegeben' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 400 }
      );
    }

    // Gather all relevant data for context
    console.log('Gathering data for admin chat...');

    // Get connections
    const { data: connections } = await supabase
      .from('ghl_connections')
      .select('id, user_id, location_id, location_name, is_active, last_sync_at')
      .eq('is_active', true);

    const userIds = connections?.map(c => c.user_id) || [];

    // Get all leads with analysis data
    const { data: leads } = await supabase
      .from('leads')
      .select(`
        id, user_id, name, email, phone, status,
        conversation_status, ai_quality_score, ai_improvement_suggestion,
        last_analyzed_at, last_message_at, created_at
      `)
      .in('user_id', userIds)
      .order('last_message_at', { ascending: false, nullsFirst: false });

    // Get recent messages (last 7 days or last 500)
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const { data: recentMessages } = await supabase
      .from('messages')
      .select('id, lead_id, content, type, created_at')
      .gte('created_at', sevenDaysAgo)
      .order('created_at', { ascending: false })
      .limit(500);

    // Group messages by lead
    const messagesByLead: Record<string, any[]> = {};
    (recentMessages || []).forEach(msg => {
      if (!messagesByLead[msg.lead_id]) {
        messagesByLead[msg.lead_id] = [];
      }
      messagesByLead[msg.lead_id].push(msg);
    });

    // Map user_id to location_name
    const userToLocation: Record<string, string> = {};
    connections?.forEach(c => {
      userToLocation[c.user_id] = c.location_name || 'Unbekannt';
    });

    // Build context summary
    const leadsWithMessages = (leads || []).map(lead => {
      const msgs = messagesByLead[lead.id] || [];
      return {
        ...lead,
        location_name: userToLocation[lead.user_id],
        message_count: msgs.length,
        recent_messages: msgs.slice(0, 5).map(m => ({
          type: m.type,
          content: m.content.substring(0, 200),
          date: m.created_at
        }))
      };
    });

    // Calculate stats
    const stats = {
      total_leads: leads?.length || 0,
      total_connections: connections?.length || 0,
      status_breakdown: {} as Record<string, number>,
      avg_quality_score: 0,
      needs_attention: 0,
      leads_by_location: {} as Record<string, number>
    };

    let qualitySum = 0;
    let qualityCount = 0;

    leadsWithMessages.forEach(lead => {
      // Status breakdown
      const status = lead.conversation_status || 'unbekannt';
      stats.status_breakdown[status] = (stats.status_breakdown[status] || 0) + 1;

      // Quality score
      if (lead.ai_quality_score) {
        qualitySum += lead.ai_quality_score;
        qualityCount++;
      }

      // Needs attention
      if (lead.conversation_status === 'unterhaltung_abgebrochen' || (lead.ai_quality_score && lead.ai_quality_score < 5)) {
        stats.needs_attention++;
      }

      // By location
      const loc = lead.location_name || 'Unbekannt';
      stats.leads_by_location[loc] = (stats.leads_by_location[loc] || 0) + 1;
    });

    stats.avg_quality_score = qualityCount > 0 ? Math.round((qualitySum / qualityCount) * 10) / 10 : 0;

    // Get common improvement suggestions
    const suggestions: Record<string, number> = {};
    leadsWithMessages.forEach(lead => {
      if (lead.ai_improvement_suggestion) {
        const key = lead.ai_improvement_suggestion.substring(0, 100);
        suggestions[key] = (suggestions[key] || 0) + 1;
      }
    });

    const topSuggestions = Object.entries(suggestions)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([suggestion, count]) => ({ suggestion, count }));

    // Build the system context
    const systemContext = `Du bist ein KI-Assistent für das simpli.immo Admin Dashboard. Du hast Zugriff auf alle Lead- und Konversationsdaten.

AKTUELLE DATEN (Stand: ${new Date().toLocaleString('de-DE')}):

STATISTIKEN:
- Aktive Verbindungen: ${stats.total_connections}
- Gesamt Leads: ${stats.total_leads}
- Durchschnittliche KI-Qualität: ${stats.avg_quality_score}/10
- Leads die Aufmerksamkeit brauchen: ${stats.needs_attention}

STATUS-VERTEILUNG:
${Object.entries(stats.status_breakdown).map(([status, count]) => `- ${status}: ${count}`).join('\n')}

LEADS NACH MAKLER:
${Object.entries(stats.leads_by_location).map(([loc, count]) => `- ${loc}: ${count} Leads`).join('\n')}

TOP VERBESSERUNGSVORSCHLÄGE:
${topSuggestions.map((s, i) => `${i + 1}. "${s.suggestion}" (${s.count}x)`).join('\n')}

ALLE LEADS MIT DETAILS:
${leadsWithMessages.slice(0, 50).map(lead => `
---
Name: ${lead.name || lead.email || 'Unbekannt'}
Makler: ${lead.location_name}
Status: ${lead.conversation_status || 'unbekannt'}
KI-Score: ${lead.ai_quality_score || 'nicht bewertet'}/10
Verbesserung: ${lead.ai_improvement_suggestion || '-'}
Nachrichten: ${lead.message_count}
Letzte Nachricht: ${lead.last_message_at ? new Date(lead.last_message_at).toLocaleString('de-DE') : '-'}
${lead.recent_messages.length > 0 ? 'Letzte Nachrichten:\n' + lead.recent_messages.map(m => `  [${m.type}] ${m.content}`).join('\n') : ''}
`).join('\n')}

WICHTIGE REGELN:
- Antworte auf Deutsch
- Sei konkret und nenne Namen/Details wenn relevant
- Gib actionable Empfehlungen
- Wenn nach bestimmten Leads gefragt wird, suche in den Daten
- Du kannst Fragen zu Konversationen, Status, Verbesserungen, etc. beantworten`;

    // Build messages array for Claude
    const claudeMessages: Array<{ role: string; content: string }> = [];

    // Add conversation history
    history.forEach(msg => {
      claudeMessages.push({
        role: msg.role,
        content: msg.content
      });
    });

    // Add current message
    claudeMessages.push({
      role: 'user',
      content: message
    });

    // Call Claude
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': anthropicKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-5-sonnet-20241022',
        max_tokens: 2000,
        system: systemContext,
        messages: claudeMessages
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Claude API error:', errorText);
      throw new Error('KI-Anfrage fehlgeschlagen');
    }

    const data = await response.json();
    const assistantMessage = data.content[0].text;

    return new Response(
      JSON.stringify({
        success: true,
        message: assistantMessage,
        stats: {
          total_leads: stats.total_leads,
          avg_quality: stats.avg_quality_score,
          needs_attention: stats.needs_attention
        }
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Admin chat error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});
