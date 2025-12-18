-- Fix GHL unique constraints for upsert operations
-- Run this migration in Supabase SQL Editor

-- 1. Add UNIQUE constraint on ghl_contact_id in leads table
-- First check if constraint exists, if not create it
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'leads_ghl_contact_id_key'
  ) THEN
    ALTER TABLE leads ADD CONSTRAINT leads_ghl_contact_id_key UNIQUE (ghl_contact_id);
  END IF;
END $$;

-- 2. Add UNIQUE constraint on ghl_message_id in messages table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'messages_ghl_message_id_key'
  ) THEN
    ALTER TABLE messages ADD CONSTRAINT messages_ghl_message_id_key UNIQUE (ghl_message_id);
  END IF;
END $$;

-- 3. Add UNIQUE constraint on ghl_event_id in todos table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'todos_ghl_event_id_key'
  ) THEN
    ALTER TABLE todos ADD CONSTRAINT todos_ghl_event_id_key UNIQUE (ghl_event_id);
  END IF;
END $$;

-- Verify constraints were created
SELECT
  conname as constraint_name,
  conrelid::regclass as table_name
FROM pg_constraint
WHERE conname IN ('leads_ghl_contact_id_key', 'messages_ghl_message_id_key', 'todos_ghl_event_id_key');
