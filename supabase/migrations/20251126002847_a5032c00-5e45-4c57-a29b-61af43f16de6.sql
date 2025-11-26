-- Change PnL threshold from USDT to percentage
ALTER TABLE settings DROP COLUMN IF EXISTS pnl_threshold_usdt;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS pnl_threshold_percent numeric DEFAULT 0.5;

COMMENT ON COLUMN settings.pnl_threshold_percent IS 'Minimum PnL percentage (of position notional value) to consider position in profit/loss. Below this threshold position is treated as break-even. Default 0.5%';