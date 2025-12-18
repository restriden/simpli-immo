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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { lead_id, message_content, user_id } = await req.json();

    if (!lead_id || !message_content || !user_id) {
      return new Response(
        JSON.stringify({ error: "lead_id, message_content, and user_id required" }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Fetch Lead with Objekt - and check if auto-respond is enabled for THIS lead
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
          etage
        )
      `)
      .eq('id', lead_id)
      .single();

    if (leadError || !lead) {
      return new Response(
        JSON.stringify({ error: "Lead not found" }),
        { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Check if auto-respond is enabled for THIS specific lead (default: false)
    if (!lead.auto_respond_enabled) {
      console.log('Auto-respond disabled for lead:', lead_id);
      return new Response(
        JSON.stringify({ success: false, reason: "auto_respond_disabled_for_lead" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Must have GHL contact to respond
    if (!lead.ghl_contact_id) {
      return new Response(
        JSON.stringify({ success: false, reason: "no_ghl_contact" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 3. Fetch KI-Wissen for this specific Objekt
    let objektWissen: any[] = [];
    if (lead.objekt_id) {
      const { data: wissen } = await supabase
        .from('ki_wissen')
        .select('kategorie, frage, antwort')
        .eq('objekt_id', lead.objekt_id);

      objektWissen = wissen || [];
    }

    // 4. Fetch Makler Profile
    const { data: maklerProfile } = await supabase
      .from('profiles')
      .select('full_name, company_name, company_phone, company_email')
      .eq('id', user_id)
      .single();

    // 5. Fetch recent conversation for context
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

    // 6. Build context for response generation
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
- Beschreibung: ${lead.objekt.beschreibung || 'Keine Beschreibung'}
` : 'KEIN OBJEKT ZUGEORDNET.';

    const wissenContext = objektWissen.length > 0 ? `
ZUSÄTZLICHES WISSEN ZU DIESEM OBJEKT:
${objektWissen.map(w => `- ${w.kategorie}: ${w.frage} → ${w.antwort}`).join('\n')}
` : '';

    const maklerContext = maklerProfile ? `
MAKLER-INFORMATIONEN:
- Name: ${maklerProfile.full_name || 'Ihr Makler'}
- Firma: ${maklerProfile.company_name || ''}
- Telefon: ${maklerProfile.company_phone || ''}
- E-Mail: ${maklerProfile.company_email || ''}
` : '';

    // 7. Generate response with Claude
    const systemPrompt = `Du bist ein freundlicher KI-Assistent für den Immobilienmakler "${maklerProfile?.full_name || 'den Makler'}".
Du antwortest auf Kundenanfragen zu Immobilien.

WICHTIGE REGELN:
1. Antworte NUR mit Informationen aus den gegebenen Objekt-Daten
2. Wenn du etwas nicht weißt, sage es ehrlich und biete an, dass der Makler sich meldet
3. Sei freundlich, professionell und prägnant
4. Verwende "Sie" (formell)
5. Antworte auf Deutsch
6. Halte Antworten kurz (max 2-3 Sätze)
7. NIEMALS Informationen von anderen Objekten verwenden!
8. Bei Terminanfragen: Biete an, dass der Makler sich für einen Termin meldet
9. Unterschreibe NICHT mit deinem Namen - du antwortest im Namen des Maklers

${objektContext}
${wissenContext}
${maklerContext}

LETZTE NACHRICHTEN:
${conversationHistory}

Wenn du die Frage NICHT mit den vorhandenen Informationen beantworten kannst, antworte mit:
"CANNOT_ANSWER: [Grund]"

Ansonsten antworte direkt mit der Nachricht für den Kunden (ohne Anführungszeichen).`;

    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: "claude-3-haiku-20240307",
        max_tokens: 500,
        messages: [
          {
            role: "user",
            content: `Kunde "${lead.name}" fragt:\n\n"${message_content}"\n\nBitte antworte.`,
          },
        ],
        system: systemPrompt,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Anthropic API error:', errorText);
      return new Response(
        JSON.stringify({ error: "AI response generation failed" }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const aiResponse = await response.json();
    const generatedResponse = aiResponse.content[0]?.text?.trim() || '';

    // Check if AI can't answer
    if (generatedResponse.startsWith('CANNOT_ANSWER:')) {
      const reason = generatedResponse.replace('CANNOT_ANSWER:', '').trim();
      console.log('AI cannot answer:', reason);
      return new Response(
        JSON.stringify({ success: false, reason: "cannot_answer", details: reason }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 8. Get GHL connection and send message
    const { data: ghlConnection } = await supabase
      .from('ghl_connections')
      .select('access_token, location_id')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .single();

    if (!ghlConnection) {
      return new Response(
        JSON.stringify({ success: false, reason: "no_ghl_connection" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // Send via GHL API
    const ghlResponse = await fetch(`${GHL_API_BASE}/conversations/messages`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${ghlConnection.access_token}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
      body: JSON.stringify({
        type: 'WhatsApp', // Default to WhatsApp
        contactId: lead.ghl_contact_id,
        message: generatedResponse,
      }),
    });

    let ghlResult = null;
    if (ghlResponse.ok) {
      ghlResult = await ghlResponse.json();
      console.log('Message sent via GHL:', ghlResult);
    } else {
      const ghlError = await ghlResponse.text();
      console.error('GHL send error:', ghlError);
      return new Response(
        JSON.stringify({ success: false, reason: "ghl_send_failed", details: ghlError }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    // 9. Save the AI message to our database
    const { data: savedMessage } = await supabase
      .from('messages')
      .insert({
        user_id: user_id,
        lead_id: lead_id,
        content: generatedResponse,
        type: 'outgoing',
        is_ai_generated: true,
        ghl_message_id: ghlResult?.messageId || ghlResult?.id,
        ghl_conversation_id: ghlResult?.conversationId,
        ghl_data: {
          auto_response: true,
          original_question: message_content,
          objekt_context: lead.objekt?.name,
        },
      })
      .select()
      .single();

    // 10. Update lead's last_message_at
    await supabase
      .from('leads')
      .update({
        last_message_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('id', lead_id);

    return new Response(
      JSON.stringify({
        success: true,
        response_sent: generatedResponse,
        message_id: savedMessage?.id,
        ghl_message_id: ghlResult?.messageId || ghlResult?.id,
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
