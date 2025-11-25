-- Disable RLS on positions table for public access (trading bot use case)
ALTER TABLE positions DISABLE ROW LEVEL SECURITY;

-- Disable RLS on alerts table for public access
ALTER TABLE alerts DISABLE ROW LEVEL SECURITY;

-- Disable RLS on bot_logs table  
ALTER TABLE bot_logs DISABLE ROW LEVEL SECURITY;

-- Disable RLS on monitoring_logs table
ALTER TABLE monitoring_logs DISABLE ROW LEVEL SECURITY;