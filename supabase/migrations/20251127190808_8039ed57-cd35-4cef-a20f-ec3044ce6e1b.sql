-- Add use_max_leverage_global to settings table
ALTER TABLE settings ADD COLUMN IF NOT EXISTS use_max_leverage_global BOOLEAN DEFAULT false;

-- Add use_max_leverage_global to user_settings table
ALTER TABLE user_settings ADD COLUMN IF NOT EXISTS use_max_leverage_global BOOLEAN DEFAULT false;