-- Self-Improving Follow-Up System
-- Migration for prompt versioning, training data, and approval workflow

-- =====================================================
-- 1. FOLLOW-UP PROMPT VERSIONS
-- Stores different versions of follow-up prompts for A/B testing
-- =====================================================
CREATE TABLE IF NOT EXISTS followup_prompt_versions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Version info
  version_number INTEGER NOT NULL,
  is_active BOOLEAN DEFAULT FALSE,
  category TEXT NOT NULL DEFAULT 'standard_followup', -- e.g. 'standard_followup', 'no_response_24h', 'after_booking'

  -- The actual prompt template
  prompt_template TEXT NOT NULL,

  -- What changed from previous version
  change_description TEXT,
  change_based_on TEXT, -- e.g. "47 rejections with feedback"

  -- Who created/approved this version
  created_by TEXT, -- 'system', 'admin', 'ai_suggestion'
  approved_by INTEGER, -- SimpliOS user ID
  approved_at TIMESTAMPTZ,

  -- Lifecycle
  activated_at TIMESTAMPTZ,
  retired_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Only one active version per category at a time
CREATE UNIQUE INDEX idx_followup_prompt_active_per_category ON followup_prompt_versions(category, is_active) WHERE is_active = true;

-- Index for finding active version by category
CREATE INDEX idx_followup_prompt_category ON followup_prompt_versions(category);

-- =====================================================
-- 2. FOLLOW-UP PROMPT PERFORMANCE
-- Tracks performance metrics for each prompt version
-- =====================================================
CREATE TABLE IF NOT EXISTS followup_prompt_performance (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  prompt_version_id UUID NOT NULL REFERENCES followup_prompt_versions(id) ON DELETE CASCADE,

  -- Metrics
  total_sent INTEGER DEFAULT 0,
  total_approved INTEGER DEFAULT 0,
  total_rejected INTEGER DEFAULT 0,
  bookings_within_48h INTEGER DEFAULT 0,
  positive_responses INTEGER DEFAULT 0,
  negative_responses INTEGER DEFAULT 0,
  no_response INTEGER DEFAULT 0,

  -- Calculated rates (updated by trigger or job)
  booking_rate DECIMAL(5,2), -- percentage
  approval_rate DECIMAL(5,2),
  positive_response_rate DECIMAL(5,2),

  -- Period tracking (daily snapshots)
  period_date DATE NOT NULL,

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,

  UNIQUE(prompt_version_id, period_date)
);

CREATE INDEX idx_followup_performance_version ON followup_prompt_performance(prompt_version_id);
CREATE INDEX idx_followup_performance_date ON followup_prompt_performance(period_date DESC);

