import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY")!;
const GHL_API_BASE = "https://services.leadconnectorhq.com";

// Financing modes and their prompts
const FINANCING_PROMPTS: Record<string, string> = {
  simpli_pflicht: `
FINANZIERUNG - SIMPLI FINANCE PFLICHT:
Bei diesem Objekt ist eine Finanzierungsbestätigung über Simpli Finance ERFORDERLICH vor einer Besichtigung.
- Wenn Kunde nach Besichtigung fragt: "Gerne! Für eine Besichtigung benötigen wir vorab eine Finanzierungsbestätigung über unseren Partner Simpli Finance. Das ist kostenlos und dauert nur wenige Minuten. Soll ich Ihnen den Link zusenden?"
- Vorteile erwähnen: Schnelle Zusage, kostenlos, unverbindlich
- Bei Widerstand: Freundlich erklären, dass dies im Interesse aller Beteiligten ist`,

  finanzierung_pflicht: `
FINANZIERUNG - BESTÄTIGUNG PFLICHT (EXTERN MÖGLICH):
Bei diesem Objekt ist eine Finanzierungsbestätigung ERFORDERLICH vor einer Besichtigung.
- Der Kunde kann seine eigene Bank oder einen anderen Finanzierungspartner nutzen
- Wenn Kunde nach Besichtigung fragt: "Gerne! Für eine Besichtigung benötigen wir vorab eine Finanzierungsbestätigung. Diese können Sie von Ihrer Bank oder einem Finanzierungspartner Ihrer Wahl erhalten."
- Nicht auf Simpli Finance drängen`,

  keine_pflicht: `
FINANZIERUNG - KEINE PFLICHT:
Bei diesem Objekt ist KEINE Finanzierungsbestätigung vor der Besichtigung erforderlich.
- Besichtigungstermine können direkt vereinbart werden
- Bei Finanzierungsfragen: "Bei der Finanzierung können wir Sie gerne unterstützen, aber das ist keine Voraussetzung für eine Besichtigung."`,
};

interface AnalysisResult {
  category: string;
  urgency: 'hoch' | 'mittel' | 'niedrig';
  topic_summary: string;
  is_question: boolean;
  question_type: 'objekt_spezifisch' | 'allgemein' | 'keine';
  should_create_task: boolean;
  task_title: string | null;
  task_description: string | null;
  suggested_response: string | null;
  can_auto_respond: boolean;
  missing_knowledge: string | null;
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

