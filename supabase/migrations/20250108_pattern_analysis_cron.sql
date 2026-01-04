-- Enable pg_cron extension if not already enabled
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Schedule daily pattern analysis at 3:00 AM UTC (4:00 AM CET)
-- Note: This uses Supabase's webhook-based invocation
-- The actual cron job will be set up via Supabase Dashboard > Edge Functions > Schedule

-- For now, we'll create a function to track when analysis should run
CREATE OR REPLACE FUNCTION should_run_pattern_analysis()
RETURNS BOOLEAN AS $$
DECLARE
  last_analysis_date DATE;
BEGIN
  SELECT analysis_date INTO last_analysis_date
  FROM followup_pattern_analysis
  ORDER BY analysis_date DESC
  LIMIT 1;

  -- Run if no analysis exists or if last analysis was not today
  RETURN last_analysis_date IS NULL OR last_analysis_date < CURRENT_DATE;
END;
$$ LANGUAGE plpgsql;

-- Add comment with instructions
COMMENT ON FUNCTION should_run_pattern_analysis IS
'Check if daily pattern analysis should run.
To schedule: Go to Supabase Dashboard > Edge Functions > analyze-followup-patterns > Schedule
Set cron expression: 0 3 * * * (daily at 3:00 AM UTC)';
