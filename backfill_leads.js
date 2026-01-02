// Complete Backfill script - ONLY WhatsApp leads count
// FIXED: Fetches ALL rows with pagination (Supabase returns max 1000 per request)

const SUPABASE_URL = "https://hsfrdovpgxtqbitmkrhs.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzZnJkb3ZwZ3h0cWJpdG1rcmhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTkyMzYyNCwiZXhwIjoyMDgxNDk5NjI0fQ.-ZkP3QRT64Iw5vk6cn3LJCBFwOnF6Sh5FtuyVkC1NVk";

// Own accounts to exclude
const OWN_ACCOUNT_LOCATION_IDS = [
  "iDLo7b4WOOCkE9voshIM", // Simpli Finance GmbH
  "dI8ofFbKIogmLSUTvTFn", // simpli.immo
  "MAMK21fjL4Z52qgcvpgq", // simpli.bot
];

// Fetch ALL rows with pagination
async function fetchAll(endpoint, select, filter = "") {
  let allData = [];
  let offset = 0;
  const limit = 1000;

  while (true) {
    const url = `${SUPABASE_URL}/rest/v1/${endpoint}?select=${select}${filter}`;
    const res = await fetch(url, {
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Range": `${offset}-${offset + limit - 1}`
      }
    });
    const data = await res.json();
    if (!Array.isArray(data) || data.length === 0) break;
    allData = allData.concat(data);
    if (data.length < limit) break;
    offset += limit;
  }

  return allData;
}

function isWhatsAppMessage(msg) {
  const msgType = msg.ghl_data?.messageType;
  return msgType === 'TYPE_WHATSAPP' || msgType === 'WhatsApp';
}

function hasSfInterestJa(lead) {
  if (!lead.ai_improvement_suggestion) return false;
  try {
    const analysis = JSON.parse(lead.ai_improvement_suggestion);
    return analysis.sf_interesse === "ja";
  } catch {
    return false;
  }
}

async function updateLeadsBatch(leadIds, updates) {
  if (leadIds.length === 0) return 0;

  const batchSize = 50;
  let updated = 0;

  for (let i = 0; i < leadIds.length; i += batchSize) {
    const batch = leadIds.slice(i, i + batchSize);
    const idsParam = batch.join(',');

    const updateRes = await fetch(`${SUPABASE_URL}/rest/v1/leads?id=in.(${idsParam})`, {
      method: 'PATCH',
      headers: {
        "apikey": SUPABASE_KEY,
        "Authorization": `Bearer ${SUPABASE_KEY}`,
        "Content-Type": "application/json",
        "Prefer": "return=minimal",
      },
      body: JSON.stringify(updates),
    });

    if (updateRes.ok) {
      updated += batch.length;
    } else {
      console.error(`Batch failed:`, await updateRes.text());
    }
  }
  return updated;
}

