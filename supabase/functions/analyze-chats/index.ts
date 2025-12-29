import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Own account location IDs - exclude these (only analyze Makler chats)
const OWN_ACCOUNT_LOCATION_IDS = [
  "iDLo7b4WOOCkE9voshIM", // Simpli Finance GmbH
  "dI8ofFbKIogmLSUTvTFn", // simpli.immo
  "MAMK21fjL4Z52qgcvpgq", // simpli.bot
];

interface AnalyzeRequest {
  question: string;
  days: number; // 7, 14, or 30
  locationId?: string; // Optional: analyze specific location only
}

interface ChatEvidence {
  leadId: string;
  leadName: string;
  locationName: string;
  messageContent: string;
  messageType: "incoming" | "outgoing";
  messageDate: string;
}

interface AnalysisResult {
  answer: string;
  summary: string;
  keyFindings: string[];
  evidence: ChatEvidence[];
  totalChatsAnalyzed: number;
  totalMessagesAnalyzed: number;
  timeRange: string;
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Validate authorization
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    const body: AnalyzeRequest = await req.json();
    const { question, days, locationId } = body;

    if (!question || !days) {
      return jsonResponse({ error: "Missing question or days parameter" }, 400);
    }

    console.log(`=== CHAT ANALYSIS ===`);
    console.log(`Question: ${question}`);
    console.log(`Days: ${days}`);
    console.log(`Location: ${locationId || 'all Makler'}`);

    // Calculate date range
    const endDate = new Date();
    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    // 1. Get active Makler connections (exclude own accounts)
    let connectionsQuery = supabase
      .from("ghl_connections")
      .select("location_id, location_name")
      .eq("is_active", true);

    const { data: connections, error: connError } = await connectionsQuery;

    if (connError) {
      console.error("Error fetching connections:", connError);
      return jsonResponse({ error: "Failed to fetch connections" }, 500);
    }

    // Filter out own accounts
    let maklerConnections = connections?.filter(
      (c) => !OWN_ACCOUNT_LOCATION_IDS.includes(c.location_id)
    ) || [];

    // If specific location requested, filter to that
    if (locationId) {
      maklerConnections = maklerConnections.filter(c => c.location_id === locationId);
    }

    if (maklerConnections.length === 0) {
      return jsonResponse({ error: "No Makler connections found" }, 404);
    }

    const locationIds = maklerConnections.map(c => c.location_id);
    const locationNameMap = new Map(maklerConnections.map(c => [c.location_id, c.location_name]));

    console.log(`Analyzing ${maklerConnections.length} Makler accounts`);

    // 2. Get leads for these locations
    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("id, name, email, phone, ghl_location_id")
      .in("ghl_location_id", locationIds);

    if (leadsError) {
      console.error("Error fetching leads:", leadsError);
      return jsonResponse({ error: "Failed to fetch leads" }, 500);
    }

    if (!leads || leads.length === 0) {
      return jsonResponse({
        answer: "Keine Leads gefunden für den ausgewählten Zeitraum.",
        summary: "Es wurden keine Makler-Leads gefunden.",
        keyFindings: [],
        evidence: [],
        totalChatsAnalyzed: 0,
        totalMessagesAnalyzed: 0,
        timeRange: `${startDate.toLocaleDateString('de-DE')} - ${endDate.toLocaleDateString('de-DE')}`
      });
    }

    const leadIds = leads.map(l => l.id);
    const leadMap = new Map(leads.map(l => [l.id, l]));

    console.log(`Found ${leads.length} leads`);

    // 3. Get messages from the time period
    const { data: messages, error: msgError } = await supabase
      .from("messages")
      .select("id, lead_id, content, type, created_at")
      .in("lead_id", leadIds)
      .gte("created_at", startDate.toISOString())
      .lte("created_at", endDate.toISOString())
      .order("created_at", { ascending: true });

    if (msgError) {
      console.error("Error fetching messages:", msgError);
      return jsonResponse({ error: "Failed to fetch messages" }, 500);
    }

    if (!messages || messages.length === 0) {
      return jsonResponse({
        answer: "Keine Nachrichten im ausgewählten Zeitraum gefunden.",
        summary: "Es wurden keine Nachrichten in den letzten " + days + " Tagen gefunden.",
        keyFindings: [],
        evidence: [],
        totalChatsAnalyzed: leads.length,
        totalMessagesAnalyzed: 0,
        timeRange: `${startDate.toLocaleDateString('de-DE')} - ${endDate.toLocaleDateString('de-DE')}`
      });
    }

    console.log(`Found ${messages.length} messages`);

