-- Add PnL threshold setting for duplicate alert handling
ALTER TABLE settings ADD COLUMN IF NOT EXISTS pnl_threshold_usdt numeric DEFAULT 1.0;

COMMENT ON COLUMN settings.pnl_threshold_usdt IS 'Minimum PnL (in USDT) to consider position in profit/loss. Below this threshold position is treated as break-even.';