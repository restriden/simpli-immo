-- Add financing_mode to objekte table
-- Controls how the AI handles financing requirements for each property

-- Financing modes:
-- simpli_pflicht: Simpli Finance financing required (recommended - you get commission)
-- finanzierung_pflicht: Financing required but external allowed (no commission)
-- keine_pflicht: No financing required before viewing (default)

ALTER TABLE objekte
ADD COLUMN IF NOT EXISTS financing_mode TEXT DEFAULT 'keine_pflicht'
CHECK (financing_mode IN ('simpli_pflicht', 'finanzierung_pflicht', 'keine_pflicht'));

-- Add comment for documentation
COMMENT ON COLUMN objekte.financing_mode IS 'Controls financing requirements: simpli_pflicht (Simpli Finance required), finanzierung_pflicht (any financing ok), keine_pflicht (no financing needed)';

-- Create index for filtering
CREATE INDEX IF NOT EXISTS idx_objekte_financing_mode ON objekte(financing_mode);
