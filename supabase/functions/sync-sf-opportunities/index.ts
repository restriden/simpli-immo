import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

/**
 * Sync SF Opportunities
 *
 * Fetches opportunities from the Simpli Finance GHL account pipeline
 * and matches them with Makler leads by email/phone.
 *
 * Pipeline Stages:
 * - Finanzierungsberatung gebucht
 * - Finanzierung blockiert
 * - Finanzierungsbestätigung ausgestellt
 * - Warte auf Kreditentscheidung
 * - Vertrag unterschrieben
 * - Auszahlung erhalten
 */

const GHL_API_BASE = "https://services.leadconnectorhq.com";
const SIMPLI_FINANCE_LOCATION_ID = "iDLo7b4WOOCkE9voshIM";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL") || "";
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
const CRON_SECRET = Deno.env.get("CRON_SECRET") || "simpli-cron-2024";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Pipeline stage mapping (clean names without emojis for DB storage)
const STAGE_MAPPING: Record<string, string> = {
  "finanzierungsberatung gebucht": "beratung_gebucht",
  "finanzierung blockiert": "blockiert",
  "finanzierungsbestätigung ausgestellt": "bestaetigung_ausgestellt",
  "warte auf kreditentscheidung": "warte_auf_kredit",
  "vertrag unterschrieben": "vertrag_unterschrieben",
  "auszahlung erhalten": "auszahlung_erhalten",
};

interface GHLConnection {
  id: string;
  user_id: string | null;
  location_id: string;
  access_token: string;
  refresh_token: string;
  token_expires_at: string;
  is_active: boolean;
}

interface Opportunity {
  id: string;
  name: string;
  pipelineId: string;
  pipelineStageId: string;
  status: string;
  contactId: string;
  monetaryValue?: number;
  createdAt: string;
  updatedAt: string;
}

interface PipelineStage {
  id: string;
  name: string;
  position: number;
}

interface Pipeline {
  id: string;
  name: string;
  stages: PipelineStage[];
}

interface Contact {
  id: string;
  email?: string;
  phone?: string;
  name?: string;
  firstName?: string;
  lastName?: string;
}

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  // Remove all non-digits, keep only numbers
  const digits = phone.replace(/\D/g, "");
  // Return last 10 digits for matching (handles country codes)
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

function normalizeEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  return email.toLowerCase().trim();
}

