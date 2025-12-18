import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

// Possible field names for objekt in GHL contact
const OBJEKT_FIELD_NAMES = [
  'objekttitel',
  'Objekttitel',
  'objekt_titel',
  'property_name',
  'property',
  'objekt',
  'immobilie',
  'object_name',
  'listing',
  'listing_name',
  'projekt',
  'project',
  'Objekt',
  'Property',
  'Immobilie',
];

interface MatchResult {
  objekt_id: string;
  objekt_name: string;
  action: 'matched' | 'created' | 'no_field';
  match_score?: number;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
    const { action, ...params } = await req.json();

    switch (action) {
      case 'match':
        return await handleMatch(supabase, params);
      case 'merge':
        return await handleMerge(supabase, params);
      default:
        return jsonResponse({ error: "Invalid action. Use 'match' or 'merge'" }, 400);
    }
  } catch (error) {
    console.error('Error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
});

/**
 * Match a contact to an objekt based on GHL contact data
 */
async function handleMatch(supabase: any, params: any): Promise<Response> {
  const { contact_data, user_id, lead_id } = params;

  if (!contact_data || !user_id) {
    return jsonResponse({ error: "contact_data and user_id required" }, 400);
  }

  // 1. Extract objekt name from contact data
  const objektName = extractObjektName(contact_data);

  if (!objektName) {
    console.log("No objekt field found in contact data");
    return jsonResponse({
      success: true,
      action: 'no_field',
      message: 'No objekt field found in contact data',
    });
  }

  console.log("Looking for objekt:", objektName);

  // 2. Try to find matching objekt
  const { data: objekte } = await supabase
    .from('objekte')
    .select('id, name, city, status')
    .eq('user_id', user_id);

  let bestMatch: { objekt: any; score: number } | null = null;

  for (const objekt of objekte || []) {
    const score = calculateMatchScore(objektName, objekt.name);
    if (score > 0.6 && (!bestMatch || score > bestMatch.score)) {
      bestMatch = { objekt, score };
    }
  }

  let result: MatchResult;

  if (bestMatch) {
    // Found a match
    console.log(`Matched "${objektName}" to "${bestMatch.objekt.name}" (score: ${bestMatch.score})`);
    result = {
      objekt_id: bestMatch.objekt.id,
      objekt_name: bestMatch.objekt.name,
      action: 'matched',
      match_score: bestMatch.score,
    };
  } else {
    // Create new objekt
    console.log(`No match found for "${objektName}", creating new objekt`);

    const { data: newObjekt, error: createError } = await supabase
      .from('objekte')
      .insert({
        user_id: user_id,
        name: objektName,
        city: 'Unbekannt',
        status: 'aktiv',
        ai_ready: false,
        price: 0,
        rooms: 0,
        area_sqm: 0,
      })
      .select()
      .single();

    if (createError) {
      console.error("Error creating objekt:", createError);
      return jsonResponse({
        error: "Failed to create objekt",
        details: createError.message,
        code: createError.code,
      }, 500);
    }

    result = {
      objekt_id: newObjekt.id,
      objekt_name: newObjekt.name,
      action: 'created',
    };
  }

  // 3. Update lead with objekt_id if lead_id provided
  if (lead_id) {
    const { error: updateError } = await supabase
      .from('leads')
      .update({ objekt_id: result.objekt_id })
      .eq('id', lead_id);

    if (updateError) {
      console.error("Error updating lead:", updateError);
    } else {
      console.log(`Lead ${lead_id} assigned to objekt ${result.objekt_id}`);
    }
  }

  return jsonResponse({ success: true, ...result });
}

/**
 * Merge two objekte - moves all data from source to target
 */
