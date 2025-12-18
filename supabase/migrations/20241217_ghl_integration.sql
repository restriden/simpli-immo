-- GHL Integration Tables for Simpli.Immo
-- Run this migration in Supabase SQL Editor

-- ============================================
-- 1. GHL Whitelist Table
-- ============================================
-- Only whitelisted GHL locations can connect to Simpli.Immo

CREATE TABLE IF NOT EXISTS ghl_whitelist (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  location_id TEXT UNIQUE NOT NULL,
  location_name TEXT,
  company_name TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fast lookups
CREATE INDEX IF NOT EXISTS idx_ghl_whitelist_location_id ON ghl_whitelist(location_id);
CREATE INDEX IF NOT EXISTS idx_ghl_whitelist_active ON ghl_whitelist(is_active);

-- ============================================
-- 2. GHL Connections Table
-- ============================================
-- Stores OAuth tokens and connection info per user

CREATE TABLE IF NOT EXISTS ghl_connections (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE UNIQUE NOT NULL,
  location_id TEXT NOT NULL,
  company_id TEXT,
  ghl_user_id TEXT,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  token_expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT,
  location_name TEXT,
  location_email TEXT,
  location_timezone TEXT,
  is_active BOOLEAN DEFAULT true,
  last_sync_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_ghl_connections_user_id ON ghl_connections(user_id);
CREATE INDEX IF NOT EXISTS idx_ghl_connections_location_id ON ghl_connections(location_id);
CREATE INDEX IF NOT EXISTS idx_ghl_connections_active ON ghl_connections(is_active);

-- ============================================
-- 3. GHL Sync Logs Table
-- ============================================
-- Tracks sync history for debugging

CREATE TABLE IF NOT EXISTS ghl_sync_logs (
  id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  connection_id UUID REFERENCES ghl_connections(id) ON DELETE CASCADE,
  sync_type TEXT NOT NULL, -- 'full', 'contacts', 'conversations', 'appointments', 'oauth'
  status TEXT NOT NULL, -- 'success', 'error', 'in_progress'
  message TEXT,
  metadata JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for fetching logs by connection
CREATE INDEX IF NOT EXISTS idx_ghl_sync_logs_connection ON ghl_sync_logs(connection_id);
CREATE INDEX IF NOT EXISTS idx_ghl_sync_logs_created ON ghl_sync_logs(created_at DESC);

-- ============================================
-- 4. Add GHL columns to existing tables
-- ============================================

-- Add GHL fields to leads table
ALTER TABLE leads
ADD COLUMN IF NOT EXISTS ghl_contact_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS ghl_location_id TEXT,
ADD COLUMN IF NOT EXISTS ghl_data JSONB;

CREATE INDEX IF NOT EXISTS idx_leads_ghl_contact_id ON leads(ghl_contact_id);

-- Add GHL fields to messages table
ALTER TABLE messages
ADD COLUMN IF NOT EXISTS ghl_message_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS ghl_conversation_id TEXT,
ADD COLUMN IF NOT EXISTS ghl_data JSONB;

CREATE INDEX IF NOT EXISTS idx_messages_ghl_message_id ON messages(ghl_message_id);
CREATE INDEX IF NOT EXISTS idx_messages_ghl_conversation_id ON messages(ghl_conversation_id);

-- Add GHL fields to todos table
ALTER TABLE todos
ADD COLUMN IF NOT EXISTS ghl_event_id TEXT UNIQUE,
ADD COLUMN IF NOT EXISTS ghl_data JSONB;

CREATE INDEX IF NOT EXISTS idx_todos_ghl_event_id ON todos(ghl_event_id);

-- ============================================
-- 5. Row Level Security (RLS)
-- ============================================

-- Enable RLS on new tables
ALTER TABLE ghl_whitelist ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghl_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE ghl_sync_logs ENABLE ROW LEVEL SECURITY;

-- Whitelist: Only service role can manage (admin only)
CREATE POLICY "Service role can manage whitelist" ON ghl_whitelist
  FOR ALL USING (auth.role() = 'service_role');

-- Connections: Users can only see their own connections
CREATE POLICY "Users can view own connections" ON ghl_connections
  FOR SELECT USING (auth.uid() = user_id);

CREATE POLICY "Users can update own connections" ON ghl_connections
  FOR UPDATE USING (auth.uid() = user_id);

-- Service role can manage all connections (for Edge Functions)
CREATE POLICY "Service role can manage connections" ON ghl_connections
  FOR ALL USING (auth.role() = 'service_role');

-- Sync logs: Users can view logs for their connections
CREATE POLICY "Users can view own sync logs" ON ghl_sync_logs
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM ghl_connections
      WHERE ghl_connections.id = ghl_sync_logs.connection_id
      AND ghl_connections.user_id = auth.uid()
    )
  );

-- Service role can manage all logs
CREATE POLICY "Service role can manage sync logs" ON ghl_sync_logs
  FOR ALL USING (auth.role() = 'service_role');

-- ============================================
-- 6. Updated_at Triggers
-- ============================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

-- Trigger for ghl_whitelist
DROP TRIGGER IF EXISTS update_ghl_whitelist_updated_at ON ghl_whitelist;
CREATE TRIGGER update_ghl_whitelist_updated_at
  BEFORE UPDATE ON ghl_whitelist
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Trigger for ghl_connections
DROP TRIGGER IF EXISTS update_ghl_connections_updated_at ON ghl_connections;
CREATE TRIGGER update_ghl_connections_updated_at
  BEFORE UPDATE ON ghl_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ============================================
-- 7. Sample Whitelist Entry (for testing)
-- ============================================
-- Uncomment and modify to add your GHL location to whitelist
-- INSERT INTO ghl_whitelist (location_id, location_name, company_name, notes)
-- VALUES ('your-ghl-location-id', 'Test Location', 'Test Company', 'Initial test entry');

-- ============================================
-- Done!
-- ============================================
-- Remember to set GHL_CLIENT_SECRET in Supabase Edge Function secrets:
-- supabase secrets set GHL_CLIENT_SECRET=your-client-secret
