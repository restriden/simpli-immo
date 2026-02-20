-- Enable pg_net extension for HTTP calls from pg_cron
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres user
GRANT USAGE ON SCHEMA cron TO postgres;

-- Remove old jobs if they exist (idempotent)
SELECT cron.unschedule('sync-sf-opportunities-morning') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-sf-opportunities-morning');
SELECT cron.unschedule('sync-sf-opportunities-evening') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sync-sf-opportunities-evening');

-- Schedule SF Opportunities Sync: 2x daily (8:00 and 18:00 UTC)
-- This syncs GHL pipeline stages to Makler leads via the sync-sf-opportunities Edge Function.
-- Uses service_role key for proper DB access within the Edge Function.

-- Morning sync at 8:00 UTC (9:00 CET)
SELECT cron.schedule(
  'sync-sf-opportunities-morning',
  '0 8 * * *',
  $$
  SELECT net.http_post(
    url := 'https://hsfrdovpgxtqbitmkrhs.supabase.co/functions/v1/sync-sf-opportunities',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzZnJkb3ZwZ3h0cWJpdG1rcmhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTkyMzYyNCwiZXhwIjoyMDgxNDk5NjI0fQ.-ZkP3QRT64Iw5vk6cn3LJCBFwOnF6Sh5FtuyVkC1NVk',
      'X-Cron-Secret', 'simpli-cron-2024'
    ),
    body := '{}'::jsonb
  );
  $$
);

-- Evening sync at 18:00 UTC (19:00 CET)
SELECT cron.schedule(
  'sync-sf-opportunities-evening',
  '0 18 * * *',
  $$
  SELECT net.http_post(
    url := 'https://hsfrdovpgxtqbitmkrhs.supabase.co/functions/v1/sync-sf-opportunities',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzZnJkb3ZwZ3h0cWJpdG1rcmhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTkyMzYyNCwiZXhwIjoyMDgxNDk5NjI0fQ.-ZkP3QRT64Iw5vk6cn3LJCBFwOnF6Sh5FtuyVkC1NVk',
      'X-Cron-Secret', 'simpli-cron-2024'
    ),
    body := '{}'::jsonb
  );
  $$
);