async function handleMerge(supabase: any, params: any): Promise<Response> {
  const { source_objekt_id, target_objekt_id, user_id } = params;

  if (!source_objekt_id || !target_objekt_id || !user_id) {
    return jsonResponse({ error: "source_objekt_id, target_objekt_id, and user_id required" }, 400);
  }

  if (source_objekt_id === target_objekt_id) {
    return jsonResponse({ error: "Cannot merge objekt with itself" }, 400);
  }

  // Verify both objekte exist and belong to user
  const { data: objekte } = await supabase
    .from('objekte')
    .select('id, name')
    .eq('user_id', user_id)
    .in('id', [source_objekt_id, target_objekt_id]);

  if (!objekte || objekte.length !== 2) {
    return jsonResponse({ error: "One or both objekte not found" }, 404);
  }

  const sourceObjekt = objekte.find((o: any) => o.id === source_objekt_id);
  const targetObjekt = objekte.find((o: any) => o.id === target_objekt_id);

  console.log(`Merging "${sourceObjekt.name}" into "${targetObjekt.name}"`);

  const stats = {
    leads_moved: 0,
    ki_wissen_moved: 0,
    todos_moved: 0,
  };

  // 1. Move all leads from source to target
  const { data: movedLeads, error: leadsError } = await supabase
    .from('leads')
    .update({ objekt_id: target_objekt_id })
    .eq('objekt_id', source_objekt_id)
    .select('id');

  if (leadsError) {
    console.error("Error moving leads:", leadsError);
  } else {
    stats.leads_moved = movedLeads?.length || 0;
    console.log(`Moved ${stats.leads_moved} leads`);
  }

  // 2. Move all ki_wissen from source to target
  const { data: movedWissen, error: wissenError } = await supabase
    .from('ki_wissen')
    .update({ objekt_id: target_objekt_id })
    .eq('objekt_id', source_objekt_id)
    .select('id');

  if (wissenError) {
    console.error("Error moving ki_wissen:", wissenError);
  } else {
    stats.ki_wissen_moved = movedWissen?.length || 0;
    console.log(`Moved ${stats.ki_wissen_moved} ki_wissen entries`);
  }

  // 3. Move all todos from source to target
  const { data: movedTodos, error: todosError } = await supabase
    .from('todos')
    .update({ objekt_id: target_objekt_id })
    .eq('objekt_id', source_objekt_id)
    .select('id');

  if (todosError) {
    console.error("Error moving todos:", todosError);
  } else {
    stats.todos_moved = movedTodos?.length || 0;
    console.log(`Moved ${stats.todos_moved} todos`);
  }

  // 4. Delete the source objekt
  const { error: deleteError } = await supabase
    .from('objekte')
    .delete()
    .eq('id', source_objekt_id);

  if (deleteError) {
    console.error("Error deleting source objekt:", deleteError);
    return jsonResponse({
      success: false,
      error: "Data moved but failed to delete source objekt",
      stats,
    }, 500);
  }

  console.log(`Deleted source objekt ${source_objekt_id}`);

  return jsonResponse({
    success: true,
    message: `Merged "${sourceObjekt.name}" into "${targetObjekt.name}"`,
    source_deleted: true,
    stats,
  });
}

/**
 * Extract objekt name from GHL contact data
 */