    // 1. Fetch Lead with Objekt (including financing mode)
    const { data: lead, error: leadError } = await supabase
      .from('leads')
      .select(`
        id,
        name,
        email,
        phone,
        ghl_contact_id,
        objekt_id,
        auto_respond_enabled,
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
          etage,
          financing_mode
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

    // 2. Fetch KI-Wissen for this specific Objekt
    let objektWissen: any[] = [];
    if (lead.objekt_id) {
      const { data: wissen } = await supabase
        .from('ki_wissen')
        .select('kategorie, frage, antwort')
        .eq('objekt_id', lead.objekt_id);
      objektWissen = wissen || [];
    }

    // 3. Fetch general knowledge (Allgemeinwissen) from profile
    const { data: generalKnowledge } = await supabase
      .from('ki_wissen')
      .select('kategorie, frage, antwort')
      .eq('user_id', user_id)
      .is('objekt_id', null);

    // 4. Fetch Makler Profile
    const { data: maklerProfile } = await supabase
      .from('profiles')
      .select('full_name, company_name, company_address, company_phone, company_email, company_website')
      .eq('id', user_id)
      .single();

    // 5. Fetch recent conversation
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

    // 6. Build context
    const objektContext = lead.objekt ? `
OBJEKT-INFORMATIONEN (NUR DIESES OBJEKT!):
- Name: ${lead.objekt.name || 'Nicht angegeben'}
- Adresse: ${lead.objekt.adresse || 'Nicht angegeben'}, ${lead.objekt.plz || ''} ${lead.objekt.stadt || ''}
- Preis: ${lead.objekt.preis ? `${lead.objekt.preis.toLocaleString('de-DE')} €` : 'Auf Anfrage'}
- Wohnfläche: ${lead.objekt.wohnflaeche ? `${lead.objekt.wohnflaeche} m²` : 'Nicht angegeben'}
- Zimmer: ${lead.objekt.zimmer || 'Nicht angegeben'}
- Typ: ${lead.objekt.typ || 'Nicht angegeben'}
- Baujahr: ${lead.objekt.baujahr || 'Nicht angegeben'}
- Etage: ${lead.objekt.etage || 'Nicht angegeben'}
- Beschreibung: ${lead.objekt.beschreibung || 'Keine'}
` : 'KEIN OBJEKT ZUGEORDNET.';

    const financingMode = lead.objekt?.financing_mode || 'keine_pflicht';
    const financingPrompt = FINANCING_PROMPTS[financingMode] || FINANCING_PROMPTS.keine_pflicht;

    const wissenContext = objektWissen.length > 0 ? `
WISSEN ZU DIESEM OBJEKT:
${objektWissen.map(w => `- ${w.frage} → ${w.antwort}`).join('\n')}
` : '';

    const generalContext = (generalKnowledge || []).length > 0 ? `
ALLGEMEINWISSEN (Makler/Firma):
${generalKnowledge!.map(w => `- ${w.frage} → ${w.antwort}`).join('\n')}
` : '';

    const maklerContext = maklerProfile ? `
MAKLER-INFORMATIONEN:
- Name: ${maklerProfile.full_name || 'Ihr Makler'}
- Firma: ${maklerProfile.company_name || ''}
- Adresse: ${maklerProfile.company_address || ''}
- Telefon: ${maklerProfile.company_phone || ''}
- E-Mail: ${maklerProfile.company_email || ''}
- Website: ${maklerProfile.company_website || ''}
` : '';

    // 7. Build comprehensive prompt
    const systemPrompt = `Du bist ein KI-Assistent für den Immobilienmakler "${maklerProfile?.full_name || 'den Makler'}".
Du analysierst Kundenanfragen UND generierst passende Antworten.

KRITISCHE REGELN:
1. Verwende NUR Informationen aus dem zugeordneten Objekt - NIEMALS andere Objekte verwechseln!
2. Sei freundlich, professionell und prägnant (max 2-3 Sätze)
3. Verwende "Sie" (formell)
4. Wenn du etwas nicht weißt, sage es ehrlich
5. Bei Terminanfragen beachte die Finanzierungsregeln!

${objektContext}
${financingPrompt}
${wissenContext}
${generalContext}
${maklerContext}

LETZTE NACHRICHTEN:
${conversationHistory || 'Keine vorherigen Nachrichten'}

DEINE AUFGABE:
Analysiere die Nachricht und generiere eine Antwort. Antworte NUR mit validem JSON:

{
  "category": "frage_objekt" | "frage_allgemein" | "rueckruf" | "termin" | "dokument" | "finanzierung" | "preisverhandlung" | "kaufinteresse" | "beschwerde" | "absage" | "allgemein" | "keine_aktion",
  "urgency": "hoch" | "mittel" | "niedrig",
  "topic_summary": "Kurze Zusammenfassung (max 40 Zeichen)",
  "is_question": true/false,
  "question_type": "objekt_spezifisch" | "allgemein" | "keine",
  "should_create_task": true/false,
  "task_title": "Task-Titel oder null",
  "task_description": "Task-Beschreibung oder null",
  "suggested_response": "Deine Antwort an den Kunden (immer generieren!)",
  "can_auto_respond": true/false,
  "missing_knowledge": "Was fehlt um zu antworten? (oder null)"
}

KATEGORIEN:
- frage_objekt: Frage zum Objekt (Aufzug, Keller, Balkon, etc.)
- frage_allgemein: Allgemeine Frage (Öffnungszeiten, Kontakt)
- rueckruf: Kunde möchte zurückgerufen werden
- termin: Besichtigungsanfrage (FINANZIERUNGSREGELN BEACHTEN!)
- dokument: Exposé, Grundriss angefordert
- finanzierung: Fragen zur Finanzierung
- preisverhandlung: Preis verhandeln, Angebot machen (DRINGEND!)
- kaufinteresse: Starkes Kaufinteresse (DRINGEND!)
- beschwerde: Kunde unzufrieden (DRINGEND!)
- absage: Kein Interesse mehr
- allgemein: Sonstiges
- keine_aktion: Danke, OK, Bestätigung

WANN TASK ERSTELLEN:
- can_auto_respond=false → Task erstellen
- Kategorien rueckruf, termin, dokument, preisverhandlung, kaufinteresse, beschwerde, absage → Task erstellen
- Kategorie frage_* UND missing_knowledge nicht null → Task erstellen`;

    // 8. Call Claude API
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
        suggested_response: null,
        can_auto_respond: false,
        missing_knowledge: null,
      };
    }

    // 9. Create Task if needed
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
            suggested_response: analysis.suggested_response,
            missing_knowledge: analysis.missing_knowledge,
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

    // 10. Update message with analysis
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

    // 11. Auto-respond if enabled AND can_auto_respond
    let responseSent = false;
    let sentMessage = null;

    if (lead.auto_respond_enabled && analysis.can_auto_respond && analysis.suggested_response && lead.ghl_contact_id) {
      // Get GHL connection
      const { data: ghlConnection } = await supabase
        .from('ghl_connections')
        .select('access_token')
        .eq('user_id', user_id)
        .eq('is_active', true)
        .single();

      if (ghlConnection) {
        // Send via GHL
        const ghlResponse = await fetch(`${GHL_API_BASE}/conversations/messages`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${ghlConnection.access_token}`,
            'Content-Type': 'application/json',
            'Version': '2021-07-28',
          },
          body: JSON.stringify({
            type: 'WhatsApp',
            contactId: lead.ghl_contact_id,
            message: analysis.suggested_response,
          }),
        });

        if (ghlResponse.ok) {
          const ghlResult = await ghlResponse.json();
          responseSent = true;

          // Save to messages
          const { data: savedMsg } = await supabase
            .from('messages')
            .insert({
              user_id: user_id,
              lead_id: lead_id,
              content: analysis.suggested_response,
              type: 'outgoing',
              is_ai_generated: true,
              ghl_message_id: ghlResult?.messageId || ghlResult?.id,
              ghl_data: {
                auto_response: true,
                category: analysis.category,
              },
            })
            .select()
            .single();

          sentMessage = savedMsg;
          console.log('Auto-response sent:', analysis.suggested_response);
        }
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        analysis: {
          category: analysis.category,
          urgency: analysis.urgency,
          topic_summary: analysis.topic_summary,
          is_question: analysis.is_question,
          can_auto_respond: analysis.can_auto_respond,
        },
        suggested_response: analysis.suggested_response,
        response_sent: responseSent,
        sent_message: sentMessage,
        created_task: createdTask,
        context: {
          lead_name: lead.name,
          objekt_name: lead.objekt?.name,
          financing_mode: financingMode,
          auto_respond_enabled: lead.auto_respond_enabled,
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
