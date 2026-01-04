-- Schedule daily pattern analysis using pg_cron and pg_net
-- Runs at 4:00 AM CET (3:00 AM UTC)

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create the cron job to call the Edge Function daily
SELECT cron.schedule(
  'daily-followup-pattern-analysis',  -- job name
  '0 3 * * *',                         -- cron expression: 3:00 AM UTC daily
  $$
  SELECT net.http_post(
    url := 'https://hsfrdovpgxtqbitmkrhs.supabase.co/functions/v1/analyze-followup-patterns',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"days_back": 7}'::jsonb
  );
  $$
);

-- Also create a manual trigger function for testing
CREATE OR REPLACE FUNCTION trigger_pattern_analysis()
RETURNS jsonb AS $$
DECLARE
  result jsonb;
BEGIN
  SELECT content::jsonb INTO result
  FROM net.http_post(
    url := 'https://hsfrdovpgxtqbitmkrhs.supabase.co/functions/v1/analyze-followup-patterns',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || current_setting('app.settings.service_role_key', true)
    ),
    body := '{"days_back": 7}'::jsonb
  );
  RETURN result;
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION trigger_pattern_analysis IS 'Manually trigger the daily pattern analysis. Call with: SELECT trigger_pattern_analysis();';