function extractObjektName(contactData: any): string | null {
  console.log("Extracting objekt from contact data keys:", Object.keys(contactData));

  // GHL sends customFields as ARRAY: [{ "id": "xxx", "value": "..." }]
  if (Array.isArray(contactData.customFields)) {
    console.log("customFields is ARRAY with", contactData.customFields.length, "items");

    // Look for first non-empty value (typically the objekttitel)
    for (const field of contactData.customFields) {
      if (field.value && typeof field.value === 'string' && field.value.trim()) {
        console.log(`Found in customFields array (id: ${field.id}):`, field.value);
        return field.value.trim();
      }
    }
  }

  // Check customFields as object (alternative format)
  if (contactData.customFields && !Array.isArray(contactData.customFields)) {
    console.log("customFields is OBJECT with keys:", Object.keys(contactData.customFields));
    for (const fieldName of OBJEKT_FIELD_NAMES) {
      if (contactData.customFields[fieldName]) {
        console.log(`Found in customFields.${fieldName}:`, contactData.customFields[fieldName]);
        return contactData.customFields[fieldName].trim();
      }
    }

    // Also check by iterating all custom fields
    for (const [key, value] of Object.entries(contactData.customFields)) {
      const keyLower = key.toLowerCase();
      if (keyLower.includes('objekt') || keyLower.includes('property') ||
          keyLower.includes('immobilie') || keyLower.includes('listing') ||
          keyLower.includes('titel')) {
        if (typeof value === 'string' && value.trim()) {
          console.log(`Found via iteration customFields.${key}:`, value);
          return value.trim();
        }
      }
    }
  }

  // Check customField (singular) - GHL sometimes uses this
  if (contactData.customField) {
    console.log("customField found (singular):", typeof contactData.customField);
    if (Array.isArray(contactData.customField)) {
      for (const field of contactData.customField) {
        if (field.value && typeof field.value === 'string' && field.value.trim()) {
          return field.value.trim();
        }
      }
    } else if (typeof contactData.customField === 'object') {
      for (const fieldName of OBJEKT_FIELD_NAMES) {
        if (contactData.customField[fieldName]) {
          console.log(`Found in customField.${fieldName}:`, contactData.customField[fieldName]);
          return contactData.customField[fieldName].trim();
        }
      }
    }
  }

  // Check customField array (alternative GHL format)
  if (Array.isArray(contactData.customField)) {
    for (const field of contactData.customField) {
      const fieldName = (field.name || field.key || '').toLowerCase();
      if (fieldName.includes('objekt') || fieldName.includes('property') ||
          fieldName.includes('immobilie') || fieldName.includes('listing')) {
        if (field.value && typeof field.value === 'string') {
          return field.value.trim();
        }
      }
    }
  }

  // Check top-level fields
  for (const fieldName of OBJEKT_FIELD_NAMES) {
    if (contactData[fieldName]) {
      return contactData[fieldName].trim();
    }
  }

  // Check tags for objekt info (sometimes stored as tag)
  if (Array.isArray(contactData.tags)) {
    for (const tag of contactData.tags) {
      // Tags often have format "Objekt: Musterstraße 1"
      if (typeof tag === 'string' && tag.toLowerCase().startsWith('objekt:')) {
        return tag.substring(7).trim();
      }
    }
  }

  return null;
}

/**
 * Calculate similarity score between two strings (0-1)
 */
function calculateMatchScore(search: string, target: string): number {
  const s1 = search.toLowerCase().trim();
  const s2 = target.toLowerCase().trim();

  // Exact match
  if (s1 === s2) return 1.0;

  // One contains the other
  if (s1.includes(s2) || s2.includes(s1)) return 0.9;

  // Levenshtein-based similarity
  const maxLen = Math.max(s1.length, s2.length);
  if (maxLen === 0) return 1.0;

  const distance = levenshteinDistance(s1, s2);
  const similarity = 1 - (distance / maxLen);

  // Also check word overlap
  const words1 = s1.split(/\s+/);
  const words2 = s2.split(/\s+/);
  let wordMatches = 0;
  for (const w1 of words1) {
    if (words2.some(w2 => w2.includes(w1) || w1.includes(w2))) {
      wordMatches++;
    }
  }
  const wordSimilarity = words1.length > 0 ? wordMatches / words1.length : 0;

  // Return best score
  return Math.max(similarity, wordSimilarity);
}

/**
 * Calculate Levenshtein distance between two strings
 */
function levenshteinDistance(s1: string, s2: string): number {
  const m = s1.length;
  const n = s2.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (s1[i - 1] === s2[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1];
      } else {
        dp[i][j] = 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
      }
    }
  }

  return dp[m][n];
}

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}
