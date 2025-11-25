
-- Add new settings fields for improved filtering and risk management

-- Change from min_strength to tier exclusion
ALTER TABLE settings 
  DROP COLUMN IF EXISTS min_strength,
  ADD COLUMN IF NOT EXISTS excluded_tiers text[] DEFAULT ARRAY[]::text[];

-- Add loss limit type and percentage option
ALTER TABLE settings
  ADD COLUMN IF NOT EXISTS loss_limit_type text DEFAULT 'fixed_usdt',
  ADD COLUMN IF NOT EXISTS daily_loss_percent numeric DEFAULT 5.0;

COMMENT ON COLUMN settings.excluded_tiers IS 'List of tiers to exclude from trading (e.g., Basic, Standard)';
COMMENT ON COLUMN settings.loss_limit_type IS 'Type of daily loss limit: fixed_usdt or percent_drawdown';
COMMENT ON COLUMN settings.daily_loss_limit IS 'Daily loss limit in USDT (when loss_limit_type = fixed_usdt)';
COMMENT ON COLUMN settings.daily_loss_percent IS 'Daily loss limit as % of capital (when loss_limit_type = percent_drawdown)';
