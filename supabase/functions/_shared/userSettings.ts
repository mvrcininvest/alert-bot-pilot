import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.84.0';

export interface UserSettings {
  // Bot control
  bot_active: boolean;
  
  // Position sizing
  position_sizing_type: string;
  position_size_value: number;
  
  // Calculator settings
  calculator_type: string;
  sl_method: string;
  
  // Simple percent settings
  simple_sl_percent: number | null;
  simple_tp_percent: number | null;
  simple_tp2_percent: number | null;
  simple_tp3_percent: number | null;
  
  // Risk/Reward settings
  rr_ratio: number | null;
  rr_adaptive: boolean | null;
  rr_sl_percent_margin: number | null;
  
  // ATR settings
  atr_sl_multiplier: number | null;
  atr_tp_multiplier: number | null;
  atr_tp2_multiplier: number | null;
  atr_tp3_multiplier: number | null;
  
  // TP Strategy
  tp_strategy: string;
  tp_levels: number | null;
  tp1_close_percent: number | null;
  tp2_close_percent: number | null;
  tp3_close_percent: number | null;
  tp1_rr_ratio: number | null;
  tp2_rr_ratio: number | null;
  tp3_rr_ratio: number | null;
  
  // Advanced TP features
  adaptive_tp_spacing: boolean | null;
  adaptive_tp_high_volatility_multiplier: number | null;
  adaptive_tp_low_volatility_multiplier: number | null;
  momentum_based_tp: boolean | null;
  momentum_weak_multiplier: number | null;
  momentum_moderate_multiplier: number | null;
  momentum_strong_multiplier: number | null;
  
  // Adaptive RR
  adaptive_rr: boolean | null;
  adaptive_rr_weak_signal: number | null;
  adaptive_rr_standard: number | null;
  adaptive_rr_strong: number | null;
  adaptive_rr_very_strong: number | null;
  
  // Trailing & Breakeven
  sl_to_breakeven: boolean | null;
  breakeven_trigger_tp: number | null;
  trailing_stop: boolean | null;
  trailing_stop_trigger_tp: number | null;
  trailing_stop_distance: number | null;
  
  // Risk management
  max_open_positions: number | null;
  daily_loss_limit: number | null;
  daily_loss_percent: number | null;
  loss_limit_type: string | null;
  
  // Leverage
  default_leverage: number | null;
  use_alert_leverage: boolean | null;
  symbol_leverage_overrides: any;
  
  // Filters
  filter_by_tier: boolean | null;
  allowed_tiers: string[] | null;
  excluded_tiers: string[] | null;
  alert_strength_threshold: number | null;
  
  // Alert handling
  duplicate_alert_handling: boolean | null;
  require_profit_for_same_direction: boolean | null;
  pnl_threshold_percent: number | null;
  
  // Modes
  money_mode: string | null;
  sltp_mode: string | null;
  tier_mode: string | null;
}

async function getAdminSettings(supabase: any): Promise<any> {
  const { data, error } = await supabase
    .from('settings')
    .select('*')
    .limit(1)
    .single();
    
  if (error) throw error;
  return data;
}

