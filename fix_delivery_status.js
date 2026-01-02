// Fix delivery_status for messages that have status: "completed" in ghl_data
// These should be marked as "delivered" not "pending"

const SUPABASE_URL = "https://hsfrdovpgxtqbitmkrhs.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzZnJkb3ZwZ3h0cWJpdG1rcmhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTkyMzYyNCwiZXhwIjoyMDgxNDk5NjI0fQ.-ZkP3QRT64Iw5vk6cn3LJCBFwOnF6Sh5FtuyVkC1NVk";

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

async function main() {
  console.log("=== FIX DELIVERY STATUS ===\n");

  // Fetch all outgoing messages with pending status
  console.log("Fetching pending outgoing messages...");
  const messages = await fetchAll(
    "messages",
    "id,delivery_status,ghl_data",
    "&type=eq.outgoing&delivery_status=eq.pending"
  );
  console.log(`Found ${messages.length} pending outgoing messages\n`);

  // Analyze ghl_data.status values
  const statusCounts = {};
  const toFix = [];

  for (const msg of messages) {
    const ghlStatus = msg.ghl_data?.status;
    statusCounts[ghlStatus || "null"] = (statusCounts[ghlStatus || "null"] || 0) + 1;

    // If ghl_data.status is completed/delivered/read/sent, mark as delivered
    if (ghlStatus) {
      const s = ghlStatus.toLowerCase();
      if (s === "completed" || s === "delivered" || s === "read" || s === "sent") {
        toFix.push({ id: msg.id, newStatus: s === "read" ? "read" : "delivered" });
      }
    }
  }

  console.log("GHL status distribution in pending messages:");
  Object.entries(statusCounts).sort((a, b) => b[1] - a[1]).forEach(([k, v]) => {
    console.log(`  ${k}: ${v}`);
  });

  console.log(`\nMessages to fix: ${toFix.length}`);

  if (toFix.length === 0) {
    console.log("Nothing to fix!");
    return;
  }

  // Update in batches
  console.log("\nUpdating...");
  const batchSize = 50;
  let updated = 0;

  for (let i = 0; i < toFix.length; i += batchSize) {
    const batch = toFix.slice(i, i + batchSize);

    for (const item of batch) {
      const res = await fetch(`${SUPABASE_URL}/rest/v1/messages?id=eq.${item.id}`, {
        method: "PATCH",
        headers: {
          "apikey": SUPABASE_KEY,
          "Authorization": `Bearer ${SUPABASE_KEY}`,
          "Content-Type": "application/json",
          "Prefer": "return=minimal",
        },
        body: JSON.stringify({
          delivery_status: item.newStatus,
          updated_at: new Date().toISOString()
        }),
      });

      if (res.ok) {
        updated++;
      } else {
        console.error(`Failed to update ${item.id}:`, await res.text());
      }
    }

    console.log(`  Updated ${updated}/${toFix.length}`);
  }

  console.log(`\n✓ Fixed ${updated} messages`);

  // Now re-run backfill to update lead flags
  console.log("\n=== RE-RUNNING LEAD BACKFILL ===");
}

main().catch(console.error);