serve(async (req: Request) => {
  // Handle CORS preflight
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);

    // Validate authorization
    const authHeader = req.headers.get("Authorization");
    const cronSecret = req.headers.get("X-Cron-Secret");
    const isCronRequest = cronSecret === CRON_SECRET;

    if (!authHeader && !isCronRequest) {
      return jsonResponse({ error: "Missing authorization" }, 401);
    }

    console.log("=== SYNC SF OPPORTUNITIES ===");
    console.log("Simpli Finance Location ID:", SIMPLI_FINANCE_LOCATION_ID);

    // Get SF GHL connection
    const { data: sfConnection, error: connError } = await supabase
      .from("ghl_connections")
      .select("*")
      .eq("location_id", SIMPLI_FINANCE_LOCATION_ID)
      .eq("is_active", true)
      .single();

    if (connError || !sfConnection) {
      console.error("SF connection not found:", connError);
      return jsonResponse({ error: "Simpli Finance GHL connection not found" }, 404);
    }

    console.log("Found SF connection, checking token...");

    // Ensure valid token
    const validConnection = await ensureValidToken(supabase, sfConnection);
    const headers = {
      "Authorization": `Bearer ${validConnection.access_token}`,
      "Content-Type": "application/json",
      "Version": "2021-07-28",
    };

    // Step 1: Get pipelines and stages
    console.log("Fetching pipelines...");
    const pipelinesUrl = `${GHL_API_BASE}/opportunities/pipelines?locationId=${SIMPLI_FINANCE_LOCATION_ID}`;
    const pipelinesRes = await fetch(pipelinesUrl, { headers });

    if (!pipelinesRes.ok) {
      const errorText = await pipelinesRes.text();
      console.error("Pipelines API error:", pipelinesRes.status, errorText);
      return jsonResponse({ error: "Failed to fetch pipelines", details: errorText }, 500);
    }

    const pipelinesData = await pipelinesRes.json();
    const pipelines: Pipeline[] = pipelinesData.pipelines || [];
    console.log("Found pipelines:", pipelines.length);

    if (pipelines.length === 0) {
      return jsonResponse({
        success: true,
        message: "No pipelines found",
        matched: 0,
        debug: { pipelinesData }
      });
    }

    // Build stage ID to name mapping
    const stageIdToName: Record<string, string> = {};
    for (const pipeline of pipelines) {
      console.log(`Pipeline: ${pipeline.name} (${pipeline.id})`);
      for (const stage of pipeline.stages || []) {
        stageIdToName[stage.id] = stage.name;
        console.log(`  Stage: ${stage.name} (${stage.id})`);
      }
    }

    // Step 2: Get all opportunities using POST search
    console.log("Fetching opportunities...");
    let allOpportunities: Opportunity[] = [];
    let debugInfo: any = { attempts: [] };

    // GHL API v2 uses POST /opportunities/search with location_id in body
    const searchUrl = `${GHL_API_BASE}/opportunities/search`;
    console.log(`POST search: ${searchUrl}`);

    const searchRes = await fetch(searchUrl, {
      method: "POST",
      headers,
      body: JSON.stringify({
        locationId: SIMPLI_FINANCE_LOCATION_ID,
        limit: 100,
      })
    });

    console.log(`Search response status: ${searchRes.status}`);

    if (searchRes.ok) {
      const searchData = await searchRes.json();
      console.log(`Search response:`, JSON.stringify(searchData).substring(0, 1000));
      debugInfo.attempts.push({
        endpoint: "POST /opportunities/search",
        status: searchRes.status,
        keys: Object.keys(searchData),
        count: (searchData.opportunities || searchData.data || []).length
      });
      const opportunities = searchData.opportunities || searchData.data || [];
      allOpportunities.push(...opportunities);
    } else {
      const errorText = await searchRes.text();
      console.error(`Search failed: ${errorText}`);
      debugInfo.attempts.push({
        endpoint: "POST /opportunities/search",
        status: searchRes.status,
        error: errorText.substring(0, 300)
      });

      // Fallback: try GET with query params
      const getUrl = `${GHL_API_BASE}/opportunities/search?locationId=${SIMPLI_FINANCE_LOCATION_ID}&limit=100`;
      console.log(`Fallback GET: ${getUrl}`);
      const getRes = await fetch(getUrl, { headers });

      if (getRes.ok) {
        const getData = await getRes.json();
        debugInfo.attempts.push({
          endpoint: "GET /opportunities/search",
          status: getRes.status,
          count: (getData.opportunities || getData.data || []).length
        });
        allOpportunities.push(...(getData.opportunities || getData.data || []));
      } else {
        const getError = await getRes.text();
        debugInfo.attempts.push({
          endpoint: "GET /opportunities/search",
          status: getRes.status,
          error: getError.substring(0, 200)
        });
      }
    }

    console.log("Total opportunities:", allOpportunities.length);

    if (allOpportunities.length === 0) {
      return jsonResponse({
        success: true,
        message: "No opportunities found",
        matched: 0,
        debug: {
          pipelines: pipelines.map(p => ({
            id: p.id,
            name: p.name,
            stageCount: p.stages?.length || 0,
          })),
          apiAttempts: debugInfo.attempts
        }
      });
    }

    // Step 3: Get contact details for each opportunity
    console.log("Fetching contact details...");
    const contactMap: Record<string, Contact> = {};

    for (const opp of allOpportunities) {
      if (opp.contactId && !contactMap[opp.contactId]) {
        try {
          const contactUrl = `${GHL_API_BASE}/contacts/${opp.contactId}`;
          const contactRes = await fetch(contactUrl, { headers });
          if (contactRes.ok) {
            const contactData = await contactRes.json();
            contactMap[opp.contactId] = contactData.contact || contactData;
          }
          // Rate limiting
          await new Promise(r => setTimeout(r, 50));
        } catch (err) {
          console.error(`Error fetching contact ${opp.contactId}:`, err);
        }
      }
    }

    console.log("Fetched contact details:", Object.keys(contactMap).length);

    // Step 4: Get all Makler leads (non-archived, with email or phone)
    // Note: Using neq("is_archived", true) to include both null and false
    console.log("Fetching Makler leads...");
    const { data: maklerLeads, error: leadsError } = await supabase
      .from("leads")
      .select("id, email, phone, name, sf_opportunity_id, sf_pipeline_stage, ghl_location_id")
      .or("email.not.is.null,phone.not.is.null")
      .neq("ghl_location_id", SIMPLI_FINANCE_LOCATION_ID) // Exclude SF's own contacts
      .neq("is_archived", true); // Exclude archived leads (includes null and false)

    if (leadsError) {
      console.error("Error fetching leads:", leadsError);
      return jsonResponse({ error: "Failed to fetch leads" }, 500);
    }

    console.log("Makler leads to match:", maklerLeads?.length || 0);

    // Build lookup maps for leads
    const leadsByEmail: Record<string, any> = {};
    const leadsByPhone: Record<string, any> = {};

    for (const lead of maklerLeads || []) {
      const email = normalizeEmail(lead.email);
      const phone = normalizePhone(lead.phone);
      if (email) leadsByEmail[email] = lead;
      if (phone) leadsByPhone[phone] = lead;
    }

    // Step 5: Match opportunities with leads and update
    let matched = 0;
    let updated = 0;
    const updates: { leadId: string; oppId: string; stage: string; sfContactId: string }[] = [];

    for (const opp of allOpportunities) {
      const contact = contactMap[opp.contactId];
      if (!contact) continue;

      const email = normalizeEmail(contact.email);
      const phone = normalizePhone(contact.phone);

      // Try to match by email first, then phone
      let matchedLead = email ? leadsByEmail[email] : null;
      if (!matchedLead && phone) {
        matchedLead = leadsByPhone[phone];
      }

      if (matchedLead) {
        matched++;
        const stageName = stageIdToName[opp.pipelineStageId] || opp.pipelineStageId;

        // Normalize stage name for storage
        const stageKey = stageName.toLowerCase().replace(/[^\w\s]/g, "").trim();
        const normalizedStage = STAGE_MAPPING[stageKey] || stageName;

        // Check if update needed
        if (matchedLead.sf_opportunity_id !== opp.id || matchedLead.sf_pipeline_stage !== normalizedStage) {
          updates.push({
            leadId: matchedLead.id,
            oppId: opp.id,
            stage: normalizedStage,
            sfContactId: opp.contactId,
          });
        }
      }
    }

    console.log(`Matched ${matched} opportunities with leads`);
    console.log(`Updates needed: ${updates.length}`);

    // Batch update leads with stage flags (waterfall tracking)
    for (const update of updates) {
      // Determine which stage flags to set based on current stage
      // Once a flag is true, it stays true (high water mark)
      const stageFlags: Record<string, boolean> = {};
      const stage = update.stage.toLowerCase();

      // Set flags for current stage and all previous stages
      if (stage.includes("beratung") || stage.includes("bestaetigung") ||
          stage.includes("warte") || stage.includes("vertrag") || stage.includes("auszahlung")) {
        stageFlags.sf_reached_beratung = true;
      }
      if (stage.includes("bestaetigung") || stage.includes("warte") ||
          stage.includes("vertrag") || stage.includes("auszahlung")) {
        stageFlags.sf_reached_bestaetigung = true;
      }
      if (stage.includes("warte") || stage.includes("vertrag") || stage.includes("auszahlung")) {
        stageFlags.sf_reached_warte_kredit = true;
      }
      if (stage.includes("vertrag") || stage.includes("auszahlung")) {
        stageFlags.sf_reached_vertrag = true;
      }
      if (stage.includes("auszahlung")) {
        stageFlags.sf_reached_auszahlung = true;
      }
      if (stage.includes("blockiert")) {
        stageFlags.sf_reached_blockiert = true;
      }

      const { error: updateError } = await supabase
        .from("leads")
        .update({
          sf_opportunity_id: update.oppId,
          sf_pipeline_stage: update.stage,
          sf_contact_id: update.sfContactId,
          sf_pipeline_updated_at: new Date().toISOString(),
          ...stageFlags, // Set stage flags (only sets to true, never false)
        })
        .eq("id", update.leadId);

      if (updateError) {
        console.error(`Error updating lead ${update.leadId}:`, updateError);
      } else {
        updated++;
      }
    }

    console.log(`Updated ${updated} leads`);

    // Log sync
    await supabase.from("ghl_sync_logs").insert({
      connection_id: sfConnection.id,
      sync_type: "sf_opportunities",
      status: "success",
      message: `Matched ${matched} opportunities, updated ${updated} leads`,
      metadata: {
        total_opportunities: allOpportunities.length,
        matched,
        updated,
        pipelines: pipelines.map(p => p.name),
      },
    });

    return jsonResponse({
      success: true,
      total_opportunities: allOpportunities.length,
      matched,
      updated,
      pipelines: pipelines.map(p => ({ name: p.name, stages: p.stages?.length || 0 })),
    });

  } catch (error) {
    console.error("Sync error:", error);
    return jsonResponse({ error: "Internal server error", details: String(error) }, 500);
  }
});

