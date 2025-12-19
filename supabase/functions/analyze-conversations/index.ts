import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.3';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface AnalysisRequest {
  analysis_prompt: string;
  time_filter: 'all' | '7d' | '30d' | '90d';
  goal_a?: string;
  goal_b?: string;
}

interface ConversationAnalysis {
  contact_id: string;
  contact_name: string;
  location_name: string;
  status: 'analyzed' | 'pending' | 'error';
  ai_quality_score: number;
  sentiment: 'positive' | 'neutral' | 'negative';
  goal_a_status: 'achieved' | 'in_progress' | 'blocked' | 'not_applicable';
  goal_a_blockers: string[];
  goal_b_status: 'achieved' | 'in_progress' | 'blocked' | 'not_applicable';
  goal_b_blockers: string[];
  questions_asked: string[];
  unanswered_questions: string[];
  response_time_avg: number;
  message_count: number;
  summary: string;
}

interface FAQ {
  question: string;
  frequency: number;
  category: string;
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

    const { analysis_prompt, time_filter, goal_a, goal_b }: AnalysisRequest = await req.json();

    // Calculate date filter
    let dateFilter = null;
    const now = new Date();
    if (time_filter === '7d') {
      dateFilter = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString();
    } else if (time_filter === '30d') {
      dateFilter = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();
    } else if (time_filter === '90d') {
      dateFilter = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000).toISOString();
    }

    // Get all active connections
    const { data: connections } = await supabase
      .from('ghl_connections')
      .select('id, user_id, location_id, location_name')
      .eq('is_active', true);

    if (!connections || connections.length === 0) {
      return new Response(
        JSON.stringify({ success: true, analyses: [], faqs: [], summary: 'Keine aktiven Verbindungen gefunden.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all leads from all connections
    const userIds = connections.map(c => c.user_id);
    let leadsQuery = supabase
      .from('leads')
      .select('id, user_id, ghl_contact_id, first_name, last_name, email, phone, status, created_at')
      .in('user_id', userIds);

    if (dateFilter) {
      leadsQuery = leadsQuery.gte('created_at', dateFilter);
    }

    const { data: leads } = await leadsQuery;

    if (!leads || leads.length === 0) {
      return new Response(
        JSON.stringify({ success: true, analyses: [], faqs: [], summary: 'Keine Leads im gewählten Zeitraum gefunden.' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Get all messages for these leads
    const leadIds = leads.map(l => l.id);
    let messagesQuery = supabase
      .from('messages')
      .select('id, lead_id, content, direction, created_at')
      .in('lead_id', leadIds)
      .order('created_at', { ascending: true });

    if (dateFilter) {
      messagesQuery = messagesQuery.gte('created_at', dateFilter);
    }

    const { data: allMessages } = await messagesQuery;

    // Group messages by lead
    const messagesByLead: Record<string, any[]> = {};
    (allMessages || []).forEach(msg => {
      if (!messagesByLead[msg.lead_id]) {
        messagesByLead[msg.lead_id] = [];
      }
      messagesByLead[msg.lead_id].push(msg);
    });

    // Map user_id to location_name
    const userToLocation: Record<string, string> = {};
    connections.forEach(c => {
      userToLocation[c.user_id] = c.location_name || 'Unbekannt';
    });

    // Analyze each lead's conversation
    const analyses: ConversationAnalysis[] = [];
    const allQuestions: string[] = [];

    for (const lead of leads) {
      const messages = messagesByLead[lead.id] || [];

      if (messages.length === 0) {
        continue;
      }

      // Build conversation text
      const conversationText = messages.map(m => {
        const role = m.direction === 'incoming' ? 'Kunde' : 'KI/Makler';
        return `${role}: ${m.content}`;
      }).join('\n');

      // Calculate response times
      let totalResponseTime = 0;
      let responseCount = 0;
      for (let i = 1; i < messages.length; i++) {
        if (messages[i].direction === 'outgoing' && messages[i-1].direction === 'incoming') {
          const respTime = new Date(messages[i].created_at).getTime() - new Date(messages[i-1].created_at).getTime();
          totalResponseTime += respTime;
          responseCount++;
        }
      }
      const avgResponseTime = responseCount > 0 ? Math.round(totalResponseTime / responseCount / 60000) : 0; // in minutes

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
          max_tokens: 2000,
          messages: [{
            role: 'user',
            content: `Du bist ein Analyse-Experte für Immobilien-Kundenservice. Analysiere folgende Konversation.

ANALYSE-KRITERIEN (vom Admin vorgegeben):
${analysis_prompt || 'Bewerte die Qualität der KI-Antworten und ob der Kunde gut betreut wurde.'}

ZIEL A: ${goal_a || 'Termin mit Simpli Finance vereinbaren'}
ZIEL B: ${goal_b || 'Termin mit Makler vereinbaren oder Rückruf vereinbaren'}

KONVERSATION:
${conversationText}

Antworte NUR mit einem JSON-Objekt in diesem Format:
{
  "ai_quality_score": <1-10>,
  "sentiment": "<positive|neutral|negative>",
  "goal_a_status": "<achieved|in_progress|blocked|not_applicable>",
  "goal_a_blockers": ["Blocker 1", "Blocker 2"],
  "goal_b_status": "<achieved|in_progress|blocked|not_applicable>",
  "goal_b_blockers": ["Blocker 1", "Blocker 2"],
  "questions_asked": ["Frage 1", "Frage 2"],
  "unanswered_questions": ["Unbeantwortete Frage 1"],
  "summary": "Kurze Zusammenfassung der Konversation in 1-2 Sätzen"
}`
          }]
        })
      });

      if (!analysisResponse.ok) {
        console.error('Claude API error:', await analysisResponse.text());
        continue;
      }

      const analysisData = await analysisResponse.json();
      let analysis;

      try {
        const content = analysisData.content[0].text;
        // Extract JSON from response
        const jsonMatch = content.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          analysis = JSON.parse(jsonMatch[0]);
        } else {
          console.error('No JSON found in response:', content);
          continue;
        }
      } catch (e) {
        console.error('Failed to parse analysis:', e);
        continue;
      }

      // Collect questions for FAQ
      if (analysis.questions_asked) {
        allQuestions.push(...analysis.questions_asked);
      }

      analyses.push({
        contact_id: lead.id,
        contact_name: `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || lead.email || 'Unbekannt',
        location_name: userToLocation[lead.user_id],
        status: 'analyzed',
        ai_quality_score: analysis.ai_quality_score || 5,
        sentiment: analysis.sentiment || 'neutral',
        goal_a_status: analysis.goal_a_status || 'not_applicable',
        goal_a_blockers: analysis.goal_a_blockers || [],
        goal_b_status: analysis.goal_b_status || 'not_applicable',
        goal_b_blockers: analysis.goal_b_blockers || [],
        questions_asked: analysis.questions_asked || [],
        unanswered_questions: analysis.unanswered_questions || [],
        response_time_avg: avgResponseTime,
        message_count: messages.length,
        summary: analysis.summary || ''
      });
    }

    // Aggregate FAQs with frequency
    const faqMap: Record<string, { count: number; category: string }> = {};

    for (const question of allQuestions) {
      // Normalize question for comparison
      const normalized = question.toLowerCase().trim()
        .replace(/[?!.,]/g, '')
        .replace(/\s+/g, ' ');

      // Check if similar question exists
      let found = false;
      for (const [key, value] of Object.entries(faqMap)) {
        if (isSimilarQuestion(key, normalized)) {
          faqMap[key].count++;
          found = true;
          break;
        }
      }

      if (!found) {
        faqMap[normalized] = { count: 1, category: categorizeQuestion(question) };
      }
    }

    // Convert to FAQ array and sort by frequency
    const faqs: FAQ[] = Object.entries(faqMap)
      .map(([question, data]) => ({
        question: question.charAt(0).toUpperCase() + question.slice(1) + '?',
        frequency: data.count,
        category: data.category
      }))
      .sort((a, b) => b.frequency - a.frequency);

    // Generate overall summary
    const totalAnalyzed = analyses.length;
    const avgQualityScore = analyses.reduce((sum, a) => sum + a.ai_quality_score, 0) / totalAnalyzed || 0;
    const goalABlocked = analyses.filter(a => a.goal_a_status === 'blocked').length;
    const goalBBlocked = analyses.filter(a => a.goal_b_status === 'blocked').length;
    const goalAAchieved = analyses.filter(a => a.goal_a_status === 'achieved').length;
    const goalBAchieved = analyses.filter(a => a.goal_b_status === 'achieved').length;
    const positiveCount = analyses.filter(a => a.sentiment === 'positive').length;
    const negativeCount = analyses.filter(a => a.sentiment === 'negative').length;

    // Collect all unique blockers
    const allGoalABlockers: Record<string, number> = {};
    const allGoalBBlockers: Record<string, number> = {};

    analyses.forEach(a => {
      a.goal_a_blockers.forEach(b => {
        allGoalABlockers[b] = (allGoalABlockers[b] || 0) + 1;
      });
      a.goal_b_blockers.forEach(b => {
        allGoalBBlockers[b] = (allGoalBBlockers[b] || 0) + 1;
      });
    });

    const summary = {
      total_analyzed: totalAnalyzed,
      avg_quality_score: Math.round(avgQualityScore * 10) / 10,
      sentiment_breakdown: {
        positive: positiveCount,
        neutral: totalAnalyzed - positiveCount - negativeCount,
        negative: negativeCount
      },
      goal_a: {
        name: goal_a || 'Termin mit Simpli Finance vereinbaren',
        achieved: goalAAchieved,
        blocked: goalABlocked,
        top_blockers: Object.entries(allGoalABlockers)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([blocker, count]) => ({ blocker, count }))
      },
      goal_b: {
        name: goal_b || 'Termin mit Makler vereinbaren / Rückruf',
        achieved: goalBAchieved,
        blocked: goalBBlocked,
        top_blockers: Object.entries(allGoalBBlockers)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([blocker, count]) => ({ blocker, count }))
      },
      unanswered_questions_total: analyses.reduce((sum, a) => sum + a.unanswered_questions.length, 0)
    };

    return new Response(
      JSON.stringify({
        success: true,
        analyses,
        faqs,
        summary
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Analysis error:', error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' }, status: 500 }
    );
  }
});

// Helper: Check if two questions are similar (basic fuzzy match)
function isSimilarQuestion(q1: string, q2: string): boolean {
  const words1 = q1.split(' ').filter(w => w.length > 3);
  const words2 = q2.split(' ').filter(w => w.length > 3);

  if (words1.length === 0 || words2.length === 0) return false;

  const commonWords = words1.filter(w => words2.includes(w));
  const similarity = commonWords.length / Math.max(words1.length, words2.length);

  return similarity > 0.6;
}

// Helper: Categorize question
function categorizeQuestion(question: string): string {
  const q = question.toLowerCase();

  if (q.includes('preis') || q.includes('kosten') || q.includes('miete') || q.includes('kaufpreis')) {
    return 'Preis/Kosten';
  }
  if (q.includes('besichtig') || q.includes('termin') || q.includes('anschau')) {
    return 'Besichtigung';
  }
  if (q.includes('finanzier') || q.includes('kredit') || q.includes('bank')) {
    return 'Finanzierung';
  }
  if (q.includes('zimmer') || q.includes('quadrat') || q.includes('fläche') || q.includes('größe')) {
    return 'Objektdetails';
  }
  if (q.includes('lage') || q.includes('umgebung') || q.includes('stadtteil') || q.includes('anbindung')) {
    return 'Lage';
  }
  if (q.includes('verfügbar') || q.includes('frei') || q.includes('einzug')) {
    return 'Verfügbarkeit';
  }
  if (q.includes('dokument') || q.includes('unterlag') || q.includes('exposé')) {
    return 'Dokumente';
  }

  return 'Sonstiges';
}
