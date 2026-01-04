-- MA (Mitarbeiter) Assignments for Follow-up Approvals
-- Assigns which SimpliOS user handles follow-up approvals for each Makler account

CREATE TABLE IF NOT EXISTS followup_ma_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Makler account (GHL location)
  location_id TEXT NOT NULL,
  location_name TEXT,

  -- Assigned SimpliOS user (NULL = all admins can approve)
  assigned_user_id INTEGER,
  assigned_user_name TEXT,

  -- Settings
  notify_on_pending BOOLEAN DEFAULT TRUE, -- Send notification when new follow-up pending
  auto_expire_hours INTEGER DEFAULT 24, -- Auto-expire pending approvals after X hours

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  -- One assignment per location
  UNIQUE(location_id)
);

CREATE INDEX idx_followup_ma_assignments_user ON followup_ma_assignments(assigned_user_id);
CREATE INDEX idx_followup_ma_assignments_location ON followup_ma_assignments(location_id);

-- Enable RLS
ALTER TABLE followup_ma_assignments ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all on followup_ma_assignments" ON followup_ma_assignments FOR ALL USING (true) WITH CHECK (true);

-- Update trigger
CREATE TRIGGER trigger_followup_ma_assignments_updated
  BEFORE UPDATE ON followup_ma_assignments
  FOR EACH ROW EXECUTE FUNCTION update_followup_updated_at();

-- Add assigned_to field to followup_approvals to track who should approve
ALTER TABLE followup_approvals
ADD COLUMN IF NOT EXISTS assigned_to INTEGER;

CREATE INDEX IF NOT EXISTS idx_followup_approvals_assigned ON followup_approvals(assigned_to);

COMMENT ON TABLE followup_ma_assignments IS 'Maps Makler accounts to SimpliOS users who approve their follow-ups';