async function main() {
  console.log("=== COMPLETE LEAD BACKFILL (WhatsApp-Only) ===\n");

  // Fetch ALL data with pagination
  console.log("Fetching ALL messages (with pagination)...");
  const messages = await fetchAll("messages", "lead_id,type,delivery_status,ghl_data");
  console.log(`Total messages: ${messages.length}`);

  console.log("Fetching ALL leads (with pagination)...");
  const allLeads = await fetchAll("leads", "id,name,ghl_location_id,simpli_platziert,ai_improvement_suggestion,sf_pipeline_stage,whatsapp_zugestellt,lead_reagiert", "&or=(is_archived.is.null,is_archived.eq.false)");
  console.log(`Total leads in DB: ${allLeads.length}`);

  // Filter out own accounts
  const leads = allLeads.filter(l => !OWN_ACCOUNT_LOCATION_IDS.includes(l.ghl_location_id));
  console.log(`Leads (excl. own accounts): ${leads.length}`);

  // Filter WhatsApp messages only
  const whatsappMessages = messages.filter(isWhatsAppMessage);
  console.log(`WhatsApp messages: ${whatsappMessages.length}\n`);

  // === IDENTIFY WHATSAPP LEADS ===
  console.log("--- Identifying WhatsApp Leads ---");
  const leadsWithWhatsApp = new Set(whatsappMessages.map(m => m.lead_id).filter(Boolean));
  const whatsappLeads = leads.filter(l => leadsWithWhatsApp.has(l.id));
  console.log(`Leads with WhatsApp messages: ${whatsappLeads.length}`);
  console.log(`Leads without WhatsApp (excluded): ${leads.length - whatsappLeads.length}\n`);

  // Create set of valid lead IDs (active, not own account)
  const validLeadIds = new Set(leads.map(l => l.id));

  // === STAGE 1: WhatsApp zugestellt ===
  console.log("--- Stage 1: WhatsApp zugestellt ---");

  // Outgoing WhatsApp = we sent them a message (only count valid leads)
  const anyOutgoing = whatsappMessages.filter(m => m.type === 'outgoing' && validLeadIds.has(m.lead_id));
  const sentLeadIds = new Set(anyOutgoing.map(m => m.lead_id).filter(Boolean));

  // WhatsApp zugestellt = message was actually DELIVERED (has delivery confirmation)
  // Only count messages with delivery_status = 'delivered' or 'read'
  const deliveredOutgoing = whatsappMessages.filter(m =>
    m.type === 'outgoing' &&
    validLeadIds.has(m.lead_id) &&
    (m.delivery_status === 'delivered' || m.delivery_status === 'read')
  );
  const deliveredLeadIds = new Set(deliveredOutgoing.map(m => m.lead_id).filter(Boolean));

  // Incoming WhatsApp = they responded (only count valid leads)
  const incomingWhatsApp = whatsappMessages.filter(m => m.type === 'incoming' && validLeadIds.has(m.lead_id));
  const respondedLeadIds = new Set(incomingWhatsApp.map(m => m.lead_id).filter(Boolean));

  // WhatsApp zugestellt = has delivery confirmation OR responded
  // Logic: If someone responded, they obviously received the message
  // This also handles the case where delivery webhooks aren't working properly
  const whatsappZugestelltIds = new Set([...deliveredLeadIds, ...respondedLeadIds]);

  // Leads who got delivery confirmation but did NOT respond
  const deliveredButNotResponded = [...deliveredLeadIds].filter(id => !respondedLeadIds.has(id));

  console.log(`  Outgoing sent (valid leads): ${sentLeadIds.size}`);
  console.log(`  Delivery confirmation (delivered/read): ${deliveredLeadIds.size}`);
  console.log(`  Responded (incoming messages): ${respondedLeadIds.size}`);
  console.log(`  Delivered but NOT responded: ${deliveredButNotResponded.length}`);
  console.log(`  → WhatsApp zugestellt (delivered OR responded): ${whatsappZugestelltIds.size}`);

  // === STAGE 2: Lead reagiert ===
  console.log("\n--- Stage 2: Lead reagiert ---");
  const leadReagiertIds = respondedLeadIds;
  console.log(`  → Lead reagiert: ${leadReagiertIds.size}`);

  // === STAGE 3: SF gepitched ===
  console.log("\n--- Stage 3: SF gepitched ---");
  const sfPitchedLeads = whatsappLeads.filter(l => l.simpli_platziert === true);
  const sfPitchedIds = new Set(sfPitchedLeads.map(l => l.id));
  console.log(`  → SF gepitched: ${sfPitchedIds.size}`);

  // === STAGE 4: SF Interesse ===
  console.log("\n--- Stage 4: SF Interesse ---");
  const sfInterestedLeads = whatsappLeads.filter(l => hasSfInterestJa(l));
  const sfInterestedIds = new Set(sfInterestedLeads.map(l => l.id));
  console.log(`  → SF Interesse (ja): ${sfInterestedIds.size}`);

  // === Summary ===
  console.log("\n=== FUNNEL SUMMARY (WhatsApp Leads Only) ===");
  console.log(`1. WhatsApp Leads gesamt: ${whatsappLeads.length}`);
  console.log(`2. WhatsApp zugestellt: ${whatsappZugestelltIds.size}`);
  console.log(`3. Lead reagiert: ${leadReagiertIds.size}`);
  console.log(`4. SF gepitched: ${sfPitchedIds.size}`);
  console.log(`5. SF Interesse: ${sfInterestedIds.size}`);

  // Sanity check
  console.log("\n=== SANITY CHECK ===");
  if (whatsappZugestelltIds.size >= leadReagiertIds.size) {
    console.log("✓ whatsapp_zugestellt >= lead_reagiert (logical)");
  } else {
    console.log("⚠ whatsapp_zugestellt < lead_reagiert (should investigate)");
  }

  // === Update Database ===
  console.log("\n=== UPDATING DATABASE ===");

  // Reset all tracking fields first
  console.log("Resetting whatsapp_zugestellt...");
  await fetch(`${SUPABASE_URL}/rest/v1/leads?whatsapp_zugestellt=eq.true`, {
    method: 'PATCH',
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({ whatsapp_zugestellt: false }),
  });

  console.log("Resetting lead_reagiert...");
  await fetch(`${SUPABASE_URL}/rest/v1/leads?lead_reagiert=eq.true`, {
    method: 'PATCH',
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Content-Type": "application/json",
      "Prefer": "return=minimal",
    },
    body: JSON.stringify({ lead_reagiert: false }),
  });

  // Update whatsapp_zugestellt
  console.log(`\nSetting whatsapp_zugestellt=true for ${whatsappZugestelltIds.size} leads...`);
  const updated1 = await updateLeadsBatch([...whatsappZugestelltIds], { whatsapp_zugestellt: true });
  console.log(`  Updated: ${updated1}`);

  // Update lead_reagiert
  console.log(`Setting lead_reagiert=true for ${leadReagiertIds.size} leads...`);
  const updated2 = await updateLeadsBatch([...leadReagiertIds], { lead_reagiert: true });
  console.log(`  Updated: ${updated2}`);

  console.log("\n✓ Backfill complete!");
}

main().catch(console.error);
