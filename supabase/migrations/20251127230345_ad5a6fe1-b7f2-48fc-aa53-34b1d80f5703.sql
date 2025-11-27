-- ===================================
-- PART B: SYNCHRONIZATION FIXES
-- ===================================

-- B1: Create UNIQUE INDEX on positions to prevent duplicates
CREATE UNIQUE INDEX IF NOT EXISTS idx_positions_unique_open 
ON positions (user_id, symbol, side) 
WHERE status = 'open';

-- B2: Create dedicated monitor_locks table for atomic locking
CREATE TABLE IF NOT EXISTS monitor_locks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lock_type text NOT NULL UNIQUE,
  acquired_at timestamptz DEFAULT now(),
  expires_at timestamptz DEFAULT (now() + interval '2 minutes'),
  instance_id text NOT NULL
);

-- Enable RLS on monitor_locks (allow all for service role)
ALTER TABLE monitor_locks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Allow all operations on monitor_locks" ON monitor_locks
FOR ALL USING (true) WITH CHECK (true);