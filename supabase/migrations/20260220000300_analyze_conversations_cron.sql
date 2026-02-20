-- Enable pg_net extension for HTTP calls from pg_cron
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Grant usage to postgres user
GRANT USAGE ON SCHEMA cron TO postgres;

-- Remove old job if it exists (idempotent)
SELECT cron.unschedule('analyze-conversations-nightly') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'analyze-conversations-nightly');

-- Schedule Conversation Analysis: 1x daily at 22:00 UTC (23:00 CET)
-- Runs AFTER the SF Opportunities Sync (8:00 and 18:00 UTC) so pipeline data is up-to-date.
-- Incremental: Only analyzes leads with new messages since last analysis.
-- Uses service_role key for proper DB access within the Edge Function.

SELECT cron.schedule(
  'analyze-conversations-nightly',
  '0 22 * * *',
  $$
  SELECT net.http_post(
    url := 'https://hsfrdovpgxtqbitmkrhs.supabase.co/functions/v1/analyze-conversations',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzZnJkb3ZwZ3h0cWJpdG1rcmhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTkyMzYyNCwiZXhwIjoyMDgxNDk5NjI0fQ.-ZkP3QRT64Iw5vk6cn3LJCBFwOnF6Sh5FtuyVkC1NVk',
      'X-Cron-Secret', 'simpli-cron-2024'
    ),
    body := '{"full_rerun": false}'::jsonb
  );
  $$
);
