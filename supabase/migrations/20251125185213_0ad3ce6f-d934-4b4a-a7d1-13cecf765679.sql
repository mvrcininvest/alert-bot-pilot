-- Remove RLS policies since RLS is disabled for trading bot use case
DROP POLICY IF EXISTS "Allow all for authenticated users" ON positions;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON alerts;
DROP POLICY IF EXISTS "Allow read access to bot_logs" ON bot_logs;
DROP POLICY IF EXISTS "Allow all for authenticated users" ON monitoring_logs;
DROP POLICY IF EXISTS "Allow public access to settings" ON settings;