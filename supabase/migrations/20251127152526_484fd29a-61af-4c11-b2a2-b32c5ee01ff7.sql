-- Add Scalping Mode settings columns
ALTER TABLE settings ADD COLUMN IF NOT EXISTS max_margin_per_trade numeric DEFAULT 2;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS max_loss_per_trade numeric DEFAULT 1;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS sl_percent_min numeric DEFAULT 0.3;
ALTER TABLE settings ADD COLUMN IF NOT EXISTS sl_percent_max numeric DEFAULT 2.0;

ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS max_margin_per_trade numeric DEFAULT 2;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS max_loss_per_trade numeric DEFAULT 1;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS sl_percent_min numeric DEFAULT 0.3;
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS sl_percent_max numeric DEFAULT 2.0;