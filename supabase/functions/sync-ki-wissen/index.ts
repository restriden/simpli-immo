import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const GHL_API_BASE = "https://services.leadconnectorhq.com";

// Custom field key for ki_objektwissen in GHL
const KI_WISSEN_FIELD_KEY = "ki_objektwissen";

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { lead_id, objekt_id, user_id } = await req.json();

    if (!user_id) {
      return jsonResponse({ error: "user_id required" }, 400);
    }

    if (!lead_id && !objekt_id) {
      return jsonResponse({ error: "lead_id or objekt_id required" }, 400);
    }

    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // 1. Get leads to sync (either single lead or all leads for objekt)
    let leadsToSync: any[] = [];

    if (lead_id) {
      // Single lead
      const { data: lead } = await supabase
        .from('leads')
        .select('id, ghl_contact_id, objekt_id, user_id')
        .eq('id', lead_id)
        .single();

      if (lead?.ghl_contact_id && lead?.objekt_id) {
        leadsToSync = [lead];
      }
    } else if (objekt_id) {
      // All leads for this objekt
      const { data: leads } = await supabase
        .from('leads')
        .select('id, ghl_contact_id, objekt_id, user_id')
        .eq('objekt_id', objekt_id)
        .not('ghl_contact_id', 'is', null);

      leadsToSync = leads || [];
    }

    if (leadsToSync.length === 0) {
      return jsonResponse({ success: true, message: "No leads to sync", synced: 0 });
    }

    // 2. Get the objekt_id (from first lead if not provided)
    const targetObjektId = objekt_id || leadsToSync[0].objekt_id;

    if (!targetObjektId) {
      return jsonResponse({ success: true, message: "No objekt assigned", synced: 0 });
    }

    // 3. Fetch all ki_wissen for this objekt
    const { data: wissen } = await supabase
      .from('ki_wissen')
      .select('kategorie, frage, antwort')
      .eq('objekt_id', targetObjektId)
      .order('kategorie');

    // 4. Format ki_wissen as readable text
    const formattedWissen = formatKiWissen(wissen || []);

    console.log("=== SYNC KI-WISSEN TO GHL ===");
    console.log("Objekt ID:", targetObjektId);
    console.log("Leads to sync:", leadsToSync.length);
    console.log("Knowledge entries:", wissen?.length || 0);

    // 5. Get GHL connection
    const { data: connection } = await supabase
      .from('ghl_connections')
      .select('access_token, location_id')
      .eq('user_id', user_id)
      .eq('is_active', true)
      .single();

    if (!connection) {
      return jsonResponse({ error: "No active GHL connection" }, 400);
    }

    // 6. Update each lead's GHL contact
    let syncedCount = 0;
    const errors: string[] = [];

    for (const lead of leadsToSync) {
      try {
        const updateResult = await updateGHLContact(
          connection.access_token,
          lead.ghl_contact_id,
          formattedWissen
        );

        if (updateResult.success) {
          syncedCount++;
        } else {
          errors.push(`Lead ${lead.id}: ${updateResult.error}`);
        }
      } catch (err: any) {
        errors.push(`Lead ${lead.id}: ${err.message}`);
      }
    }

    console.log("Synced:", syncedCount, "Errors:", errors.length);

    return jsonResponse({
      success: true,
      synced: syncedCount,
      total: leadsToSync.length,
      errors: errors.length > 0 ? errors : undefined,
      wissen_count: wissen?.length || 0,
    });

  } catch (error: any) {
    console.error('Sync error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});

function formatKiWissen(wissen: any[]): string {
  if (wissen.length === 0) {
    return "";
  }

  // Group by category
  const grouped: Record<string, any[]> = {};
  for (const w of wissen) {
    const cat = w.kategorie || 'Sonstiges';
    if (!grouped[cat]) grouped[cat] = [];
    grouped[cat].push(w);
  }

  // Format as concise summary (not full Q&A)
  const lines: string[] = [];

  for (const [category, items] of Object.entries(grouped)) {
    lines.push(`【${category.toUpperCase()}】`);
    for (const item of items) {
      // Create concise summary from question and answer
      const summary = createConciseSummary(item.frage, item.antwort);
      lines.push(`• ${summary}`);
    }
    lines.push('');
  }

  return lines.join('\n').trim();
}

/**
 * Creates a concise summary from Q&A
 * e.g., "Wie viele Zimmer?" + "Das Objekt hat 3 Zimmer" → "Zimmeranzahl: 3"
 */
function createConciseSummary(frage: string, antwort: string): string {
  const frageLower = frage.toLowerCase();
  const antwortLower = antwort.toLowerCase();

  // Extract topic from question and key info from answer

  // Zimmer/Räume
  if (frageLower.includes('zimmer') || frageLower.includes('räume')) {
    const match = antwort.match(/(\d+)\s*(zimmer|räume)/i) || antwort.match(/(\d+)/);
    if (match) return `Zimmer: ${match[1]}`;
  }

  // Fläche/Quadratmeter
  if (frageLower.includes('fläche') || frageLower.includes('quadratmeter') || frageLower.includes('m²') || frageLower.includes('qm')) {
    const match = antwort.match(/(\d+[\.,]?\d*)\s*(m²|qm|quadratmeter)/i) || antwort.match(/(\d+[\.,]?\d*)/);
    if (match) return `Fläche: ${match[1]} m²`;
  }

  // Preis/Kosten
  if (frageLower.includes('preis') || frageLower.includes('kosten') || frageLower.includes('miete') || frageLower.includes('kaufpreis')) {
    const match = antwort.match(/([\d\.,]+)\s*(€|euro|eur)/i) || antwort.match(/(\d[\d\.,]*)/);
    if (match) {
      const label = frageLower.includes('nebenkosten') ? 'Nebenkosten' :
                    frageLower.includes('miete') ? 'Miete' :
                    frageLower.includes('kaufpreis') ? 'Kaufpreis' : 'Preis';
      return `${label}: ${match[1]} €`;
    }
  }

  // Aufzug/Fahrstuhl
  if (frageLower.includes('aufzug') || frageLower.includes('fahrstuhl') || frageLower.includes('lift')) {
    const hasIt = antwortLower.includes('ja') || antwortLower.includes('vorhanden') ||
                  antwortLower.includes('gibt es') || !antwortLower.includes('kein') && !antwortLower.includes('nein');
    return `Aufzug: ${hasIt ? 'Ja' : 'Nein'}`;
  }

  // Balkon/Terrasse
  if (frageLower.includes('balkon') || frageLower.includes('terrasse')) {
    const hasIt = antwortLower.includes('ja') || antwortLower.includes('vorhanden') ||
                  !antwortLower.includes('kein') && !antwortLower.includes('nein');
    const sizeMatch = antwort.match(/(\d+[\.,]?\d*)\s*(m²|qm)/i);
    if (sizeMatch) return `Balkon: Ja, ${sizeMatch[1]} m²`;
    return `Balkon: ${hasIt ? 'Ja' : 'Nein'}`;
  }

  // Keller
  if (frageLower.includes('keller')) {
    const hasIt = antwortLower.includes('ja') || antwortLower.includes('vorhanden') ||
                  !antwortLower.includes('kein') && !antwortLower.includes('nein');
    return `Keller: ${hasIt ? 'Ja' : 'Nein'}`;
  }

  // Garage/Stellplatz/Parkplatz
  if (frageLower.includes('garage') || frageLower.includes('stellplatz') || frageLower.includes('parkplatz')) {
    const hasIt = antwortLower.includes('ja') || antwortLower.includes('vorhanden') ||
                  !antwortLower.includes('kein') && !antwortLower.includes('nein');
    return `Stellplatz: ${hasIt ? 'Ja' : 'Nein'}`;
  }

  // Etage/Stockwerk
  if (frageLower.includes('etage') || frageLower.includes('stock')) {
    const match = antwort.match(/(\d+)/);
    if (match) return `Etage: ${match[1]}`;
  }

  // Baujahr
  if (frageLower.includes('baujahr') || frageLower.includes('gebaut')) {
    const match = antwort.match(/(19\d{2}|20\d{2})/);
    if (match) return `Baujahr: ${match[1]}`;
  }

  // Heizung
  if (frageLower.includes('heizung')) {
    // Try to extract heating type
    if (antwortLower.includes('gas')) return 'Heizung: Gas';
    if (antwortLower.includes('öl')) return 'Heizung: Öl';
    if (antwortLower.includes('fernwärme')) return 'Heizung: Fernwärme';
    if (antwortLower.includes('wärmepumpe')) return 'Heizung: Wärmepumpe';
    if (antwortLower.includes('fußboden')) return 'Heizung: Fußbodenheizung';
  }

  // Verfügbar/Bezugsfrei
  if (frageLower.includes('verfügbar') || frageLower.includes('bezug') || frageLower.includes('einzug')) {
    if (antwortLower.includes('sofort')) return 'Verfügbar: Sofort';
    const dateMatch = antwort.match(/(\d{1,2}[\./]\d{1,2}[\./]\d{2,4}|\d{1,2}\.\s*\w+\s*\d{4})/);
    if (dateMatch) return `Verfügbar: ${dateMatch[1]}`;
  }

  // Default: Extract first sentence or shorten answer
  let shortAnswer = antwort.trim();

  // Remove common filler phrases
  shortAnswer = shortAnswer
    .replace(/^(ja,?\s*|nein,?\s*)/i, '')
    .replace(/^(das objekt|die wohnung|das haus)\s+(hat|besitzt|verfügt über)\s*/i, '')
    .replace(/\s+/g, ' ')
    .trim();

  // Take first sentence or max 50 chars
  const firstSentence = shortAnswer.split(/[.!?]/)[0];
  if (firstSentence.length <= 60) {
    return firstSentence;
  }
  return shortAnswer.substring(0, 57) + '...';
}

async function updateGHLContact(
  accessToken: string,
  contactId: string,
  wissenText: string
): Promise<{ success: boolean; error?: string }> {
  try {
    const response = await fetch(`${GHL_API_BASE}/contacts/${contactId}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
        'Version': '2021-07-28',
      },
      body: JSON.stringify({
        customFields: [
          {
            key: KI_WISSEN_FIELD_KEY,
            value: wissenText,
          }
        ],
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('GHL update failed:', response.status, errorText);
      return { success: false, error: `GHL ${response.status}: ${errorText}` };
    }

    return { success: true };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
