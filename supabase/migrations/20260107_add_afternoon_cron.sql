-- ============================================================
-- ZWEITER CRON-JOB FÜR 15:00 UHR FOLLOW-UP VERSAND
-- ============================================================
-- Zusätzlich zum 10:00 Uhr Job wird nun auch um 15:00 Uhr geprüft
-- ============================================================

-- Erstelle den nachmittäglichen Cron-Job
-- Schedule: Mo-Fr um 14:00 UTC = 15:00 Berlin (Winterzeit) / 16:00 (Sommerzeit)
SELECT cron.schedule(
  'send-followups-afternoon',
  '0 14 * * 1-5',  -- Montag bis Freitag, 14:00 UTC = 15:00 Berlin
  'SELECT public.trigger_send_followups()'
);

-- Verifiziere alle Follow-up Jobs
SELECT jobid, jobname, schedule, command
FROM cron.job
WHERE jobname LIKE 'send-followups%';
