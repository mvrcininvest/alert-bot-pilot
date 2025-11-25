
-- Settings table is global bot configuration, not user-specific
-- Allow public access since this is a single-user trading bot

DROP POLICY IF EXISTS "Allow all for authenticated users" ON settings;

CREATE POLICY "Allow public access to settings"
  ON settings
  FOR ALL
  TO anon, authenticated
  USING (true)
  WITH CHECK (true);
