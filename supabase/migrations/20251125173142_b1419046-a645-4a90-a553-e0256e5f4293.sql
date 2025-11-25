-- Add custom leverage configuration to settings table
-- Allows setting default leverage and per-symbol overrides

ALTER TABLE settings
ADD COLUMN default_leverage integer DEFAULT 10,
ADD COLUMN symbol_leverage_overrides jsonb DEFAULT '{}'::jsonb;

COMMENT ON COLUMN settings.default_leverage IS 'Default leverage for all positions';
COMMENT ON COLUMN settings.symbol_leverage_overrides IS 'JSON object with symbol-specific leverage overrides, e.g. {"BTCUSDT": 20, "ETHUSDT": 15}';

-- Update existing rows
UPDATE settings
SET 
  default_leverage = 10,
  symbol_leverage_overrides = '{}'::jsonb
WHERE default_leverage IS NULL;