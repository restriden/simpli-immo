-- Add category column to followup_prompt_versions if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'followup_prompt_versions' AND column_name = 'category'
  ) THEN
    ALTER TABLE followup_prompt_versions
    ADD COLUMN category TEXT NOT NULL DEFAULT 'standard_followup';
  END IF;
END $$;

-- Update the unique index to be per category
DROP INDEX IF EXISTS idx_followup_prompt_active;
CREATE UNIQUE INDEX IF NOT EXISTS idx_followup_prompt_active_per_category
ON followup_prompt_versions(category, is_active) WHERE is_active = true;

-- Index for finding active version by category
CREATE INDEX IF NOT EXISTS idx_followup_prompt_category ON followup_prompt_versions(category);

-- Update existing prompt version to have category
UPDATE followup_prompt_versions SET category = 'standard_followup' WHERE category IS NULL;

-- Ensure all existing connections use suggestion mode (not auto)
UPDATE ghl_connections
SET followup_mode = 'suggestion'
WHERE followup_mode IS NULL OR followup_mode = 'auto';
