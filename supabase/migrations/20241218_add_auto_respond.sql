-- Add auto_respond_enabled column to leads table
-- Default is FALSE - must be enabled per lead
ALTER TABLE leads ADD COLUMN IF NOT EXISTS auto_respond_enabled BOOLEAN DEFAULT FALSE;

-- Add index for faster queries
CREATE INDEX IF NOT EXISTS idx_leads_auto_respond ON leads(auto_respond_enabled) WHERE auto_respond_enabled = TRUE;

COMMENT ON COLUMN leads.auto_respond_enabled IS 'Enable AI auto-response for this specific lead';
