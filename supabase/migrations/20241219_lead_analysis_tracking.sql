-- Add conversation tracking columns to leads table
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_analyzed_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS last_message_at TIMESTAMPTZ;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS conversation_status TEXT DEFAULT 'unterhaltung_laeuft';
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_improvement_suggestion TEXT;
ALTER TABLE leads ADD COLUMN IF NOT EXISTS ai_quality_score INTEGER;

-- Add constraint for valid conversation statuses
ALTER TABLE leads DROP CONSTRAINT IF EXISTS leads_conversation_status_check;
ALTER TABLE leads ADD CONSTRAINT leads_conversation_status_check
  CHECK (conversation_status IN (
    'unterhaltung_laeuft',
    'unterhaltung_abgebrochen',
    'termin_gebucht',
    'termin_angefragt',
    'simpli_interessiert',
    'simpli_nicht_interessiert',
    'abgeschlossen'
  ));

-- Update last_message_at for existing leads based on their latest message
UPDATE leads l
SET last_message_at = (
  SELECT MAX(m.created_at)
  FROM messages m
  WHERE m.lead_id = l.id
)
WHERE last_message_at IS NULL;

-- Create index for efficient querying of leads needing analysis
CREATE INDEX IF NOT EXISTS idx_leads_needs_analysis
  ON leads (user_id, last_message_at, last_analyzed_at);
