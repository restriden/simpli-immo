-- EVA Performance: Conversation Analysis System
-- Analyzes all WhatsApp conversations in Makler accounts for conversion optimization

-- Table for storing AI conversation analysis results
CREATE TABLE IF NOT EXISTS lead_conversation_analysis (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,
  location_id TEXT NOT NULL,

  -- Conversation Metrics
  total_messages INT DEFAULT 0,
  incoming_messages INT DEFAULT 0,
  outgoing_messages INT DEFAULT 0,
  first_message_at TIMESTAMPTZ,
  last_message_at TIMESTAMPTZ,
  avg_response_time_minutes FLOAT,

  -- AI Classification Results
  lead_temperature TEXT CHECK (lead_temperature IN ('hot', 'warm', 'cold', 'dead')),
  temperature_score INT CHECK (temperature_score BETWEEN 1 AND 10),

  -- Conversation Outcome
  conversation_outcome TEXT CHECK (conversation_outcome IN (
    'termin_gebucht',
    'termin_abgesagt',
    'no_show',
    'interessiert_nicht_gebucht',
    'kein_interesse',
    'nicht_erreicht',
    'unterhaltung_laeuft',
    'abgebrochen',
    'nicht_qualifiziert',
    'eigene_finanzierung',
    'sonstiges'
  )),

  -- Conversion Blocker Analysis
  primary_blocker TEXT CHECK (primary_blocker IN (
    'keine_antwort',
    'kein_interesse_finanzierung',
    'hat_eigene_bank',
    'zeitpunkt_passt_nicht',
    'vertrauen_fehlt',
    'preis_zu_hoch',
    'objekt_unklar',
    'pitch_zu_schwach',
    'pitch_zu_aggressiv',
    'falsche_zielgruppe',
    'technisch',
    'unbekannt',
    'kein_blocker'
  )),

  -- SF Pitch Quality
  pitch_quality TEXT CHECK (pitch_quality IN ('excellent', 'good', 'average', 'poor', 'no_pitch')),
  pitch_quality_score INT CHECK (pitch_quality_score BETWEEN 1 AND 10),
  pitch_feedback TEXT,

  -- Lead Intent Signals
  has_financing_need BOOLEAN DEFAULT FALSE,
  has_concrete_object BOOLEAN DEFAULT FALSE,
  mentioned_budget BOOLEAN DEFAULT FALSE,
  mentioned_timeline BOOLEAN DEFAULT FALSE,
  expressed_interest_sf BOOLEAN DEFAULT FALSE,
  asked_questions BOOLEAN DEFAULT FALSE,

  -- AI Summary
  conversation_summary TEXT,
  key_insights TEXT,
  improvement_suggestion TEXT,

  -- SF Pipeline Status (from enrichment)
  sf_pipeline_stage TEXT,
  sf_tags TEXT[],

  -- Tracking
  analyzed_at TIMESTAMPTZ DEFAULT NOW(),
  messages_analyzed_count INT DEFAULT 0,
  last_message_analyzed_at TIMESTAMPTZ,
  analysis_version INT DEFAULT 1,

  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_lca_lead_id ON lead_conversation_analysis(lead_id);
CREATE INDEX IF NOT EXISTS idx_lca_location_id ON lead_conversation_analysis(location_id);
CREATE INDEX IF NOT EXISTS idx_lca_temperature ON lead_conversation_analysis(lead_temperature);
CREATE INDEX IF NOT EXISTS idx_lca_outcome ON lead_conversation_analysis(conversation_outcome);
CREATE INDEX IF NOT EXISTS idx_lca_blocker ON lead_conversation_analysis(primary_blocker);
CREATE UNIQUE INDEX IF NOT EXISTS idx_lca_lead_unique ON lead_conversation_analysis(lead_id);
CREATE INDEX IF NOT EXISTS idx_lca_analyzed_at ON lead_conversation_analysis(analyzed_at);

-- Comments
COMMENT ON TABLE lead_conversation_analysis IS 'AI-powered analysis of WhatsApp conversations for EVA Performance dashboard';
COMMENT ON COLUMN lead_conversation_analysis.lead_temperature IS 'hot/warm/cold/dead based on conversation analysis';
COMMENT ON COLUMN lead_conversation_analysis.temperature_score IS '1-10 score (1=cold, 10=very hot)';
COMMENT ON COLUMN lead_conversation_analysis.primary_blocker IS 'Main reason why lead did not book at Simpli Finance';
COMMENT ON COLUMN lead_conversation_analysis.pitch_quality IS 'How well EVA pitched the Simpli Finance service';
COMMENT ON COLUMN lead_conversation_analysis.last_message_analyzed_at IS 'Timestamp of last message included in analysis - used for incremental re-analysis';

-- System settings table for storing configurable settings like the analysis prompt
CREATE TABLE IF NOT EXISTS system_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by TEXT
);

COMMENT ON TABLE system_settings IS 'Key-value store for system configuration like AI prompts';

-- RLS Policies
ALTER TABLE lead_conversation_analysis ENABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to read analysis data
CREATE POLICY "Allow authenticated read on lead_conversation_analysis"
  ON lead_conversation_analysis
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role full access on lead_conversation_analysis
CREATE POLICY "Allow service role full access on lead_conversation_analysis"
  ON lead_conversation_analysis
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);

-- Allow authenticated users to read system settings
CREATE POLICY "Allow authenticated read on system_settings"
  ON system_settings
  FOR SELECT
  TO authenticated
  USING (true);

-- Allow service role full access on system settings
CREATE POLICY "Allow service role full access on system_settings"
  ON system_settings
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
