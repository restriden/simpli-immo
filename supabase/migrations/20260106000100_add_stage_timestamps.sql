-- Add timestamp fields for tracking WHEN leads reached each SF stage
-- This allows proper time-based funnel analysis

-- Add timestamp columns for each stage
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS sf_reached_beratung_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sf_reached_bestaetigung_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sf_reached_warte_kredit_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sf_reached_vertrag_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sf_reached_auszahlung_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sf_reached_blockiert_at TIMESTAMPTZ;

-- Add index for date-based queries
CREATE INDEX IF NOT EXISTS idx_leads_sf_beratung_at ON leads(sf_reached_beratung_at) WHERE sf_reached_beratung_at IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_leads_sf_bestaetigung_at ON leads(sf_reached_bestaetigung_at) WHERE sf_reached_bestaetigung_at IS NOT NULL;

-- Backfill: Set timestamps for existing leads using sf_pipeline_updated_at as approximation
UPDATE leads SET sf_reached_beratung_at = sf_pipeline_updated_at
WHERE sf_reached_beratung = true AND sf_reached_beratung_at IS NULL AND sf_pipeline_updated_at IS NOT NULL;

UPDATE leads SET sf_reached_bestaetigung_at = sf_pipeline_updated_at
WHERE sf_reached_bestaetigung = true AND sf_reached_bestaetigung_at IS NULL AND sf_pipeline_updated_at IS NOT NULL;

UPDATE leads SET sf_reached_warte_kredit_at = sf_pipeline_updated_at
WHERE sf_reached_warte_kredit = true AND sf_reached_warte_kredit_at IS NULL AND sf_pipeline_updated_at IS NOT NULL;

UPDATE leads SET sf_reached_vertrag_at = sf_pipeline_updated_at
WHERE sf_reached_vertrag = true AND sf_reached_vertrag_at IS NULL AND sf_pipeline_updated_at IS NOT NULL;

UPDATE leads SET sf_reached_auszahlung_at = sf_pipeline_updated_at
WHERE sf_reached_auszahlung = true AND sf_reached_auszahlung_at IS NULL AND sf_pipeline_updated_at IS NOT NULL;

UPDATE leads SET sf_reached_blockiert_at = sf_pipeline_updated_at
WHERE sf_reached_blockiert = true AND sf_reached_blockiert_at IS NULL AND sf_pipeline_updated_at IS NOT NULL;

COMMENT ON COLUMN leads.sf_reached_beratung_at IS 'When the lead first reached Beratung stage';
COMMENT ON COLUMN leads.sf_reached_bestaetigung_at IS 'When the lead first received financing confirmation';
