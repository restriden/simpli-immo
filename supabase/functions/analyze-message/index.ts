import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;

interface AnalysisResult {
  is_question: boolean;
  category: 'frage_unbeantwortet' | 'rueckruf_gewuenscht' | 'termin_anfrage' | 'dokument_anfrage' | 'allgemein' | 'keine_aktion';
  urgency: 'hoch' | 'mittel' | 'niedrig';
  topic_summary: string;
  suggested_response: string | null;
  should_create_task: boolean;
  task_title: string | null;
  task_description: string | null;
  can_auto_respond: boolean;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { message_id, message_content, lead_id } = await req.json();

    if (!message_content || !lead_id) {
      return new Response(
        JSON.stringify({ error: "message_content and lead_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch Lead with associated Objekt
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select(`
        id,
        name,
        email,
        phone,
        status,
        user_id,
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

    // 2. Fetch KI-Wissen for this specific Objekt (CRITICAL: only this objekt!)
    let objektWissen: any[] = [];
    if (lead.objekt_id) {
      const { data: wissen } = await supabase
        .from('ki_wissen')
        .select('kategorie, frage, antwort')
        .eq('objekt_id', lead.objekt_id);

      objektWissen = wissen || [];
    }

    // 3. Fetch Makler Profile (general info about the agent)
    const { data: maklerProfile } = await supabase
      .from('profiles')
      .select('full_name, company_name, company_address, company_phone, company_email, company_website')
      .eq('id', lead.user_id)
      .single();

    // 4. Fetch recent conversation history (last 10 messages for context)
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

    // 5. Build context for Claude
    const objektContext = lead.objekt ? `
OBJEKT-INFORMATIONEN (NUR DIESES OBJEKT VERWENDEN!):
- Name: ${lead.objekt.name || 'Nicht angegeben'}
- Adresse: ${lead.objekt.adresse || 'Nicht angegeben'}, ${lead.objekt.plz || ''} ${lead.objekt.stadt || ''}
- Preis: ${lead.objekt.preis ? `${lead.objekt.preis.toLocaleString('de-DE')} €` : 'Nicht angegeben'}
- Wohnfläche: ${lead.objekt.wohnflaeche ? `${lead.objekt.wohnflaeche} m²` : 'Nicht angegeben'}
- Zimmer: ${lead.objekt.zimmer || 'Nicht angegeben'}
- Typ: ${lead.objekt.typ || 'Nicht angegeben'}
- Baujahr: ${lead.objekt.baujahr || 'Nicht angegeben'}
- Etage: ${lead.objekt.etage || 'Nicht angegeben'}
- Beschreibung: ${lead.objekt.beschreibung || 'Keine Beschreibung'}
` : 'KEIN OBJEKT ZUGEORDNET - Kunde hat noch kein spezifisches Interesse angegeben.';

    const wissenContext = objektWissen.length > 0 ? `
ZUSÄTZLICHES WISSEN ZU DIESEM OBJEKT:
${objektWissen.map(w => `- ${w.kategorie}: ${w.frage} → ${w.antwort}`).join('\n')}
` : '';

    const maklerContext = maklerProfile ? `
MAKLER-INFORMATIONEN:
- Name: ${maklerProfile.full_name || 'Nicht angegeben'}
- Firma: ${maklerProfile.company_name || 'Nicht angegeben'}
- Adresse: ${maklerProfile.company_address || 'Nicht angegeben'}
- Telefon: ${maklerProfile.company_phone || 'Nicht angegeben'}
- E-Mail: ${maklerProfile.company_email || 'Nicht angegeben'}
- Website: ${maklerProfile.company_website || 'Nicht angegeben'}
` : '';

    // 6. Call Claude API for analysis
    const systemPrompt = `Du bist ein KI-Assistent für einen Immobilienmakler. Deine Aufgabe ist es, eingehende Kundennachrichten zu analysieren.

KRITISCH WICHTIG:
- Verwende NUR die Informationen aus dem zugeordneten Objekt!
- Verwechsle NIEMALS Objekte oder deren Daten!
- Wenn keine Objekt-Informationen vorhanden sind, sage dass du die Info nicht hast.

${objektContext}
${wissenContext}
${maklerContext}

LETZTE NACHRICHTEN IM CHAT:
${conversationHistory || 'Keine vorherigen Nachrichten'}

ANALYSE-AUFGABE:
Analysiere die neue Nachricht des Kunden und gib eine JSON-Antwort zurück.

Kategorien:
- "frage_unbeantwortet": Kunde stellt eine Frage die beantwortet werden muss
- "rueckruf_gewuenscht": Kunde bittet um Rückruf
- "termin_anfrage": Kunde möchte einen Termin (Besichtigung etc.)
- "dokument_anfrage": Kunde fragt nach Dokumenten (Exposé, Grundriss, etc.)
- "allgemein": Allgemeine Nachricht ohne spezifische Aktion
- "keine_aktion": Reine Info-Nachricht, Danke, etc.

Dringlichkeit:
- "hoch": Direkte Frage, Zeitdruck, Kaufinteresse
- "mittel": Allgemeine Anfrage
- "niedrig": Informativ, keine Eile

can_auto_respond: true wenn du die Frage mit den vorhandenen Objekt-Informationen beantworten kannst.

Antworte NUR mit validem JSON im folgenden Format:
{
  "is_question": boolean,
  "category": "frage_unbeantwortet" | "rueckruf_gewuenscht" | "termin_anfrage" | "dokument_anfrage" | "allgemein" | "keine_aktion",
  "urgency": "hoch" | "mittel" | "niedrig",
  "topic_summary": "Kurze Zusammenfassung des Themas (max 50 Zeichen)",
  "suggested_response": "Vorgeschlagene Antwort oder null",
  "should_create_task": boolean,
  "task_title": "Aufgaben-Titel oder null",
  "task_description": "Aufgaben-Beschreibung oder null",
  "can_auto_respond": boolean
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
        max_tokens: 1024,
        messages: [
          {
            role: "user",
            content: `Neue Nachricht vom Kunden "${lead.name}":\n\n"${message_content}"\n\nAnalysiere diese Nachricht.`,
          },
        ],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', errorText);
      return new Response(
        JSON.stringify({ error: "AI analysis failed", details: errorText }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResponse = await response.json();
    const analysisText = aiResponse.content[0]?.text || '{}';

    // Parse JSON response
    let analysis: AnalysisResult;
    try {
      // Extract JSON from response (in case there's extra text)
      const jsonMatch = analysisText.match(/\{[\s\S]*\}/);
      analysis = JSON.parse(jsonMatch ? jsonMatch[0] : analysisText);
    } catch (parseError) {
      console.error('Failed to parse AI response:', analysisText);
      analysis = {
        is_question: false,
        category: 'allgemein',
        urgency: 'niedrig',
        topic_summary: 'Analyse fehlgeschlagen',
        suggested_response: null,
        should_create_task: false,
        task_title: null,
        task_description: null,
        can_auto_respond: false,
      };
    }

    // 7. Create Task if needed
    let createdTask = null;
    if (analysis.should_create_task && analysis.task_title) {
      const taskType = analysis.category === 'rueckruf_gewuenscht' ? 'anruf'
        : analysis.category === 'termin_anfrage' ? 'besichtigung'
        : analysis.category === 'dokument_anfrage' ? 'dokument'
        : 'nachricht';

      const { data: newTask, error: taskError } = await supabase
        .from('todos')
        .insert({
          user_id: lead.user_id,
          lead_id: lead_id,
          objekt_id: lead.objekt_id,
          type: taskType,
          priority: analysis.urgency === 'hoch' ? 'dringend' : 'normal',
          title: analysis.task_title,
          subtitle: analysis.task_description,
          completed: false,
          due_date: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(), // Tomorrow
        })
        .select()
        .single();

      if (!taskError && newTask) {
        createdTask = newTask;
        console.log('Created task:', newTask.id);
      } else {
        console.error('Failed to create task:', taskError);
      }
    }

    // 8. Update message with analysis metadata (if message_id provided)
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
              can_auto_respond: analysis.can_auto_respond,
              analyzed_at: new Date().toISOString(),
            }
          }
        })
        .eq('id', message_id);
    }

    return new Response(
      JSON.stringify({
        success: true,
        analysis,
        created_task: createdTask,
        context: {
          lead_name: lead.name,
          objekt_name: lead.objekt?.name || null,
          has_objekt_wissen: objektWissen.length > 0,
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
