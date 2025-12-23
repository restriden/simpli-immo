import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface LeadQuestion {
  question: string;
  count: number;
  leadIds: string[];
}

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    // Get Gemini API key from request body FIRST (before any other operations)
    let geminiApiKey: string | undefined;
    try {
      const body = await req.json();
      geminiApiKey = body.gemini_api_key;
    } catch {
      // No body or invalid JSON - try env var
    }
    geminiApiKey = geminiApiKey || Deno.env.get("GEMINI_API_KEY");

    if (!geminiApiKey) {
      return jsonResponse({ questions: [], error: "Gemini API Key nicht konfiguriert" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Get all active connections' location_ids
    const { data: connections } = await supabase
      .from("ghl_connections")
      .select("location_id")
      .eq("is_active", true);

    if (!connections || connections.length === 0) {
      return jsonResponse({ questions: [], message: "No active connections" });
    }

    const locationIds = connections.map(c => c.location_id);

    // Get leads for active connections
    const { data: leads, error: leadsError } = await supabase
      .from("leads")
      .select("id, name, ghl_location_id")
      .in("ghl_location_id", locationIds);

    if (leadsError || !leads || leads.length === 0) {
      return jsonResponse({ questions: [], message: "No leads found" });
    }

    const leadIds = leads.map(l => l.id);

    // Get incoming messages (questions from leads)
    const { data: messages, error: msgError } = await supabase
      .from("messages")
      .select("id, lead_id, content, type")
      .in("lead_id", leadIds)
      .eq("type", "incoming")
      .not("content", "is", null)
      .order("created_at", { ascending: false })
      .limit(500); // Limit to last 500 incoming messages

    if (msgError || !messages || messages.length === 0) {
      return jsonResponse({ questions: [], message: "No messages found" });
    }

    // Filter messages that look like questions (contain ? or are short inquiries)
    const potentialQuestions = messages.filter(m => {
      const content = m.content?.trim() || "";
      return content.includes("?") ||
             content.toLowerCase().includes("wie") ||
             content.toLowerCase().includes("was") ||
             content.toLowerCase().includes("wann") ||
             content.toLowerCase().includes("wo") ||
             content.toLowerCase().includes("können") ||
             content.toLowerCase().includes("gibt es") ||
             content.toLowerCase().includes("haben sie") ||
             content.toLowerCase().includes("ist das");
    });

    if (potentialQuestions.length === 0) {
      return jsonResponse({ questions: [], message: "No questions found in messages" });
    }

    // Create a map of lead_id to index for compact output
    const uniqueLeadIds = [...new Set(potentialQuestions.map(m => m.lead_id))];
    const leadIdToIndex: Record<string, number> = {};
    uniqueLeadIds.forEach((id, idx) => { leadIdToIndex[id] = idx; });

    // Use Gemini to extract and group questions with lead indices
    const questionsText = potentialQuestions
      .map(m => `[${leadIdToIndex[m.lead_id]}]: ${m.content}`)
      .join("\n");

    const prompt = `Analysiere die folgenden Nachrichten von Immobilien-Interessenten und extrahiere die häufigsten Fragen.

Gruppiere ähnliche Fragen zusammen und gib eine kurze, prägnante Zusammenfassung jeder Fragegruppe.

Nachrichten (Zahl in Klammern = Lead-Index):
${questionsText}

Antworte NUR mit einem JSON-Array im folgenden Format (keine anderen Texte, kein Markdown):
[
  {"question": "Kurze Zusammenfassung der Frage", "idx": [0, 2, 5]},
  ...
]

idx = Array der Lead-Indizes die diese Frage gestellt haben. Maximal 10 Fragen. Sortiere nach Anzahl idx absteigend.`;

    const response = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${geminiApiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 2000
          }
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      console.error("Gemini API error:", error);
      return jsonResponse({ questions: [], error: "AI analysis failed" }, 500);
    }

    const aiResult = await response.json();
    const aiText = aiResult.candidates?.[0]?.content?.parts?.[0]?.text || "";

    // Parse the JSON response
    let questions: LeadQuestion[] = [];

    if (!aiText) {
      console.error("Empty AI response:", JSON.stringify(aiResult));
      return jsonResponse({ questions: [], error: "Empty AI response", debug: aiResult });
    }

    try {
      // Clean up response - remove markdown code blocks
      let cleanedText = aiText
        .replace(/```json\s*/gi, '')
        .replace(/```\s*/g, '')
        .trim();

      console.log("Cleaned text length:", cleanedText.length);
      console.log("Cleaned text start:", cleanedText.substring(0, 100));

      // Extract JSON from response - find first [ and last ]
      const startIdx = cleanedText.indexOf('[');
      const endIdx = cleanedText.lastIndexOf(']');

      if (startIdx === -1 || endIdx === -1 || endIdx <= startIdx) {
        console.error("No JSON array found in response:", cleanedText.substring(0, 500));
        return jsonResponse({ questions: [], error: "No JSON in response", cleanedText: cleanedText.substring(0, 300) });
      }

      const jsonString = cleanedText.substring(startIdx, endIdx + 1);
      console.log("JSON string length:", jsonString.length);
      console.log("JSON string end:", jsonString.substring(jsonString.length - 50));

      questions = JSON.parse(jsonString);
      console.log("Successfully parsed", questions.length, "questions");
    } catch (parseError: any) {
      console.error("Failed to parse AI response:", parseError.message);
      console.error("Full AI text:", aiText);
      return jsonResponse({
        questions: [],
        error: "Failed to parse questions: " + parseError.message,
        aiTextLength: aiText.length,
        aiTextStart: aiText.substring(0, 200),
        aiTextEnd: aiText.substring(aiText.length - 200)
      });
    }

    // Validate and clean the questions - convert indices back to lead IDs
    questions = questions
      .filter(q => q.question && (Array.isArray(q.idx) || typeof q.count === "number"))
      .map(q => {
        // Convert indices to actual lead IDs
        const indices = Array.isArray(q.idx) ? q.idx : [];
        const resolvedLeadIds = indices
          .filter((i: number) => i >= 0 && i < uniqueLeadIds.length)
          .map((i: number) => uniqueLeadIds[i]);

        return {
          question: q.question.substring(0, 200), // Limit length
          count: resolvedLeadIds.length || q.count || 1,
          leadIds: resolvedLeadIds.slice(0, 20) // Limit to 20 leads per question
        };
      })
      .filter(q => q.count > 0)
      .sort((a, b) => b.count - a.count)
      .slice(0, 15);

    return jsonResponse({
      questions,
      totalMessages: messages.length,
      questionsAnalyzed: potentialQuestions.length
    });

  } catch (err) {
    console.error("Error extracting questions:", err);
    return jsonResponse({ error: err.message, questions: [] }, 500);
  }
});

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
