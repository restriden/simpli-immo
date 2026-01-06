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
// Keys must use ASCII equivalents (u instead of ü, etc.) to match normalization
const STAGE_MAPPING: Record<string, string> = {
  // Beratung stages (consultation booked or later)
  "finanzierungsberatung gebucht": "beratung_gebucht",
  "termin vereinbart": "beratung_gebucht",
  "unterlagen angefordert": "beratung_gebucht",
  "unterlagen in prufung": "beratung_gebucht", // ü -> u
  // Confirmation stages
  "finanzierungsbestatigung ausgestellt": "bestaetigung_ausgestellt", // ä -> a
  "finanzierbar aber objekt nicht gekauft": "bestaetigung_ausgestellt",
  // Credit stages
  "warte auf kreditentscheidung": "warte_auf_kredit",
  // Contract stages
  "vertrag unterschrieben": "vertrag_unterschrieben",
  // Payout stages
  "auszahlung erhalten": "auszahlung_erhalten",
  // Negative stages
  "finanzierung blockiert": "blockiert",
  "noshow": "no_show",
  "abgesagt": "abgesagt",
  "abgelehnt nicht geeignet lost": "abgelehnt",
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

interface Appointment {
  id: string;
  title: string;
  startTime: string;
  endTime?: string;
  status: string; // "confirmed", "cancelled", "no_show", etc.
  contactId: string;
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
    // IMPORTANT: Fetch ALL leads with pagination (Supabase default limit is 1000)
    console.log("Fetching Makler leads...");
    let maklerLeads: any[] = [];
    let offset = 0;
    const pageSize = 1000;

    while (true) {
      const { data: page, error: leadsError } = await supabase
        .from("leads")
        .select(`
          id, email, phone, name, sf_opportunity_id, sf_pipeline_stage, ghl_location_id,
          sf_reached_beratung, sf_reached_bestaetigung, sf_reached_warte_kredit,
          sf_reached_vertrag, sf_reached_auszahlung, sf_reached_blockiert,
          sf_reached_beratung_at, sf_reached_bestaetigung_at, sf_reached_warte_kredit_at,
          sf_reached_vertrag_at, sf_reached_auszahlung_at, sf_reached_blockiert_at,
          sf_termin_datum, sf_termin_stattgefunden, sf_termin_stattgefunden_at
        `)
        .or("email.not.is.null,phone.not.is.null")
        .neq("ghl_location_id", SIMPLI_FINANCE_LOCATION_ID) // Exclude SF's own contacts
        .neq("is_archived", true) // Exclude archived leads (includes null and false)
        .range(offset, offset + pageSize - 1);

      if (leadsError) {
        console.error("Error fetching leads:", leadsError);
        return jsonResponse({ error: "Failed to fetch leads" }, 500);
      }

      if (!page || page.length === 0) break;

      maklerLeads = maklerLeads.concat(page);
      console.log(`Fetched ${page.length} leads (offset ${offset}, total ${maklerLeads.length})`);

      if (page.length < pageSize) break; // Last page
      offset += pageSize;
    }

    console.log("Total Makler leads to match:", maklerLeads.length);

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
    const updates: {
      leadId: string;
      oppId: string;
      stage: string;
      sfContactId: string;
      oppUpdatedAt: string;
      currentFlags: {
        sf_reached_beratung: boolean | null;
        sf_reached_bestaetigung: boolean | null;
        sf_reached_warte_kredit: boolean | null;
        sf_reached_vertrag: boolean | null;
        sf_reached_auszahlung: boolean | null;
        sf_reached_blockiert: boolean | null;
        sf_reached_beratung_at: string | null;
        sf_reached_bestaetigung_at: string | null;
        sf_reached_warte_kredit_at: string | null;
        sf_reached_vertrag_at: string | null;
        sf_reached_auszahlung_at: string | null;
        sf_reached_blockiert_at: string | null;
        sf_termin_datum: string | null;
        sf_termin_stattgefunden: boolean | null;
        sf_termin_stattgefunden_at: string | null;
      };
      appointment: Appointment | null;
    }[] = [];

    // Step 5a: Fetch calendar appointments for SF contacts
    console.log("Fetching calendar appointments...");
    const appointmentMap: Record<string, Appointment> = {};

    // Get all calendars for SF location
    const calendarsUrl = `${GHL_API_BASE}/calendars/?locationId=${SIMPLI_FINANCE_LOCATION_ID}`;
    const calendarsRes = await fetch(calendarsUrl, { headers });

    if (calendarsRes.ok) {
      const calendarsData = await calendarsRes.json();
      const calendars = calendarsData.calendars || [];
      console.log(`Found ${calendars.length} calendars`);

      // Fetch events from each calendar (next 60 days and past 30 days)
      const now = Date.now();
      const startTime = now - (30 * 24 * 60 * 60 * 1000); // 30 days ago
      const endTime = now + (60 * 24 * 60 * 60 * 1000); // 60 days from now

      for (const calendar of calendars) {
        try {
          const eventsUrl = `${GHL_API_BASE}/calendars/events?calendarId=${calendar.id}&startTime=${startTime}&endTime=${endTime}`;
          const eventsRes = await fetch(eventsUrl, { headers });

          if (eventsRes.ok) {
            const eventsData = await eventsRes.json();
            const events = eventsData.events || [];

            for (const event of events) {
              if (event.contactId && event.startTime) {
                // Only store if we don't have an appointment for this contact yet
                // or if this appointment is more recent
                const existing = appointmentMap[event.contactId];
                if (!existing || new Date(event.startTime) > new Date(existing.startTime)) {
                  appointmentMap[event.contactId] = {
                    id: event.id,
                    title: event.title || "Beratungstermin",
                    startTime: event.startTime,
                    endTime: event.endTime,
                    status: event.status || "confirmed",
                    contactId: event.contactId,
                  };
                }
              }
            }
          }
          // Rate limiting
          await new Promise(r => setTimeout(r, 100));
        } catch (err) {
          console.error(`Error fetching events for calendar ${calendar.id}:`, err);
        }
      }
    }

    console.log(`Found appointments for ${Object.keys(appointmentMap).length} contacts`);

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
        // 1. Lowercase
        // 2. Replace umlauts with ASCII equivalents
        // 3. Remove emojis and special characters (keep letters, numbers, spaces)
        const stageKey = stageName
          .toLowerCase()
          .replace(/ü/g, "u")
          .replace(/ö/g, "o")
          .replace(/ä/g, "a")
          .replace(/ß/g, "ss")
          .replace(/[^\w\s]/g, "")
          .trim();
        console.log(`Stage normalization: "${stageName}" -> "${stageKey}"`);
        const normalizedStage = STAGE_MAPPING[stageKey] || stageName;

        // Get appointment for this contact if available
        const appointment = appointmentMap[opp.contactId];

        // Check if update needed (always update if we have appointment data and lead doesn't have it yet)
        const needsUpdate = matchedLead.sf_opportunity_id !== opp.id ||
                           matchedLead.sf_pipeline_stage !== normalizedStage ||
                           (appointment && !matchedLead.sf_termin_datum);

        if (needsUpdate) {
          updates.push({
            leadId: matchedLead.id,
            oppId: opp.id,
            stage: normalizedStage,
            sfContactId: opp.contactId,
            oppUpdatedAt: opp.updatedAt, // Use the GHL opportunity timestamp
            currentFlags: {
              sf_reached_beratung: matchedLead.sf_reached_beratung,
              sf_reached_bestaetigung: matchedLead.sf_reached_bestaetigung,
              sf_reached_warte_kredit: matchedLead.sf_reached_warte_kredit,
              sf_reached_vertrag: matchedLead.sf_reached_vertrag,
              sf_reached_auszahlung: matchedLead.sf_reached_auszahlung,
              sf_reached_blockiert: matchedLead.sf_reached_blockiert,
              sf_reached_beratung_at: matchedLead.sf_reached_beratung_at,
              sf_reached_bestaetigung_at: matchedLead.sf_reached_bestaetigung_at,
              sf_reached_warte_kredit_at: matchedLead.sf_reached_warte_kredit_at,
              sf_reached_vertrag_at: matchedLead.sf_reached_vertrag_at,
              sf_reached_auszahlung_at: matchedLead.sf_reached_auszahlung_at,
              sf_reached_blockiert_at: matchedLead.sf_reached_blockiert_at,
              sf_termin_datum: matchedLead.sf_termin_datum,
              sf_termin_stattgefunden: matchedLead.sf_termin_stattgefunden,
              sf_termin_stattgefunden_at: matchedLead.sf_termin_stattgefunden_at,
            },
            appointment: appointment || null,
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
      const stageTimestamps: Record<string, string> = {};
      const stage = update.stage.toLowerCase();

      // Use the opportunity's updatedAt timestamp from GHL
      const oppTimestamp = update.oppUpdatedAt || new Date().toISOString();

      // Set flags for current stage and all previous stages
      // Only set timestamp if flag was not already true (first time reaching this stage)
      if (stage.includes("beratung") || stage.includes("bestaetigung") ||
          stage.includes("warte") || stage.includes("vertrag") || stage.includes("auszahlung")) {
        stageFlags.sf_reached_beratung = true;
        if (!update.currentFlags.sf_reached_beratung && !update.currentFlags.sf_reached_beratung_at) {
          stageTimestamps.sf_reached_beratung_at = oppTimestamp;
        }
      }
      if (stage.includes("bestaetigung") || stage.includes("warte") ||
          stage.includes("vertrag") || stage.includes("auszahlung")) {
        stageFlags.sf_reached_bestaetigung = true;
        if (!update.currentFlags.sf_reached_bestaetigung && !update.currentFlags.sf_reached_bestaetigung_at) {
          stageTimestamps.sf_reached_bestaetigung_at = oppTimestamp;
        }
      }
      if (stage.includes("warte") || stage.includes("vertrag") || stage.includes("auszahlung")) {
        stageFlags.sf_reached_warte_kredit = true;
        if (!update.currentFlags.sf_reached_warte_kredit && !update.currentFlags.sf_reached_warte_kredit_at) {
          stageTimestamps.sf_reached_warte_kredit_at = oppTimestamp;
        }
      }
      if (stage.includes("vertrag") || stage.includes("auszahlung")) {
        stageFlags.sf_reached_vertrag = true;
        if (!update.currentFlags.sf_reached_vertrag && !update.currentFlags.sf_reached_vertrag_at) {
          stageTimestamps.sf_reached_vertrag_at = oppTimestamp;
        }
      }
      if (stage.includes("auszahlung")) {
        stageFlags.sf_reached_auszahlung = true;
        if (!update.currentFlags.sf_reached_auszahlung && !update.currentFlags.sf_reached_auszahlung_at) {
          stageTimestamps.sf_reached_auszahlung_at = oppTimestamp;
        }
      }
      if (stage.includes("blockiert")) {
        stageFlags.sf_reached_blockiert = true;
        if (!update.currentFlags.sf_reached_blockiert && !update.currentFlags.sf_reached_blockiert_at) {
          stageTimestamps.sf_reached_blockiert_at = oppTimestamp;
        }
      }

      // Handle appointment/termin data
      const terminData: Record<string, unknown> = {};

      if (update.appointment && !update.currentFlags.sf_termin_datum) {
        // Set appointment date if we have it and lead doesn't have it yet
        terminData.sf_termin_datum = update.appointment.startTime;
      }

      // Check if termin stattgefunden (appointment completed)
      // Logic: appointment date has passed AND lead is NOT in no_show or abgesagt status
      if (update.appointment && !update.currentFlags.sf_termin_stattgefunden) {
        const appointmentDate = new Date(update.appointment.startTime);
        const now = new Date();
        const isNoShow = stage.includes("no_show") || stage.includes("noshow");
        const isAbgesagt = stage.includes("abgesagt") || stage.includes("cancelled");

        // Termin hat stattgefunden wenn:
        // 1. Termindatum ist vergangen UND
        // 2. Lead ist NICHT in no_show oder abgesagt Status UND
        // 3. Appointment status ist nicht "cancelled" oder "no_show"
        const appointmentCompleted = appointmentDate < now &&
                                     !isNoShow &&
                                     !isAbgesagt &&
                                     update.appointment.status !== "cancelled" &&
                                     update.appointment.status !== "no_show";

        if (appointmentCompleted) {
          terminData.sf_termin_stattgefunden = true;
          terminData.sf_termin_stattgefunden_at = update.appointment.startTime; // Use appointment time as completion time
        }
      }

      // Also mark termin as completed if they've progressed past beratung stage
      // (e.g., if they're in bestaetigung or later, appointment must have happened)
      if (!update.currentFlags.sf_termin_stattgefunden &&
          (stage.includes("bestaetigung") || stage.includes("warte") ||
           stage.includes("vertrag") || stage.includes("auszahlung"))) {
        terminData.sf_termin_stattgefunden = true;
        if (!update.currentFlags.sf_termin_stattgefunden_at) {
          // Use beratung timestamp or opportunity timestamp as fallback
          terminData.sf_termin_stattgefunden_at =
            update.currentFlags.sf_reached_beratung_at ||
            stageTimestamps.sf_reached_beratung_at ||
            oppTimestamp;
        }
      }

      // Also mark termin as completed if lead is "blockiert" but previously reached beratung
      // This means they had an appointment that happened before being blocked
      if (!update.currentFlags.sf_termin_stattgefunden &&
          !terminData.sf_termin_stattgefunden &&
          stage.includes("blockiert") &&
          (update.currentFlags.sf_reached_beratung || stageFlags.sf_reached_beratung)) {
        terminData.sf_termin_stattgefunden = true;
        if (!update.currentFlags.sf_termin_stattgefunden_at) {
          terminData.sf_termin_stattgefunden_at =
            update.currentFlags.sf_reached_beratung_at ||
            stageTimestamps.sf_reached_beratung_at ||
            oppTimestamp;
        }
      }

      console.log(`Updating lead ${update.leadId}: stage=${update.stage}, oppTimestamp=${oppTimestamp}, newTimestamps=${JSON.stringify(stageTimestamps)}, terminData=${JSON.stringify(terminData)}`);

      const { error: updateError } = await supabase
        .from("leads")
        .update({
          sf_opportunity_id: update.oppId,
          sf_pipeline_stage: update.stage,
          sf_contact_id: update.sfContactId,
          sf_pipeline_updated_at: oppTimestamp, // Use GHL opportunity timestamp
          ...stageFlags, // Set stage flags (only sets to true, never false)
          ...stageTimestamps, // Set timestamps only for newly reached stages
          ...terminData, // Set appointment/termin data
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
