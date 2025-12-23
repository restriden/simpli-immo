-- Migration: Track when Makler was notified via GHL Workflow
-- This adds a timestamp field to track when the workflow fired

-- Add makler_notified_at column to leads table
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS makler_notified_at TIMESTAMPTZ;

-- Add index for filtering/sorting by notification status
CREATE INDEX IF NOT EXISTS idx_leads_makler_notified ON leads(makler_notified_at);

-- Comment for documentation
COMMENT ON COLUMN leads.makler_notified_at IS 'Timestamp when Makler was notified via GHL workflow (set by webhook)';
