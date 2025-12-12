-- Add indicator_version column to alerts table
ALTER TABLE alerts ADD COLUMN indicator_version text DEFAULT NULL;

-- Migrate existing data from raw_data
UPDATE alerts 
SET indicator_version = COALESCE(
  raw_data->>'version', 
  raw_data->>'_indicator_version',
  '9.1'
) 
WHERE indicator_version IS NULL;

-- Add indicator_version_filter column to user_settings table
-- NULL = accept all versions
-- ['9.1'] = accept ONLY v9.1
-- ['9.3'] = accept ONLY v9.3
-- ['9.1', '9.3'] = accept both
ALTER TABLE user_settings 
ADD COLUMN indicator_version_filter text[] DEFAULT NULL;