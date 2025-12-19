-- Admin Whitelist for approved subaccounts
-- Only subaccounts in this list can connect to the app

CREATE TABLE IF NOT EXISTS approved_subaccounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  location_id TEXT NOT NULL UNIQUE,
  location_name TEXT,
  company_name TEXT,
  contact_email TEXT,
  notes TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  max_users INTEGER DEFAULT 5,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  approved_by UUID REFERENCES auth.users(id),
  expires_at TIMESTAMPTZ
);

-- Index for fast lookup during OAuth
CREATE INDEX idx_approved_subaccounts_location_id ON approved_subaccounts(location_id);
CREATE INDEX idx_approved_subaccounts_active ON approved_subaccounts(is_active) WHERE is_active = TRUE;

-- Admin users table (who can access admin dashboard)
CREATE TABLE IF NOT EXISTS admin_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) NOT NULL UNIQUE,
  role TEXT DEFAULT 'admin' CHECK (role IN ('admin', 'super_admin')),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by UUID REFERENCES auth.users(id)
);

-- RLS Policies
ALTER TABLE approved_subaccounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE admin_users ENABLE ROW LEVEL SECURITY;

-- Only admins can view/modify approved_subaccounts
CREATE POLICY "Admins can view approved_subaccounts"
  ON approved_subaccounts FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can insert approved_subaccounts"
  ON approved_subaccounts FOR INSERT
  WITH CHECK (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can update approved_subaccounts"
  ON approved_subaccounts FOR UPDATE
  USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Admins can delete approved_subaccounts"
  ON approved_subaccounts FOR DELETE
  USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND role = 'super_admin')
  );

-- Admin users policies
CREATE POLICY "Admins can view admin_users"
  ON admin_users FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid())
  );

CREATE POLICY "Super admins can manage admin_users"
  ON admin_users FOR ALL
  USING (
    EXISTS (SELECT 1 FROM admin_users WHERE user_id = auth.uid() AND role = 'super_admin')
  );

-- Function to check if location is approved
CREATE OR REPLACE FUNCTION is_location_approved(p_location_id TEXT)
RETURNS BOOLEAN AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM approved_subaccounts
    WHERE location_id = p_location_id
    AND is_active = TRUE
    AND (expires_at IS NULL OR expires_at > NOW())
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Grant execute to service role
GRANT EXECUTE ON FUNCTION is_location_approved TO service_role;