-- =====================================================
-- 3. FOLLOW-UP APPROVALS
-- Pending follow-ups waiting for admin approval
-- =====================================================
CREATE TABLE IF NOT EXISTS followup_approvals (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Lead reference
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  lead_name TEXT,
  lead_email TEXT,
  lead_phone TEXT,

  -- Location/Makler reference
  ghl_location_id TEXT,
  location_name TEXT,

  -- The generated follow-up
  suggested_message TEXT NOT NULL,
  prompt_version_id UUID REFERENCES followup_prompt_versions(id),

  -- Context for approval decision
  conversation_summary TEXT, -- Last few messages for context
  last_messages JSONB, -- Array of recent messages
  follow_up_reason TEXT,

  -- 24h window status
  is_template_required BOOLEAN DEFAULT FALSE, -- true if 24h window closed

  -- Approval status
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected', 'expired')),

  -- If approved
  approved_by INTEGER, -- SimpliOS user ID
  approved_at TIMESTAMPTZ,
  final_message TEXT, -- May be edited before sending
  sent_at TIMESTAMPTZ,

  -- If rejected
  rejected_by INTEGER,
  rejected_at TIMESTAMPTZ,
  rejection_reason TEXT, -- Why it didn't fit

  -- Alternative message (for training)
  alternative_message TEXT, -- What the admin wrote instead

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_followup_approvals_status ON followup_approvals(status);
CREATE INDEX idx_followup_approvals_lead ON followup_approvals(lead_id);
CREATE INDEX idx_followup_approvals_location ON followup_approvals(ghl_location_id);
CREATE INDEX idx_followup_approvals_pending ON followup_approvals(created_at DESC) WHERE status = 'pending';

-- =====================================================
-- 4. FOLLOW-UP TRAINING DATA
-- Aggregated training data from approvals/rejections
-- =====================================================
CREATE TABLE IF NOT EXISTS followup_training_data (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Source reference
  approval_id UUID REFERENCES followup_approvals(id) ON DELETE SET NULL,
  lead_id UUID REFERENCES leads(id) ON DELETE SET NULL,

  -- The conversation context
  conversation_context TEXT, -- Summarized conversation
  last_messages JSONB, -- Last N messages as JSON array

  -- What was suggested vs what was used
  original_suggestion TEXT NOT NULL,
  rejection_reason TEXT,
  final_message TEXT, -- What was actually sent (if different)

  -- Outcome tracking
  outcome TEXT CHECK (outcome IN ('booking', 'positive', 'negative', 'no_response', 'pending')),
  outcome_tracked_at TIMESTAMPTZ,

  -- Training metadata
  data_type TEXT NOT NULL CHECK (data_type IN ('approved', 'rejected_with_alternative', 'rejected_no_alternative')),
  prompt_version_id UUID REFERENCES followup_prompt_versions(id),

  -- Has this been used in training?
  used_in_training BOOLEAN DEFAULT FALSE,
  used_in_training_at TIMESTAMPTZ,

  -- Timestamps
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE INDEX idx_training_data_type ON followup_training_data(data_type);
CREATE INDEX idx_training_data_outcome ON followup_training_data(outcome);
CREATE INDEX idx_training_data_unused ON followup_training_data(created_at DESC) WHERE used_in_training = FALSE;

-- =====================================================
-- 5. PATTERN ANALYSIS RESULTS
-- Daily pattern analysis results for admin review
-- =====================================================
CREATE TABLE IF NOT EXISTS followup_pattern_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  -- Analysis period
  analysis_date DATE NOT NULL,
  data_start_date DATE NOT NULL,
  data_end_date DATE NOT NULL,

  -- Sample size
  total_followups_analyzed INTEGER DEFAULT 0,
  approved_count INTEGER DEFAULT 0,
  rejected_count INTEGER DEFAULT 0,

  -- Discovered patterns (JSON)
  patterns JSONB, -- Array of discovered patterns
  -- Example: [
  --   { "pattern": "Formeller Ton performt besser bei älteren Leads", "confidence": 0.85, "sample_size": 45 },
  --   { "pattern": "Kurze Nachrichten (<50 Wörter) haben höhere Response-Rate", "confidence": 0.72, "sample_size": 89 }
  -- ]

  -- Suggested prompt improvements
  suggested_changes JSONB, -- Array of suggested changes
  suggested_prompt_template TEXT, -- Full new prompt if suggested

  -- Admin review
  reviewed_by INTEGER,
  reviewed_at TIMESTAMPTZ,
  review_decision TEXT CHECK (review_decision IN ('accepted', 'rejected', 'pending')),
  review_notes TEXT,

  -- If accepted, link to new prompt version
  new_prompt_version_id UUID REFERENCES followup_prompt_versions(id),

  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

CREATE UNIQUE INDEX idx_pattern_analysis_date ON followup_pattern_analysis(analysis_date);

-- =====================================================
-- 6. ADD FOLLOWUP MODE TO GHL CONNECTIONS
-- Toggle per Makler account: auto, suggestion, off
-- =====================================================
ALTER TABLE ghl_connections
ADD COLUMN IF NOT EXISTS followup_mode TEXT DEFAULT 'suggestion' CHECK (followup_mode IN ('auto', 'suggestion', 'off'));

COMMENT ON COLUMN ghl_connections.followup_mode IS 'auto: send automatically, suggestion: require approval, off: disabled';

-- =====================================================
-- 7. ENABLE RLS
-- =====================================================
ALTER TABLE followup_prompt_versions ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_prompt_performance ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_training_data ENABLE ROW LEVEL SECURITY;
ALTER TABLE followup_pattern_analysis ENABLE ROW LEVEL SECURITY;

-- Allow all operations (SimpliOS admin access via service role)
CREATE POLICY "Allow all on followup_prompt_versions" ON followup_prompt_versions FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on followup_prompt_performance" ON followup_prompt_performance FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on followup_approvals" ON followup_approvals FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on followup_training_data" ON followup_training_data FOR ALL USING (true) WITH CHECK (true);
CREATE POLICY "Allow all on followup_pattern_analysis" ON followup_pattern_analysis FOR ALL USING (true) WITH CHECK (true);

-- =====================================================
-- 8. UPDATE TRIGGERS
-- =====================================================
CREATE OR REPLACE FUNCTION update_followup_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_followup_prompt_versions_updated
  BEFORE UPDATE ON followup_prompt_versions
  FOR EACH ROW EXECUTE FUNCTION update_followup_updated_at();

CREATE TRIGGER trigger_followup_approvals_updated
  BEFORE UPDATE ON followup_approvals
  FOR EACH ROW EXECUTE FUNCTION update_followup_updated_at();

-- =====================================================
-- 9. INSERT INITIAL PROMPT VERSION
-- =====================================================
INSERT INTO followup_prompt_versions (
  version_number,
  is_active,
  category,
  prompt_template,
  change_description,
  created_by,
  activated_at
) VALUES (
  1,
  true,
  'standard_followup',
  'Du bist ein freundlicher Immobilien-Assistent. Analysiere die Konversation und erstelle eine passende Follow-up Nachricht.

Beachte:
- Sei freundlich aber professionell
- Beziehe dich auf den Kontext der bisherigen Unterhaltung
- Frage nach dem aktuellen Stand oder biete Hilfe an
- Halte die Nachricht kurz (max 2-3 Sätze)

Konversation:
{conversation}

Erstelle eine Follow-up Nachricht:',
  'Initiale Version',
  'system',
  NOW()
) ON CONFLICT DO NOTHING;

-- =====================================================
-- 11. ENSURE ALL EXISTING CONNECTIONS USE SUGGESTION MODE
-- (Safety: No automatic follow-ups without explicit opt-in)
-- =====================================================
UPDATE ghl_connections
SET followup_mode = 'suggestion'
WHERE followup_mode IS NULL OR followup_mode = 'auto';

-- =====================================================
-- 10. COMMENTS
-- =====================================================
COMMENT ON TABLE followup_prompt_versions IS 'Versioned prompts for follow-up generation with A/B testing support';
COMMENT ON TABLE followup_prompt_performance IS 'Daily performance metrics per prompt version';
COMMENT ON TABLE followup_approvals IS 'Pending follow-ups waiting for admin approval';
COMMENT ON TABLE followup_training_data IS 'Training data collected from approvals/rejections';
COMMENT ON TABLE followup_pattern_analysis IS 'Daily AI pattern analysis for prompt improvement';
