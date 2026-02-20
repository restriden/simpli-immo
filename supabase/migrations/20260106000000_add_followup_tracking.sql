-- Add follow-up tracking columns to followup_approvals table
-- Tracks which follow-up number this is (1 or 2) and whether previous follow-ups were sent

-- Add follow_up_number to track which follow-up this is (1 or 2)
ALTER TABLE followup_approvals
ADD COLUMN IF NOT EXISTS follow_up_number INTEGER DEFAULT 1;

-- Add tracking for sent follow-ups on leads table
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS followup_1_sent_at TIMESTAMPTZ;

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS followup_1_approved_id UUID;

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS followup_2_sent_at TIMESTAMPTZ;

ALTER TABLE leads
ADD COLUMN IF NOT EXISTS followup_2_approved_id UUID;

-- Add index for finding leads that need follow-up 2
CREATE INDEX IF NOT EXISTS idx_leads_followup_1_sent
ON leads(followup_1_sent_at)
WHERE followup_1_sent_at IS NOT NULL AND followup_2_sent_at IS NULL;

-- Add comments
COMMENT ON COLUMN followup_approvals.follow_up_number IS 'Which follow-up this is: 1 (sanfter reminder) or 2 (SF pitch + exit)';
COMMENT ON COLUMN leads.followup_1_sent_at IS 'When the first follow-up was sent';
COMMENT ON COLUMN leads.followup_1_approved_id IS 'ID of the approved follow-up 1';
COMMENT ON COLUMN leads.followup_2_sent_at IS 'When the second follow-up was sent';
COMMENT ON COLUMN leads.followup_2_approved_id IS 'ID of the approved follow-up 2';
