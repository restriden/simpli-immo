-- Add ghl_task_id column to todos table for GHL task sync
ALTER TABLE todos ADD COLUMN IF NOT EXISTS ghl_task_id TEXT;

-- Add ghl_data column if not exists
ALTER TABLE todos ADD COLUMN IF NOT EXISTS ghl_data JSONB;

-- Add index for faster lookups
CREATE INDEX IF NOT EXISTS idx_todos_ghl_task_id ON todos(ghl_task_id);

-- Enable Realtime for todos table
ALTER PUBLICATION supabase_realtime ADD TABLE todos;
