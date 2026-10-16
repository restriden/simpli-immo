import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type"
};
serve(async (req)=>{
  if (req.method === "OPTIONS") {
    return new Response("ok", {
      headers: corsHeaders
    });
  }
  try {
    const { prompt_id, scenario, message_count = 5 } = await req.json();
    if (!prompt_id || !scenario) {
      return jsonResponse({
        error: "prompt_id and scenario required"
      }, 400);
    }
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    // Prompt laden
    const { data: prompt, error: promptError } = await supabase.from("prompts").select("*").eq("id", prompt_id).single();
    if (promptError || !prompt) {
      return jsonResponse({
        error: "Prompt not found"
      }, 404);
    }
    // Vollständigen Prompt zusammenbauen
    const fullPrompt = `PERSÖNLICHKEIT:
${prompt.personality || "(nicht definiert)"}

ZIEL:
${prompt.goal || "(nicht definiert)"}

ZUSÄTZLICHE INFORMATIONEN:
${prompt.additional_info || "(nicht definiert)"}`;
    // Simulation durchführen
    const simulationPrompt = `Du wirst jetzt eine Konversation zwischen einem Immobilien-Lead und einer KI simulieren.

Der KI wurde folgender Prompt gegeben:
---
${fullPrompt}
---

SZENARIO für den Lead:
${scenario}

ANREDE: ${prompt.form_type === 'du' ? 'Du-Form' : 'Sie-Form'}

Simuliere eine realistische Konversation mit ${message_count} Nachrichten-Wechseln (Lead fragt, KI antwortet).

Der Lead soll:
- Realistische Fragen stellen
- Manchmal Einwände haben
- Nach Terminen/Besichtigungen fragen
- Evtl. nach Finanzierung fragen

Die KI soll:
- Entsprechend dem Prompt antworten
- Die ${prompt.form_type === 'du' ? 'Du-Form' : 'Sie-Form'} verwenden

Nach der Simulation:
1. Bewerte die Qualität der KI-Antworten (1-10)
2. Gib konkretes Feedback
3. Mache 1-3 Verbesserungsvorschläge für den Prompt

Antworte NUR mit einem JSON-Objekt (keine Markdown):
{
  "conversation": [
    {"role": "lead", "content": "Nachricht vom Lead"},
    {"role": "ai", "content": "Antwort der KI"},
    ...
  ],
  "feedback": "Detailliertes Feedback zur Konversation",
  "qualityScore": 7,
  "suggestions": [
    {
      "id": "sim-suggestion-1",
      "section": "personality|goal|additional_info",
      "originalText": "",
      "suggestedText": "Vorgeschlagene Ergänzung/Änderung",
      "reason": "Begründung basierend auf der Simulation",
      "position": {"start": 0, "end": 0},
      "isGlobal": false
    }
  ]
}`;
    const response = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: "claude-sonnet-5",
        max_tokens: 4000,
        messages: [
          {
            role: "user",
            content: simulationPrompt
          }
        ]
      })
    });
    if (!response.ok) {
      const error = await response.text();
      console.error("Anthropic API error:", error);
      return jsonResponse({
        error: "Simulation failed"
      }, 500);
    }
    const aiResult = await response.json();
    const aiText = aiResult.content?.[0]?.text || "{}";
    // Parse response
    let simulationResult;
    try {
      const jsonMatch = aiText.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        simulationResult = JSON.parse(jsonMatch[0]);
      } else {
        throw new Error("No JSON found in response");
      }
    } catch (parseError) {
      console.error("Failed to parse simulation response:", parseError, aiText);
      return jsonResponse({
        error: "Failed to parse simulation response",
        rawResponse: aiText
      }, 500);
    }
    // Formatiere Konversation
    const conversation = (simulationResult.conversation || []).filter((m)=>m.role && m.content).map((m)=>({
        role: m.role,
        content: m.content
      }));
    // Formatiere Suggestions
    const suggestions = (simulationResult.suggestions || []).filter((s)=>s.section && s.suggestedText && s.reason).map((s, idx)=>({
        id: s.id || `sim-suggestion-${idx + 1}`,
        section: s.section,
        originalText: s.originalText || "",
        suggestedText: s.suggestedText,
        reason: s.reason,
        position: s.position || {
          start: 0,
          end: 0
        },
        isGlobal: s.isGlobal || false,
        globalReason: s.globalReason || undefined
      }));
    return jsonResponse({
      conversation,
      feedback: simulationResult.feedback || "Kein Feedback verfügbar",
      qualityScore: Math.min(10, Math.max(1, simulationResult.qualityScore || 5)),
      suggestions
    });
  } catch (err) {
    console.error("Error simulating prompt:", err);
    return jsonResponse({
      error: err.message
    }, 500);
  }
});
function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      ...corsHeaders,
      "Content-Type": "application/json"
    }
  });
}
