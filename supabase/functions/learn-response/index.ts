import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

interface LearnResult {
  learned: boolean;
  knowledge_type: 'objekt_spezifisch' | 'allgemein' | 'keine';
  category: string;
  question: string;
  answer: string;
  saved_to: 'ki_wissen' | 'none';
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      message_id,        // The outgoing message from Makler
      lead_id,
      user_id,
      response_content   // What the Makler wrote
    } = await req.json();

    if (!lead_id || !user_id || !response_content) {
      return new Response(
        JSON.stringify({ error: "lead_id, user_id, and response_content required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Get the lead with objekt info
    const { data: lead } = await supabase
      .from('leads')
      .select('id, name, objekt_id, objekt:objekte(id, name)')
      .eq('id', lead_id)
      .single();

    if (!lead) {
      return new Response(
        JSON.stringify({ error: "Lead not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Find the most recent unanswered question from this lead
    // Look for incoming messages with is_question=true in ghl_data.analysis
    const { data: recentMessages } = await supabase
      .from('messages')
      .select('id, content, type, ghl_data, created_at')
      .eq('lead_id', lead_id)
      .order('created_at', { ascending: false })
      .limit(10);

    // Find the last question before this response
    let questionMessage = null;
    let questionFound = false;

    for (const msg of recentMessages || []) {
      if (questionFound) break;

      if (msg.type === 'incoming' && msg.ghl_data?.analysis?.is_question) {
        questionMessage = msg;
        questionFound = true;
      }
    }

    if (!questionMessage) {
      // No pending question found - nothing to learn
      return new Response(
        JSON.stringify({
          success: true,
          learned: false,
          reason: 'No pending question found',
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Use AI to determine if this is worth learning and categorize
    const systemPrompt = `Du analysierst eine Frage-Antwort-Konversation und entscheidest, ob die Antwort als Wissen gespeichert werden soll.

AUFGABE:
1. Bestimme, ob die Antwort nützliches Wissen enthält (nicht nur "Ich melde mich" oder "Danke")
2. Kategorisiere als objekt_spezifisch (Aufzug, Keller, Balkon, Heizung, Nebenkosten, etc.) oder allgemein (Öffnungszeiten, Telefon, Erreichbarkeit, Firma)
3. Formuliere Frage und Antwort kurz und prägnant für die Wissensdatenbank

OBJEKT-KONTEXT: ${lead.objekt ? lead.objekt.name : 'Kein Objekt zugeordnet'}

Antworte NUR mit validem JSON:
{
  "should_learn": true/false,
  "knowledge_type": "objekt_spezifisch" | "allgemein" | "keine",
  "category": "kategorie z.B. ausstattung, nebenkosten, kontakt, erreichbarkeit",
  "question_formatted": "Kurze, klare Frage",
  "answer_formatted": "Kurze, klare Antwort"
}`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 512,
        messages: [
          {
            role: "user",
            content: `FRAGE VOM KUNDEN:\n"${questionMessage.content}"\n\nANTWORT VOM MAKLER:\n"${response_content}"\n\nAnalysiere und entscheide.`,
          },
        ],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      console.error('Anthropic API error:', await response.text());
      return new Response(
        JSON.stringify({ success: false, error: "AI analysis failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResponse = await response.json();
    const analysisText = aiResponse.content[0]?.text || '{}';

    let analysis;
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      analysis = JSON.parse(jsonMatch ? jsonMatch[0] : analysisText);
    } catch (e) {
      console.error('Failed to parse AI response:', analysisText);
      return new Response(
        JSON.stringify({ success: false, error: "Failed to parse AI response" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 4. Save to ki_wissen if should_learn is true
    if (analysis.should_learn && analysis.knowledge_type !== 'keine') {
      const isObjektSpecific = analysis.knowledge_type === 'objekt_spezifisch';

      // Check if similar knowledge already exists
      const existingQuery = supabase
        .from('ki_wissen')
        .select('id, frage, antwort')
        .eq('user_id', user_id)
        .ilike('frage', `%${analysis.question_formatted.substring(0, 20)}%`);

      if (isObjektSpecific && lead.objekt_id) {
        existingQuery.eq('objekt_id', lead.objekt_id);
      } else {
        existingQuery.is('objekt_id', null);
      }

      const { data: existing } = await existingQuery;

      if (existing && existing.length > 0) {
        // Update existing knowledge
        await supabase
          .from('ki_wissen')
          .update({
            antwort: analysis.answer_formatted,
            kategorie: analysis.category,
          })
          .eq('id', existing[0].id);

        console.log('Updated existing knowledge:', existing[0].id);

        return new Response(
          JSON.stringify({
            success: true,
            learned: true,
            action: 'updated',
            knowledge_type: analysis.knowledge_type,
            category: analysis.category,
            question: analysis.question_formatted,
            answer: analysis.answer_formatted,
            objekt: isObjektSpecific ? lead.objekt?.name : null,
          }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      // Insert new knowledge
      const { data: newKnowledge, error: insertError } = await supabase
        .from('ki_wissen')
        .insert({
          user_id: user_id,
          objekt_id: isObjektSpecific ? lead.objekt_id : null,
          kategorie: analysis.category,
          frage: analysis.question_formatted,
          antwort: analysis.answer_formatted,
        })
        .select()
        .single();

      if (insertError) {
        console.error('Failed to save knowledge:', insertError);
        return new Response(
          JSON.stringify({ success: false, error: "Failed to save knowledge" }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      console.log('Saved new knowledge:', newKnowledge.id);

      // Mark the question as answered/learned
      await supabase
        .from('messages')
        .update({
          ghl_data: {
            ...questionMessage.ghl_data,
            analysis: {
              ...questionMessage.ghl_data?.analysis,
              knowledge_saved: true,
              knowledge_id: newKnowledge.id,
            }
          }
        })
        .eq('id', questionMessage.id);

      return new Response(
        JSON.stringify({
          success: true,
          learned: true,
          action: 'created',
          knowledge_type: analysis.knowledge_type,
          category: analysis.category,
          question: analysis.question_formatted,
          answer: analysis.answer_formatted,
          objekt: isObjektSpecific ? lead.objekt?.name : null,
          knowledge_id: newKnowledge.id,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Not worth learning
    return new Response(
      JSON.stringify({
        success: true,
        learned: false,
        reason: analysis.should_learn ? 'Unknown' : 'Response not worth saving',
        knowledge_type: analysis.knowledge_type,
      }),
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
