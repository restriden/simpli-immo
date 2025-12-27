import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import Anthropic from "https://esm.sh/@anthropic-ai/sdk@0.24.3";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY") || "";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Felder die extrahiert werden können
const EXTRAHIERBARE_FELDER = {
  stammdaten: [
    { key: "strasse", label: "Straße", type: "text" },
    { key: "hausnummer", label: "Hausnummer", type: "text" },
    { key: "plz", label: "PLZ", type: "text" },
    { key: "city", label: "Ort", type: "text" },
    { key: "grundstueck_qm", label: "Grundstücksgröße (m²)", type: "number" },
    { key: "area_sqm", label: "Wohnfläche (m²)", type: "number" },
    { key: "nutzflaeche_qm", label: "Nutzfläche (m²)", type: "number" },
    { key: "baujahr", label: "Baujahr", type: "number" },
    { key: "objektart", label: "Objektart", type: "enum", values: ["efh", "dhh", "rh", "mfh", "etw", "grundstueck", "gewerbe", "sonstiges"] },
    { key: "rooms", label: "Zimmeranzahl", type: "number" },
    { key: "etage", label: "Etage", type: "number" },
    { key: "stockwerke_gesamt", label: "Stockwerke gesamt", type: "number" },
  ],
  technisch: [
    { key: "energieausweis_typ", label: "Energieausweis-Typ", type: "enum", values: ["bedarfsausweis", "verbrauchsausweis", "nicht_vorhanden"] },
    { key: "energiekennwert", label: "Energiekennwert (kWh/m²a)", type: "number" },
    { key: "energieeffizienzklasse", label: "Energieeffizienzklasse", type: "enum", values: ["A+", "A", "B", "C", "D", "E", "F", "G", "H"] },
    { key: "heizungsart", label: "Heizungsart", type: "enum", values: ["gas", "oel", "waermepumpe", "fernwaerme", "pellets", "elektro", "solar", "sonstiges"] },
    { key: "heizung_baujahr", label: "Baujahr Heizung", type: "number" },
    { key: "fenster_material", label: "Fenster Material", type: "enum", values: ["kunststoff", "holz", "alu", "holz_alu", "sonstiges"] },
    { key: "fenster_baujahr", label: "Baujahr Fenster", type: "number" },
    { key: "dach_material", label: "Dach Material", type: "enum", values: ["ziegel", "beton", "schiefer", "metall", "flachdach", "sonstiges"] },
    { key: "dach_baujahr", label: "Baujahr Dach", type: "number" },
    { key: "keller", label: "Keller vorhanden", type: "boolean" },
    { key: "keller_beheizt", label: "Keller beheizt", type: "boolean" },
    { key: "garage_stellplatz", label: "Garage/Stellplatz", type: "enum", values: ["keine", "garage", "carport", "stellplatz", "tiefgarage", "duplex"] },
  ],
  rechtlich: [
    { key: "grundbuch_belastungen", label: "Grundbuch-Belastungen", type: "text" },
    { key: "baulasten", label: "Baulasten", type: "text" },
    { key: "denkmalschutz", label: "Denkmalschutz", type: "boolean" },
    { key: "erbbaurecht", label: "Erbbaurecht", type: "boolean" },
  ],
  etw: [
    { key: "hausgeld_monatlich", label: "Hausgeld monatlich (€)", type: "number" },
    { key: "instandhaltungsruecklage", label: "Instandhaltungsrücklage (€)", type: "number" },
    { key: "sonderumlagen_geplant", label: "Sonderumlagen geplant", type: "boolean" },
    { key: "einheiten_im_haus", label: "Anzahl Einheiten im Haus", type: "number" },
  ],
  finanzierung: [
    { key: "price", label: "Kaufpreis (€)", type: "number" },
    { key: "provision_prozent", label: "Provision (%)", type: "number" },
    { key: "grunderwerbsteuer_prozent", label: "Grunderwerbsteuer (%)", type: "number" },
  ],
};

serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

    const formData = await req.formData();
    const file = formData.get("file") as File;
    const objektId = formData.get("objekt_id") as string;
    const userId = formData.get("user_id") as string;
    const dokumentTyp = formData.get("dokument_typ") as string; // energieausweis, expose, grundbuch, etc.

    if (!file || !objektId || !userId) {
      return jsonResponse({ error: "file, objekt_id and user_id are required" }, 400);
    }

    console.log("=== ANALYZE DOKUMENT ===");
    console.log("File:", file.name, file.type, file.size);
    console.log("Objekt ID:", objektId);
    console.log("Dokument Typ:", dokumentTyp);

    // 1. Datei in Base64 konvertieren
    const arrayBuffer = await file.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    // 2. Dokumenttyp-spezifische Prompts
    const dokumentPrompts: Record<string, string> = {
      energieausweis: `Dies ist ein Energieausweis. Extrahiere folgende Daten wenn vorhanden:
- Energieausweis-Typ (Bedarfsausweis oder Verbrauchsausweis)
- Energiekennwert in kWh/m²a
- Energieeffizienzklasse (A+ bis H)
- Heizungsart
- Baujahr der Heizung
- Adresse (Straße, Hausnummer, PLZ, Ort)
- Baujahr des Gebäudes
- Wohnfläche`,

      expose: `Dies ist ein Immobilien-Exposé. Extrahiere alle verfügbaren Daten:
- Objektart (EFH, DHH, ETW, MFH, etc.)
- Adresse (Straße, Hausnummer, PLZ, Ort)
- Zimmeranzahl
- Wohnfläche und Grundstücksgröße
- Baujahr
- Kaufpreis
- Provision
- Energiedaten
- Ausstattungsmerkmale (Heizung, Fenster, Dach, Keller, Garage)
- Bei Wohnungen: Hausgeld, Etage, Einheiten im Haus`,

      grundbuch: `Dies ist ein Grundbuchauszug. Extrahiere:
- Grundbuch-Belastungen (Grundschulden, Hypotheken)
- Baulasten wenn erkennbar
- Erbbaurecht ja/nein
- Grundstücksgröße`,

      teilungserklaerung: `Dies ist eine Teilungserklärung. Extrahiere:
- Anzahl der Einheiten im Haus
- Miteigentumsanteil
- Sondernutzungsrechte
- Hausgeld wenn angegeben`,

      auto: `Analysiere dieses Dokument und extrahiere ALLE erkennbaren Immobiliendaten.
Fokus auf: Objektdaten, Energiedaten, Technische Daten, Finanzdaten.`,
    };

    const systemPrompt = `Du bist ein Experte für Immobiliendokumente. Deine Aufgabe ist es, strukturierte Daten aus Dokumenten zu extrahieren.

WICHTIG:
- Extrahiere NUR Daten die du SICHER im Dokument findest
- Gib bei Unsicherheit null zurück
- Zahlen ohne Einheiten, nur der numerische Wert
- Boolean als true/false
- Enum-Werte exakt wie vorgegeben (kleingeschrieben, mit Unterstrich)

Mögliche Objektarten: efh, dhh, rh, mfh, etw, grundstueck, gewerbe, sonstiges
Mögliche Heizungsarten: gas, oel, waermepumpe, fernwaerme, pellets, elektro, solar, sonstiges
Mögliche Energieklassen: A+, A, B, C, D, E, F, G, H

Antworte NUR mit einem validen JSON-Objekt, kein zusätzlicher Text.`;

    const userPrompt = dokumentPrompts[dokumentTyp || "auto"] + `

Antworte mit einem JSON-Objekt in diesem Format:
{
  "extrahierte_daten": {
    "strasse": "string oder null",
    "hausnummer": "string oder null",
    "plz": "string oder null",
    "city": "string oder null",
    "grundstueck_qm": number oder null,
    "area_sqm": number oder null,
    "baujahr": number oder null,
    "objektart": "enum oder null",
    "rooms": number oder null,
    "energieausweis_typ": "enum oder null",
    "energiekennwert": number oder null,
    "energieeffizienzklasse": "enum oder null",
    "heizungsart": "enum oder null",
    "heizung_baujahr": number oder null,
    "keller": boolean oder null,
    "garage_stellplatz": "enum oder null",
    "price": number oder null,
    "hausgeld_monatlich": number oder null,
    "einheiten_im_haus": number oder null
    // ... weitere Felder wenn gefunden
  },
  "ki_wissen": [
    {"kategorie": "string", "frage": "string", "antwort": "string"}
  ],
  "zusammenfassung": "Kurze Beschreibung was gefunden wurde",
  "konfidenz": 0.0 bis 1.0
}

Die ki_wissen Array sollte wichtige Fakten enthalten die als Wissenseinträge gespeichert werden können.`;

    // 3. Claude Vision API aufrufen
    let mediaType = "image/jpeg";
    if (file.type.includes("png")) mediaType = "image/png";
    if (file.type.includes("gif")) mediaType = "image/gif";
    if (file.type.includes("webp")) mediaType = "image/webp";
    if (file.type.includes("pdf")) mediaType = "application/pdf";

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 4096,
      messages: [
        {
          role: "user",
          content: [
            {
              type: "image",
              source: {
                type: "base64",
                media_type: mediaType as any,
                data: base64,
              },
            },
            {
              type: "text",
              text: userPrompt,
            },
          ],
        },
      ],
      system: systemPrompt,
    });

    const textContent = response.content.find((c) => c.type === "text");
    if (!textContent || textContent.type !== "text") {
      return jsonResponse({ error: "No response from AI" }, 500);
    }

    // 4. JSON parsen
    let analysisResult;
    try {
      // Entferne mögliche Markdown-Code-Blöcke
      let jsonText = textContent.text.trim();
      if (jsonText.startsWith("```json")) {
        jsonText = jsonText.slice(7);
      }
      if (jsonText.startsWith("```")) {
        jsonText = jsonText.slice(3);
      }
      if (jsonText.endsWith("```")) {
        jsonText = jsonText.slice(0, -3);
      }
      analysisResult = JSON.parse(jsonText.trim());
    } catch (parseError) {
      console.error("JSON parse error:", parseError);
      console.error("Raw text:", textContent.text);
      return jsonResponse({ error: "Failed to parse AI response", raw: textContent.text }, 500);
    }

    console.log("Analysis result:", JSON.stringify(analysisResult, null, 2));

    // 5. Optional: Objekt automatisch aktualisieren
    if (analysisResult.extrahierte_daten) {
      const updateData: Record<string, any> = {};
      for (const [key, value] of Object.entries(analysisResult.extrahierte_daten)) {
        if (value !== null && value !== undefined && value !== "") {
          updateData[key] = value;
        }
      }

      if (Object.keys(updateData).length > 0) {
        updateData.updated_at = new Date().toISOString();

        const { error: updateError } = await supabase
          .from("objekte")
          .update(updateData)
          .eq("id", objektId)
          .eq("user_id", userId);

        if (updateError) {
          console.error("Error updating objekt:", updateError);
        } else {
          console.log("Objekt updated with:", Object.keys(updateData));
        }
      }
    }

    // 6. Optional: KI-Wissen speichern
    if (analysisResult.ki_wissen && Array.isArray(analysisResult.ki_wissen)) {
      for (const wissen of analysisResult.ki_wissen) {
        if (wissen.kategorie && wissen.frage && wissen.antwort) {
          await supabase.from("ki_wissen").insert({
            user_id: userId,
            objekt_id: objektId,
            kategorie: wissen.kategorie,
            frage: wissen.frage,
            antwort: wissen.antwort,
            quelle: `dokument_${dokumentTyp || "auto"}`,
            is_auto_learned: true,
          });
        }
      }
      console.log(`Saved ${analysisResult.ki_wissen.length} ki_wissen entries`);
    }

    // 7. Dokument in objekte.dokumente speichern (falls Storage verwendet wird)
    // TODO: Supabase Storage integration für Datei-Upload

    return jsonResponse({
      success: true,
      extrahierte_daten: analysisResult.extrahierte_daten,
      ki_wissen_count: analysisResult.ki_wissen?.length || 0,
      zusammenfassung: analysisResult.zusammenfassung,
      konfidenz: analysisResult.konfidenz,
      felder_aktualisiert: Object.keys(analysisResult.extrahierte_daten || {}).filter(
        (k) => analysisResult.extrahierte_daten[k] !== null
      ),
    });
  } catch (error: any) {
    console.error("Analyze dokument error:", error);
    return jsonResponse({ error: error.message }, 500);
  }
});

function jsonResponse(data: any, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
