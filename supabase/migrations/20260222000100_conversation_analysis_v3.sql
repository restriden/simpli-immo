-- EVA Performance v3: AI-Einschaetzung, Booking-Page-Summary, Finanzierung
-- Adds fields for per-lead AI explanation, booking page aggregation, and financing intent

-- New columns
ALTER TABLE lead_conversation_analysis
  ADD COLUMN IF NOT EXISTS ai_einschaetzung TEXT,
  ADD COLUMN IF NOT EXISTS booking_page_summary JSONB,
  ADD COLUMN IF NOT EXISTS finanzierung_gewollt BOOLEAN,
  ADD COLUMN IF NOT EXISTS finanzierung_ablehnungsgrund TEXT;

-- Remove 'mieter' from lead_typ CHECK constraint
ALTER TABLE lead_conversation_analysis
  DROP CONSTRAINT IF EXISTS lead_conversation_analysis_lead_typ_check;

ALTER TABLE lead_conversation_analysis
  ADD CONSTRAINT lead_conversation_analysis_lead_typ_check
  CHECK (lead_typ IN ('kaufinteressent', 'besichtigungstourist', 'investor', 'unklar'));

-- Migrate existing 'mieter' rows to 'unklar'
UPDATE lead_conversation_analysis SET lead_typ = 'unklar' WHERE lead_typ = 'mieter';
