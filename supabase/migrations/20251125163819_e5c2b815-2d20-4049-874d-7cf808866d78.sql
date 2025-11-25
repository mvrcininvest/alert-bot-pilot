-- Trading Bot Database Schema

-- Enum for position status
CREATE TYPE position_status AS ENUM ('open', 'closed', 'error');

-- Enum for position side
CREATE TYPE position_side AS ENUM ('BUY', 'SELL');

-- Enum for alert status
CREATE TYPE alert_status AS ENUM ('pending', 'executed', 'ignored', 'error');

-- Enum for SL/TP calculator type
CREATE TYPE calculator_type AS ENUM ('simple_percent', 'risk_reward', 'atr_based');

-- Enum for SL method
CREATE TYPE sl_method AS ENUM ('percent_margin', 'percent_entry', 'fixed_usdt', 'atr_based');

-- Enum for TP strategy
CREATE TYPE tp_strategy AS ENUM ('partial_close', 'main_tp_only', 'trailing_stop');

-- Table: alerts - stores all incoming TradingView alerts
CREATE TABLE alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  symbol TEXT NOT NULL,
  side position_side NOT NULL,
  entry_price NUMERIC(20, 8) NOT NULL,
  sl NUMERIC(20, 8) NOT NULL,
  tp1 NUMERIC(20, 8),
  tp2 NUMERIC(20, 8),
  tp3 NUMERIC(20, 8),
  main_tp NUMERIC(20, 8) NOT NULL,
  atr NUMERIC(20, 8),
  leverage INTEGER NOT NULL,
  strength NUMERIC(5, 3),
  tier TEXT,
  mode TEXT,
  status alert_status NOT NULL DEFAULT 'pending',
  raw_data JSONB NOT NULL,
  error_message TEXT,
  executed_at TIMESTAMPTZ,
  position_id UUID
);

-- Table: positions - stores all trading positions
CREATE TABLE positions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  alert_id UUID REFERENCES alerts(id),
  bitget_order_id TEXT UNIQUE,
  symbol TEXT NOT NULL,
  side position_side NOT NULL,
  entry_price NUMERIC(20, 8) NOT NULL,
  quantity NUMERIC(20, 8) NOT NULL,
  leverage INTEGER NOT NULL,
  
  -- Stop Loss
  sl_price NUMERIC(20, 8) NOT NULL,
  sl_order_id TEXT,
  
  -- Take Profits
  tp1_price NUMERIC(20, 8),
  tp1_quantity NUMERIC(20, 8),
  tp1_order_id TEXT,
  tp1_filled BOOLEAN DEFAULT false,
  
  tp2_price NUMERIC(20, 8),
  tp2_quantity NUMERIC(20, 8),
  tp2_order_id TEXT,
  tp2_filled BOOLEAN DEFAULT false,
  
  tp3_price NUMERIC(20, 8),
  tp3_quantity NUMERIC(20, 8),
  tp3_order_id TEXT,
  tp3_filled BOOLEAN DEFAULT false,
  
  -- Position status
  status position_status NOT NULL DEFAULT 'open',
  current_price NUMERIC(20, 8),
  unrealized_pnl NUMERIC(20, 8),
  realized_pnl NUMERIC(20, 8),
  
  -- Close information
  close_price NUMERIC(20, 8),
  close_reason TEXT,
  closed_at TIMESTAMPTZ,
  
  -- Monitoring
  last_check_at TIMESTAMPTZ,
  check_errors INTEGER DEFAULT 0,
  last_error TEXT,
  
  -- Metadata
  metadata JSONB
);

