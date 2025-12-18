import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

// NOTE: Auto-respond is disabled - using GHL's AI for WhatsApp responses
// This handler only analyzes messages and creates tasks

interface AnalysisResult {
  category: string;
  urgency: 'hoch' | 'mittel' | 'niedrig';
  topic_summary: string;
  is_question: boolean;
  question_type: 'objekt_spezifisch' | 'allgemein' | 'keine';
  should_create_task: boolean;
  task_title: string | null;
  task_description: string | null;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { message_id, message_content, lead_id, user_id } = await req.json();

    if (!message_content || !lead_id || !user_id) {
      return new Response(
        JSON.stringify({ error: "message_content, lead_id, and user_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch Lead with Objekt
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select(`
        id,
        name,
        email,
        phone,
        ghl_contact_id,
        objekt_id,
        objekt:objekte (
          id,
          name,
          adresse,
          stadt,
          plz,
          preis,
          wohnflaeche,
          zimmer,
          typ,
          beschreibung,
          baujahr,
          etage
        )
      `)
      .eq('id', lead_id)
      .single();

    if (leadError || !lead) {
      console.error('Lead not found:', leadError);
      return new Response(
        JSON.stringify({ error: "Lead not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 2. Fetch recent conversation for context
    const { data: recentMessages } = await supabase
      .from('messages')
      .select('content, type, created_at')
      .eq('lead_id', lead_id)
      .order('created_at', { ascending: false })
      .limit(10);

    const conversationHistory = (recentMessages || [])
      .reverse()
      .map(m => `${m.type === 'incoming' ? 'Kunde' : 'Makler'}: ${m.content}`)
      .join('\n');

    // 3. Build context
    const objektContext = lead.objekt ? `
OBJEKT-INFORMATIONEN:
- Name: ${lead.objekt.name || 'Nicht angegeben'}
- Adresse: ${lead.objekt.adresse || 'Nicht angegeben'}, ${lead.objekt.plz || ''} ${lead.objekt.stadt || ''}
- Preis: ${lead.objekt.preis ? `${lead.objekt.preis.toLocaleString('de-DE')} €` : 'Auf Anfrage'}
- Wohnfläche: ${lead.objekt.wohnflaeche ? `${lead.objekt.wohnflaeche} m²` : 'Nicht angegeben'}
- Zimmer: ${lead.objekt.zimmer || 'Nicht angegeben'}
- Typ: ${lead.objekt.typ || 'Nicht angegeben'}
` : 'KEIN OBJEKT ZUGEORDNET.';

    // 4. Build analysis-only prompt
    const systemPrompt = `Du bist ein KI-Assistent der Kundenanfragen für einen Immobilienmakler ANALYSIERT.
Du entscheidest, ob ein Task für den Makler erstellt werden muss.

${objektContext}

LETZTE NACHRICHTEN:
${conversationHistory || 'Keine vorherigen Nachrichten'}

DEINE AUFGABE:
Analysiere die Nachricht und entscheide ob ein Task erstellt werden muss.
Antworte NUR mit validem JSON:

{
  "category": "frage_objekt" | "frage_allgemein" | "rueckruf" | "termin" | "dokument" | "finanzierung" | "preisverhandlung" | "kaufinteresse" | "beschwerde" | "absage" | "allgemein" | "keine_aktion",
  "urgency": "hoch" | "mittel" | "niedrig",
  "topic_summary": "Kurze Zusammenfassung (max 40 Zeichen)",
  "is_question": true/false,
  "question_type": "objekt_spezifisch" | "allgemein" | "keine",
  "should_create_task": true/false,
  "task_title": "Task-Titel oder null",
  "task_description": "Task-Beschreibung oder null"
}

KATEGORIEN & DRINGLICHKEIT:
- rueckruf: Kunde möchte zurückgerufen werden → Task erstellen
- termin: Besichtigungsanfrage → Task erstellen
- dokument: Exposé, Grundriss angefordert → Task erstellen
- finanzierung: Fragen zur Finanzierung → Task erstellen
- preisverhandlung: Preis verhandeln (DRINGEND!) → Task erstellen
- kaufinteresse: Starkes Kaufinteresse (DRINGEND!) → Task erstellen
- beschwerde: Kunde unzufrieden (DRINGEND!) → Task erstellen
- absage: Kein Interesse mehr → Task erstellen
- frage_objekt: Frage zum Objekt → Task erstellen
- frage_allgemein: Allgemeine Frage → Task erstellen
- allgemein: Sonstiges → Task nur wenn Handlung nötig
- keine_aktion: Danke, OK, Bestätigung → KEIN Task`;

    // 5. Call Claude API
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `Neue Nachricht von "${lead.name}":\n\n"${message_content}"\n\nAnalysiere und generiere Antwort.`,
          },
        ],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', errorText);
      return new Response(
        JSON.stringify({ error: "AI analysis failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResponse = await response.json();
    const analysisText = aiResponse.content[0]?.text || '{}';

    // Parse JSON response
    let analysis: AnalysisResult;
    try {
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      analysis = JSON.parse(jsonMatch ? jsonMatch[0] : analysisText);
    } catch (parseError) {
      console.error('Failed to parse AI response:', analysisText);
      analysis = {
        category: 'allgemein',
        urgency: 'niedrig',
        topic_summary: 'Analyse fehlgeschlagen',
        is_question: false,
        question_type: 'keine',
        should_create_task: true,
        task_title: 'Nachricht prüfen',
        task_description: message_content,
      };
    }

    // 6. Create Task if needed
    let createdTask = null;
    if (analysis.should_create_task && analysis.task_title) {
      const taskTypeMap: Record<string, string> = {
        rueckruf: 'anruf',
        termin: 'besichtigung',
        dokument: 'dokument',
        finanzierung: 'finanzierung',
        frage_objekt: 'nachricht',
        frage_allgemein: 'nachricht',
        preisverhandlung: 'nachricht',
        kaufinteresse: 'nachricht',
        beschwerde: 'nachricht',
        absage: 'nachricht',
      };

      const taskType = taskTypeMap[analysis.category] || 'nachricht';
      const priority = ['preisverhandlung', 'kaufinteresse', 'beschwerde'].includes(analysis.category)
        ? 'dringend' : 'normal';

      const { data: newTask, error: taskError } = await supabase
        .from('todos')
        .insert({
          user_id: user_id,
          lead_id: lead_id,
          objekt_id: lead.objekt_id,
          type: taskType,
          priority: priority,
          title: analysis.task_title,
          subtitle: analysis.task_description,
          completed: false,
          due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
          ghl_data: {
            original_message: message_content,
            question_type: analysis.question_type,
          },
        })
        .select()
        .single();

      if (!taskError && newTask) {
        createdTask = newTask;
        console.log('Created task:', newTask.id);
      }
    }

    // 7. Update message with analysis
    if (message_id) {
      await supabase
        .from('messages')
        .update({
          ghl_data: {
            analysis: {
              category: analysis.category,
              urgency: analysis.urgency,
              is_question: analysis.is_question,
              topic_summary: analysis.topic_summary,
              analyzed_at: new Date().toISOString(),
            }
          }
        })
        .eq('id', message_id);
    }

    // NOTE: Auto-respond removed - using GHL's AI instead

    return new Response(
      JSON.stringify({
        success: true,
        analysis: {
          category: analysis.category,
          urgency: analysis.urgency,
          topic_summary: analysis.topic_summary,
          is_question: analysis.is_question,
        },
        created_task: createdTask,
        context: {
          lead_name: lead.name,
          objekt_name: lead.objekt?.name,
        }
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
