-- Add category_settings JSONB column to settings table (admin global settings)
ALTER TABLE public.settings 
ADD COLUMN IF NOT EXISTS category_settings JSONB DEFAULT '{
  "BTC_ETH": {
    "max_leverage": 150,
    "max_margin": 1.0,
    "max_loss": 0.30,
    "tp_levels": 1,
    "tp1_rr": 1.0,
    "tp2_rr": 1.5,
    "tp3_rr": 2.0,
    "tp1_close_pct": 100,
    "tp2_close_pct": 0,
    "tp3_close_pct": 0
  },
  "MAJOR": {
    "max_leverage": 100,
    "max_margin": 0.9,
    "max_loss": 0.25,
    "tp_levels": 1,
    "tp1_rr": 1.2,
    "tp2_rr": 1.8,
    "tp3_rr": 2.4,
    "tp1_close_pct": 100,
    "tp2_close_pct": 0,
    "tp3_close_pct": 0
  },
  "ALTCOIN": {
    "max_leverage": 75,
    "max_margin": 0.8,
    "max_loss": 0.25,
    "tp_levels": 1,
    "tp1_rr": 1.5,
    "tp2_rr": 2.25,
    "tp3_rr": 3.0,
    "tp1_close_pct": 100,
    "tp2_close_pct": 0,
    "tp3_close_pct": 0
  }
}'::jsonb;

-- Add category_settings JSONB column to user_settings table (per-user override settings)
ALTER TABLE public.user_settings 
ADD COLUMN IF NOT EXISTS category_settings JSONB DEFAULT '{
  "BTC_ETH": {
    "max_leverage": 150,
    "max_margin": 1.0,
    "max_loss": 0.30,
    "tp_levels": 1,
    "tp1_rr": 1.0,
    "tp2_rr": 1.5,
    "tp3_rr": 2.0,
    "tp1_close_pct": 100,
    "tp2_close_pct": 0,
    "tp3_close_pct": 0
  },
  "MAJOR": {
    "max_leverage": 100,
    "max_margin": 0.9,
    "max_loss": 0.25,
    "tp_levels": 1,
    "tp1_rr": 1.2,
    "tp2_rr": 1.8,
    "tp3_rr": 2.4,
    "tp1_close_pct": 100,
    "tp2_close_pct": 0,
    "tp3_close_pct": 0
  },
  "ALTCOIN": {
    "max_leverage": 75,
    "max_margin": 0.8,
    "max_loss": 0.25,
    "tp_levels": 1,
    "tp1_rr": 1.5,
    "tp2_rr": 2.25,
    "tp3_rr": 3.0,
    "tp1_close_pct": 100,
    "tp2_close_pct": 0,
    "tp3_close_pct": 0
  }
}'::jsonb;