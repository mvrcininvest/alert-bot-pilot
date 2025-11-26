-- Add columns for intelligent duplicate alert handling
ALTER TABLE settings ADD COLUMN IF NOT EXISTS duplicate_alert_handling boolean DEFAULT true;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS alert_strength_threshold numeric DEFAULT 0.20;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS require_profit_for_same_direction boolean DEFAULT true;

COMMENT ON COLUMN settings.duplicate_alert_handling IS 'Enable intelligent handling of duplicate alerts on the same symbol';
COMMENT ON COLUMN settings.alert_strength_threshold IS 'Minimum strength difference (0-1) to consider new alert stronger, default 0.20 = 20 points';
COMMENT ON COLUMN settings.require_profit_for_same_direction IS 'For same direction, require position to be in profit before replacing with stronger signal';