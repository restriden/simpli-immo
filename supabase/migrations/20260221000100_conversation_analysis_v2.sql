-- EVA Performance v2: Property Interest & Lead Scoring columns
-- Adds fields for multi-step conversation analysis

-- New columns for property interest assessment
ALTER TABLE lead_conversation_analysis
  ADD COLUMN IF NOT EXISTS immobilien_interesse TEXT
    CHECK (immobilien_interesse IN ('stark', 'mittel', 'gering', 'kein', 'unklar')),
  ADD COLUMN IF NOT EXISTS interesse_verlust_grund TEXT,
  ADD COLUMN IF NOT EXISTS abbruch_punkt TEXT,
  ADD COLUMN IF NOT EXISTS lead_typ TEXT
    CHECK (lead_typ IN ('kaufinteressent', 'besichtigungstourist', 'mieter', 'investor', 'unklar')),
  ADD COLUMN IF NOT EXISTS antwort_verhalten TEXT
    CHECK (antwort_verhalten IN ('sehr_schnell', 'schnell', 'normal', 'langsam', 'keine_antwort')),
  ADD COLUMN IF NOT EXISTS engagement_score INT CHECK (engagement_score BETWEEN 1 AND 10),
  ADD COLUMN IF NOT EXISTS ton_analyse TEXT
    CHECK (ton_analyse IN ('begeistert', 'freundlich', 'neutral', 'skeptisch', 'ablehnend', 'unklar'));

-- Indexes on new fields
CREATE INDEX IF NOT EXISTS idx_lca_immobilien_interesse ON lead_conversation_analysis(immobilien_interesse);
CREATE INDEX IF NOT EXISTS idx_lca_lead_typ ON lead_conversation_analysis(lead_typ);
CREATE INDEX IF NOT EXISTS idx_lca_engagement_score ON lead_conversation_analysis(engagement_score);
