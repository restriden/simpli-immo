// Register webhooks for ALL active GHL connections
// This ensures MessageStatusUpdate webhook is registered for delivery tracking

const SUPABASE_URL = "https://hsfrdovpgxtqbitmkrhs.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzZnJkb3ZwZ3h0cWJpdG1rcmhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTkyMzYyNCwiZXhwIjoyMDgxNDk5NjI0fQ.-ZkP3QRT64Iw5vk6cn3LJCBFwOnF6Sh5FtuyVkC1NVk";

async function main() {
  console.log("=== REGISTER WEBHOOKS FOR ALL CONNECTIONS ===\n");

  // Fetch all active connections
  const res = await fetch(`${SUPABASE_URL}/rest/v1/ghl_connections?is_active=eq.true&select=id,location_id,location_name`, {
    headers: {
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
    }
  });

  const connections = await res.json();
  console.log(`Found ${connections.length} active connections\n`);

  let success = 0;
  let failed = 0;

  for (const conn of connections) {
    console.log(`\n--- ${conn.location_name || conn.location_id} ---`);

    try {
      const webhookRes = await fetch(`${SUPABASE_URL}/functions/v1/ghl-register-webhooks`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${SUPABASE_KEY}`,
        },
        body: JSON.stringify({ location_id: conn.location_id }),
      });

      const result = await webhookRes.json();

      if (result.success) {
        console.log(`✓ Registered ${result.webhooks_registered} webhooks`);
        if (result.webhook_ids) {
          result.webhook_ids.forEach(id => console.log(`  - ${id}`));
        }
        success++;
      } else {
        console.log(`✗ Failed: ${result.error || JSON.stringify(result.errors)}`);
        failed++;
      }
    } catch (err) {
      console.log(`✗ Error: ${err.message}`);
      failed++;
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`Success: ${success}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${connections.length}`);
}

main().catch(console.error);