export async function getUserSettings(userId: string): Promise<UserSettings> {
  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseServiceKey) {
    throw new Error('Missing Supabase configuration');
  }

  const supabase = createClient(supabaseUrl, supabaseServiceKey);

  // Fetch user settings
  const { data: userSettings, error } = await supabase
    .from('user_settings')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  
  if (!userSettings) {
    throw new Error('User settings not found');
  }

  // Get admin settings if needed for copy_admin modes
  let adminSettings = null;
  if (userSettings.money_mode === 'copy_admin' || 
      userSettings.sltp_mode === 'copy_admin' || 
      userSettings.tier_mode === 'copy_admin') {
    adminSettings = await getAdminSettings(supabase);
  }

  // Build final settings object with admin overrides where needed
  const finalSettings: any = { ...userSettings };

  // Money Management settings (copy_admin mode)
  if (userSettings.money_mode === 'copy_admin' && adminSettings) {
    finalSettings.position_sizing_type = adminSettings.position_sizing_type;
    finalSettings.position_size_value = adminSettings.position_size_value;
    finalSettings.max_open_positions = adminSettings.max_open_positions;
    finalSettings.daily_loss_limit = adminSettings.daily_loss_limit;
    finalSettings.daily_loss_percent = adminSettings.daily_loss_percent;
    finalSettings.loss_limit_type = adminSettings.loss_limit_type;
    finalSettings.default_leverage = adminSettings.default_leverage;
    finalSettings.use_alert_leverage = adminSettings.use_alert_leverage;
    finalSettings.symbol_leverage_overrides = adminSettings.symbol_leverage_overrides;
  }

  // SL/TP settings (copy_admin mode)
  if (userSettings.sltp_mode === 'copy_admin' && adminSettings) {
    finalSettings.calculator_type = adminSettings.calculator_type;
    finalSettings.sl_method = adminSettings.sl_method;
    finalSettings.simple_sl_percent = adminSettings.simple_sl_percent;
    finalSettings.simple_tp_percent = adminSettings.simple_tp_percent;
    finalSettings.simple_tp2_percent = adminSettings.simple_tp2_percent;
    finalSettings.simple_tp3_percent = adminSettings.simple_tp3_percent;
    finalSettings.rr_ratio = adminSettings.rr_ratio;
    finalSettings.rr_adaptive = adminSettings.rr_adaptive;
    finalSettings.rr_sl_percent_margin = adminSettings.rr_sl_percent_margin;
    finalSettings.atr_sl_multiplier = adminSettings.atr_sl_multiplier;
    finalSettings.atr_tp_multiplier = adminSettings.atr_tp_multiplier;
    finalSettings.atr_tp2_multiplier = adminSettings.atr_tp2_multiplier;
    finalSettings.atr_tp3_multiplier = adminSettings.atr_tp3_multiplier;
    finalSettings.tp_strategy = adminSettings.tp_strategy;
    finalSettings.tp_levels = adminSettings.tp_levels;
    finalSettings.tp1_close_percent = adminSettings.tp1_close_percent;
    finalSettings.tp2_close_percent = adminSettings.tp2_close_percent;
    finalSettings.tp3_close_percent = adminSettings.tp3_close_percent;
    finalSettings.tp1_rr_ratio = adminSettings.tp1_rr_ratio;
    finalSettings.tp2_rr_ratio = adminSettings.tp2_rr_ratio;
    finalSettings.tp3_rr_ratio = adminSettings.tp3_rr_ratio;
    finalSettings.adaptive_tp_spacing = adminSettings.adaptive_tp_spacing;
    finalSettings.adaptive_tp_high_volatility_multiplier = adminSettings.adaptive_tp_high_volatility_multiplier;
    finalSettings.adaptive_tp_low_volatility_multiplier = adminSettings.adaptive_tp_low_volatility_multiplier;
    finalSettings.momentum_based_tp = adminSettings.momentum_based_tp;
    finalSettings.momentum_weak_multiplier = adminSettings.momentum_weak_multiplier;
    finalSettings.momentum_moderate_multiplier = adminSettings.momentum_moderate_multiplier;
    finalSettings.momentum_strong_multiplier = adminSettings.momentum_strong_multiplier;
    finalSettings.adaptive_rr = adminSettings.adaptive_rr;
    finalSettings.adaptive_rr_weak_signal = adminSettings.adaptive_rr_weak_signal;
    finalSettings.adaptive_rr_standard = adminSettings.adaptive_rr_standard;
    finalSettings.adaptive_rr_strong = adminSettings.adaptive_rr_strong;
    finalSettings.adaptive_rr_very_strong = adminSettings.adaptive_rr_very_strong;
    finalSettings.sl_to_breakeven = adminSettings.sl_to_breakeven;
    finalSettings.breakeven_trigger_tp = adminSettings.breakeven_trigger_tp;
    finalSettings.trailing_stop = adminSettings.trailing_stop;
    finalSettings.trailing_stop_trigger_tp = adminSettings.trailing_stop_trigger_tp;
    finalSettings.trailing_stop_distance = adminSettings.trailing_stop_distance;
  }

  // Tier settings (copy_admin mode)
  if (userSettings.tier_mode === 'copy_admin' && adminSettings) {
    finalSettings.filter_by_tier = adminSettings.filter_by_tier;
    finalSettings.allowed_tiers = adminSettings.allowed_tiers;
    finalSettings.excluded_tiers = adminSettings.excluded_tiers;
    finalSettings.alert_strength_threshold = adminSettings.alert_strength_threshold;
    finalSettings.duplicate_alert_handling = adminSettings.duplicate_alert_handling;
    finalSettings.require_profit_for_same_direction = adminSettings.require_profit_for_same_direction;
    finalSettings.pnl_threshold_percent = adminSettings.pnl_threshold_percent;
  }

  return finalSettings as UserSettings;
}
