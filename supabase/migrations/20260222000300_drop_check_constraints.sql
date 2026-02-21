-- Drop all CHECK constraints on lead_conversation_analysis
-- The AI returns varied values that don't always match strict enums.
-- Validation is done in application code instead.

ALTER TABLE lead_conversation_analysis
  DROP CONSTRAINT IF EXISTS lead_conversation_analysis_lead_temperature_check,
  DROP CONSTRAINT IF EXISTS lead_conversation_analysis_temperature_score_check,
  DROP CONSTRAINT IF EXISTS lead_conversation_analysis_conversation_outcome_check,
  DROP CONSTRAINT IF EXISTS lead_conversation_analysis_primary_blocker_check,
  DROP CONSTRAINT IF EXISTS lead_conversation_analysis_pitch_quality_check,
  DROP CONSTRAINT IF EXISTS lead_conversation_analysis_pitch_quality_score_check,
  DROP CONSTRAINT IF EXISTS lead_conversation_analysis_immobilien_interesse_check,
  DROP CONSTRAINT IF EXISTS lead_conversation_analysis_lead_typ_check,
  DROP CONSTRAINT IF EXISTS lead_conversation_analysis_antwort_verhalten_check,
  DROP CONSTRAINT IF EXISTS lead_conversation_analysis_engagement_score_check,
  DROP CONSTRAINT IF EXISTS lead_conversation_analysis_ton_analyse_check;
