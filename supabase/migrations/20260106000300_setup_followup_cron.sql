-- ============================================================
-- CRON-JOB FÜR AUTOMATISCHEN FOLLOW-UP VERSAND
-- ============================================================
-- Dieser Job sendet täglich um 10:00 Uhr (Berlin) alle
-- genehmigten Follow-ups über die send-scheduled-followups Edge Function.
--
-- VORAUSSETZUNG: pg_cron und pg_net müssen im Supabase Dashboard aktiviert sein!
-- Dashboard > Database > Extensions > pg_cron aktivieren
-- Dashboard > Database > Extensions > pg_net aktivieren
-- ============================================================

-- 1. Erstelle eine Funktion die den HTTP Call macht
CREATE OR REPLACE FUNCTION public.trigger_send_followups()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  service_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImhzZnJkb3ZwZ3h0cWJpdG1rcmhzIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NTkyMzYyNCwiZXhwIjoyMDgxNDk5NjI0fQ.-ZkP3QRT64Iw5vk6cn3LJCBFwOnF6Sh5FtuyVkC1NVk';
BEGIN
  PERFORM net.http_post(
    url := 'https://hsfrdovpgxtqbitmkrhs.supabase.co/functions/v1/send-scheduled-followups',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || service_key,
      'Content-Type', 'application/json'
    ),
    body := '{}'::jsonb
  );
END;
$$;

-- 2. Lösche existierenden Cron-Job falls vorhanden
SELECT cron.unschedule('send-followups-daily')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'send-followups-daily');

-- 3. Erstelle die täglichen Cron-Jobs
-- Schedule 1: Mo-Fr um 9:00 UTC = 10:00 Berlin (Winterzeit) / 11:00 (Sommerzeit)
SELECT cron.schedule(
  'send-followups-morning',
  '0 9 * * 1-5',  -- Montag bis Freitag, 9:00 UTC = 10:00 Berlin
  'SELECT public.trigger_send_followups()'
);

-- Schedule 2: Mo-Fr um 14:00 UTC = 15:00 Berlin (Winterzeit) / 16:00 (Sommerzeit)
SELECT cron.schedule(
  'send-followups-afternoon',
  '0 14 * * 1-5',  -- Montag bis Freitag, 14:00 UTC = 15:00 Berlin
  'SELECT public.trigger_send_followups()'
);

-- 4. Verifiziere die Jobs
SELECT jobid, jobname, schedule, command
FROM cron.job
WHERE jobname LIKE 'send-followups-%';