/**
 * Ensure the GHL access token is valid, refresh if needed
 */
async function ensureValidToken(supabase: any, connection: GHLConnection): Promise<GHLConnection> {
  const expiresAt = new Date(connection.token_expires_at);
  const now = new Date();

  // Add 5 minute buffer
  const bufferMs = 5 * 60 * 1000;

  if (expiresAt.getTime() - now.getTime() > bufferMs) {
    console.log("Token still valid");
    return connection;
  }

  console.log("Token expired or expiring soon, refreshing...");

  const GHL_CLIENT_ID = "69432ebdab47804bce51b78a-mjalsvpx";
  const GHL_CLIENT_SECRET = Deno.env.get("GHL_CLIENT_SECRET") || "";

  const tokenResponse = await fetch("https://services.leadconnectorhq.com/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: GHL_CLIENT_ID,
      client_secret: GHL_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: connection.refresh_token,
    }),
  });

  if (!tokenResponse.ok) {
    const errorText = await tokenResponse.text();
    console.error("Token refresh failed:", errorText);
    throw new Error("Failed to refresh token");
  }

  const tokens = await tokenResponse.json();

  const expiresAtNew = new Date(Date.now() + tokens.expires_in * 1000);

  await supabase
    .from("ghl_connections")
    .update({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
      token_expires_at: expiresAtNew.toISOString(),
    })
    .eq("id", connection.id);

  return {
    ...connection,
    access_token: tokens.access_token,
    refresh_token: tokens.refresh_token,
    token_expires_at: expiresAtNew.toISOString(),
  };
}