    // 4. Group messages by lead for context
    const chatsByLead = new Map<string, any[]>();
    for (const msg of messages) {
      if (!chatsByLead.has(msg.lead_id)) {
        chatsByLead.set(msg.lead_id, []);
      }
      chatsByLead.get(msg.lead_id)!.push(msg);
    }

    // 5. Prepare chat summaries for AI analysis (limit to avoid token limits)
    const chatSummaries: string[] = [];
    const maxChats = 50; // Limit number of chats to analyze
    const maxMessagesPerChat = 20;

    let analyzedChats = 0;
    for (const [leadId, msgs] of chatsByLead) {
      if (analyzedChats >= maxChats) break;

      const lead = leadMap.get(leadId);
      if (!lead) continue;

      const locationName = locationNameMap.get(lead.ghl_location_id) || "Unbekannt";
      const leadName = lead.name || lead.email || lead.phone || "Unbekannt";

      const recentMsgs = msgs.slice(-maxMessagesPerChat);
      const chatText = recentMsgs.map(m => {
        const sender = m.type === 'incoming' ? 'Kunde' : 'Makler';
        const date = new Date(m.created_at).toLocaleDateString('de-DE');
        return `[${date}] ${sender}: ${m.content || '(kein Inhalt)'}`;
      }).join('\n');

      chatSummaries.push(`--- Chat mit ${leadName} (Makler: ${locationName}) ---\n${chatText}\n`);
      analyzedChats++;
    }

    // 6. Call OpenAI for analysis
    const systemPrompt = `Du bist ein Experte für die Analyse von Immobilienmakler-Kundenchats.
Du analysierst Chatverläufe zwischen Maklern und deren Interessenten/Kunden.

Deine Aufgabe:
1. Analysiere die bereitgestellten Chatverläufe
2. Beantworte die Frage des Nutzers basierend auf den Chats
3. Gib konkrete Beispiele/Zitate als Beweis
4. Fasse die wichtigsten Erkenntnisse zusammen

Antworte immer auf Deutsch und strukturiert.`;

    const userPrompt = `Analysiere die folgenden ${chatSummaries.length} Chatverläufe der letzten ${days} Tage.

FRAGE: ${question}

CHATVERLÄUFE:
${chatSummaries.join('\n\n')}

Bitte antworte im folgenden JSON-Format:
{
  "answer": "Deine ausführliche Antwort auf die Frage",
  "summary": "Kurze Zusammenfassung in 1-2 Sätzen",
  "keyFindings": ["Erkenntnis 1", "Erkenntnis 2", "Erkenntnis 3"],
  "relevantQuotes": [
    {"leadName": "Name", "locationName": "Makler", "quote": "Zitat aus dem Chat", "context": "Kontext/Erklärung"}
  ]
}`;

    console.log("Calling OpenAI for analysis...");

    const openaiResponse = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt }
        ],
        temperature: 0.3,
        max_tokens: 2000,
      }),
    });

    if (!openaiResponse.ok) {
      const errorText = await openaiResponse.text();
      console.error("OpenAI error:", errorText);
      return jsonResponse({ error: "AI analysis failed" }, 500);
    }

    const openaiData = await openaiResponse.json();
    const aiResponseText = openaiData.choices?.[0]?.message?.content || "";

    console.log("AI Response received");

    // 7. Parse AI response
    let parsedResponse: any;
    try {
      // Extract JSON from response (might be wrapped in markdown)
      const jsonMatch = aiResponseText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        parsedResponse = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("Failed to parse AI response:", parseError);
      // Return raw response if parsing fails
      parsedResponse = {
        answer: aiResponseText,
        summary: "Analyse abgeschlossen",
        keyFindings: [],
        relevantQuotes: []
      };
    }

    // 8. Build evidence from quotes
    const evidence: ChatEvidence[] = (parsedResponse.relevantQuotes || []).map((q: any) => ({
      leadId: "",
      leadName: q.leadName || "Unbekannt",
      locationName: q.locationName || "Unbekannt",
      messageContent: q.quote || "",
      messageType: "incoming" as const,
      messageDate: q.context || "",
    }));

    const result: AnalysisResult = {
      answer: parsedResponse.answer || "Keine Antwort generiert",
      summary: parsedResponse.summary || "",
      keyFindings: parsedResponse.keyFindings || [],
      evidence,
      totalChatsAnalyzed: chatsByLead.size,
      totalMessagesAnalyzed: messages.length,
      timeRange: `${startDate.toLocaleDateString('de-DE')} - ${endDate.toLocaleDateString('de-DE')}`,
    };

    console.log("Analysis complete");
    return jsonResponse(result);

  } catch (err: any) {
    console.error("Analysis error:", err);
    return jsonResponse({ error: err.message || "Internal error" }, 500);
  }
});

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json",
    },
  });
}
