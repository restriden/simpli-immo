-- Disable RLS on lead_conversation_analysis table
-- The table is only accessed via service_role from Edge Functions and tRPC backend
ALTER TABLE lead_conversation_analysis DISABLE ROW LEVEL SECURITY;
ALTER TABLE analysis_jobs DISABLE ROW LEVEL SECURITY;
ALTER TABLE system_settings DISABLE ROW LEVEL SECURITY;