-- Table: settings - bot configuration
CREATE TABLE settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  
  -- Bot Control
  bot_active BOOLEAN DEFAULT true,
  
  -- Position Sizing
  position_sizing_type TEXT NOT NULL DEFAULT 'fixed_usdt', -- 'fixed_usdt' or 'percent_capital'
  position_size_value NUMERIC(20, 8) NOT NULL DEFAULT 100,
  
  -- SL/TP Calculator
  calculator_type calculator_type NOT NULL DEFAULT 'simple_percent',
  
  -- Simple Percent Settings
  simple_sl_percent NUMERIC(5, 2) DEFAULT 1.5,
  simple_tp_percent NUMERIC(5, 2) DEFAULT 3.0,
  
  -- Risk:Reward Settings
  rr_sl_percent_margin NUMERIC(5, 2) DEFAULT 2.0,
  rr_ratio NUMERIC(5, 2) DEFAULT 2.0,
  rr_adaptive BOOLEAN DEFAULT false,
  
  -- ATR Settings
  atr_sl_multiplier NUMERIC(5, 2) DEFAULT 2.0,
  atr_tp_multiplier NUMERIC(5, 2) DEFAULT 3.0,
  
  -- SL Management
  sl_method sl_method NOT NULL DEFAULT 'percent_entry',
  sl_to_breakeven BOOLEAN DEFAULT true,
  breakeven_trigger_tp INTEGER DEFAULT 1, -- Move to BE after TP1
  trailing_stop BOOLEAN DEFAULT false,
  trailing_stop_trigger_tp INTEGER DEFAULT 1,
  trailing_stop_distance NUMERIC(5, 2) DEFAULT 1.0,
  
  -- TP Management
  tp_strategy tp_strategy NOT NULL DEFAULT 'partial_close',
  tp_levels INTEGER DEFAULT 1,
  tp1_close_percent NUMERIC(5, 2) DEFAULT 100,
  tp2_close_percent NUMERIC(5, 2) DEFAULT 0,
  tp3_close_percent NUMERIC(5, 2) DEFAULT 0,
  tp1_rr_ratio NUMERIC(5, 2) DEFAULT 1.5,
  tp2_rr_ratio NUMERIC(5, 2) DEFAULT 2.5,
  tp3_rr_ratio NUMERIC(5, 2) DEFAULT 3.5,
  
  -- Adaptive Systems
  adaptive_tp_spacing BOOLEAN DEFAULT false,
  adaptive_tp_high_volatility_multiplier NUMERIC(5, 2) DEFAULT 1.3,
  adaptive_tp_low_volatility_multiplier NUMERIC(5, 2) DEFAULT 0.9,
  
  momentum_based_tp BOOLEAN DEFAULT false,
  momentum_weak_multiplier NUMERIC(5, 2) DEFAULT 0.9,
  momentum_moderate_multiplier NUMERIC(5, 2) DEFAULT 1.1,
  momentum_strong_multiplier NUMERIC(5, 2) DEFAULT 1.3,
  
  adaptive_rr BOOLEAN DEFAULT false,
  adaptive_rr_weak_signal NUMERIC(5, 2) DEFAULT 0.8,
  adaptive_rr_standard NUMERIC(5, 2) DEFAULT 1.0,
  adaptive_rr_strong NUMERIC(5, 2) DEFAULT 1.2,
  adaptive_rr_very_strong NUMERIC(5, 2) DEFAULT 1.5,
  
  -- Risk Management
  max_open_positions INTEGER DEFAULT 3,
  daily_loss_limit NUMERIC(20, 8) DEFAULT 500,
  
  -- Filters
  filter_by_tier BOOLEAN DEFAULT false,
  allowed_tiers TEXT[] DEFAULT ARRAY['Premium'],
  min_strength NUMERIC(5, 3) DEFAULT 0.3,
  
  -- Monitoring
  monitor_interval_seconds INTEGER DEFAULT 60,
  auto_repair BOOLEAN DEFAULT true,
  
  -- Profile
  profile_name TEXT DEFAULT 'Default'
);

-- Insert default settings
INSERT INTO settings (profile_name) VALUES ('Default');

-- Table: performance_metrics - aggregated statistics
CREATE TABLE performance_metrics (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  date DATE NOT NULL,
  
  -- Daily stats
  total_trades INTEGER DEFAULT 0,
  winning_trades INTEGER DEFAULT 0,
  losing_trades INTEGER DEFAULT 0,
  total_pnl NUMERIC(20, 8) DEFAULT 0,
  total_fees NUMERIC(20, 8) DEFAULT 0,
  
  -- Per pair
  symbol TEXT,
  
  UNIQUE(date, symbol)
);

-- Table: monitoring_logs - position monitoring history
CREATE TABLE monitoring_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  position_id UUID REFERENCES positions(id) ON DELETE CASCADE,
  
  check_type TEXT NOT NULL, -- 'routine', 'error_detected', 'repair_attempted'
  status TEXT NOT NULL, -- 'ok', 'mismatch', 'repaired', 'failed'
  
  -- What was checked
  expected_data JSONB,
  actual_data JSONB,
  
  -- Issues found
  issues JSONB,
  
  -- Actions taken
  actions_taken TEXT,
  error_message TEXT
);

-- Enable Row Level Security
ALTER TABLE alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE performance_metrics ENABLE ROW LEVEL SECURITY;
ALTER TABLE monitoring_logs ENABLE ROW LEVEL SECURITY;

-- RLS Policies - All tables accessible to all authenticated users
-- (single-user bot, but keeping RLS for security)

CREATE POLICY "Allow all for authenticated users" ON alerts
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON positions
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON settings
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON performance_metrics
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

CREATE POLICY "Allow all for authenticated users" ON monitoring_logs
  FOR ALL TO authenticated USING (true) WITH CHECK (true);

-- Indexes for performance
CREATE INDEX idx_alerts_created_at ON alerts(created_at DESC);
CREATE INDEX idx_alerts_status ON alerts(status);
CREATE INDEX idx_alerts_symbol ON alerts(symbol);

CREATE INDEX idx_positions_status ON positions(status);
CREATE INDEX idx_positions_symbol ON positions(symbol);
CREATE INDEX idx_positions_created_at ON positions(created_at DESC);

CREATE INDEX idx_performance_date ON performance_metrics(date DESC);
CREATE INDEX idx_performance_symbol ON performance_metrics(symbol);

-- Trigger to update updated_at
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_positions_updated_at
  BEFORE UPDATE ON positions
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settings_updated_at
  BEFORE UPDATE ON settings
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- Enable realtime for live dashboard updates
ALTER PUBLICATION supabase_realtime ADD TABLE positions;
ALTER PUBLICATION supabase_realtime ADD TABLE alerts;