-- Enable Realtime for messages table
-- This allows the app to receive instant updates when new messages arrive

-- Enable realtime for the messages table
ALTER PUBLICATION supabase_realtime ADD TABLE messages;

-- Enable realtime for leads table (for status updates)
ALTER PUBLICATION supabase_realtime ADD TABLE leads;

-- Note: You may need to run this manually in Supabase SQL Editor if the migration fails
-- Alternatively, enable Realtime via Dashboard: Database > Replication > Add Table
