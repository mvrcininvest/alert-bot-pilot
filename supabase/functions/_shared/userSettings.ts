import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.84.0';

export interface UserSettings {
  // Bot control
  bot_active: boolean;
  
  // Position sizing
  position_sizing_type: string;
  position_size_value: number;
  
  // Scalping mode settings
  max_margin_per_trade: number;
  max_loss_per_trade: number;
  sl_percent_min: number;
  sl_percent_max: number;
  
  // Calculator settings
  calculator_type: 'simple_percent' | 'risk_reward' | 'atr_based';
  sl_method: 'percent_margin' | 'percent_entry' | 'fixed_usdt' | 'atr_based';
  
  // Simple percent settings
  simple_sl_percent: number;
  simple_tp_percent: number;
  simple_tp2_percent: number;
  simple_tp3_percent: number;
  
  // Risk/Reward settings
  rr_ratio: number;
  rr_adaptive: boolean;
  rr_sl_percent_margin: number;
  
  // ATR settings
  atr_sl_multiplier: number;
  atr_tp_multiplier: number;
  atr_tp2_multiplier: number;
  atr_tp3_multiplier: number;
  
  // TP Strategy
  tp_strategy: 'partial_close' | 'main_tp_only' | 'trailing_stop';
  tp_levels: number;
  tp1_close_percent: number;
  tp2_close_percent: number;
  tp3_close_percent: number;
  tp1_rr_ratio: number;
  tp2_rr_ratio: number;
  tp3_rr_ratio: number;
  
  // Advanced TP features
  adaptive_tp_spacing: boolean;
  adaptive_tp_high_volatility_multiplier: number;
  adaptive_tp_low_volatility_multiplier: number;
  momentum_based_tp: boolean;
  momentum_weak_multiplier: number;
  momentum_moderate_multiplier: number;
  momentum_strong_multiplier: number;
  
  // Adaptive RR
  adaptive_rr: boolean;
  adaptive_rr_weak_signal: number;
  adaptive_rr_standard: number;
  adaptive_rr_strong: number;
  adaptive_rr_very_strong: number;
  
  // Trailing & Breakeven
  sl_to_breakeven: boolean;
  breakeven_trigger_tp: number;
  trailing_stop: boolean;
  trailing_stop_trigger_tp: number;
  trailing_stop_distance: number;
  
  // Risk management
  max_open_positions: number;
  daily_loss_limit: number;
  daily_loss_percent: number;
  loss_limit_type: string;
  
  // Leverage
  default_leverage: number;
  use_alert_leverage: boolean;
  use_max_leverage_global: boolean;
  symbol_leverage_overrides: any;
  
  // Filters
  filter_by_tier: boolean;
  allowed_tiers: string[];
  excluded_tiers: string[];
  alert_strength_threshold: number;
  
  // Alert handling
  duplicate_alert_handling: boolean;
  require_profit_for_same_direction: boolean;
  pnl_threshold_percent: number;
  
  // Fee-aware trading
  taker_fee_rate: number;
  include_fees_in_calculations: boolean;
  min_profitable_tp_percent: number;
  fee_aware_breakeven: boolean;
  
  // Modes (not needed for runtime, just for tracking)
  money_mode?: string;
  sltp_mode?: string;
  tier_mode?: string;
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

export async function getUserSettings(userId: string, symbol?: string): Promise<UserSettings> {
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

  // Build final settings object with admin overrides and defaults
  const finalSettings: UserSettings = {
    bot_active: userSettings.bot_active ?? true,
    position_sizing_type: userSettings.position_sizing_type ?? 'fixed_usdt',
    position_size_value: userSettings.position_size_value ?? 100,
    max_margin_per_trade: userSettings.max_margin_per_trade ?? 2,
    max_loss_per_trade: userSettings.max_loss_per_trade ?? 1,
    sl_percent_min: userSettings.sl_percent_min ?? 0.3,
    sl_percent_max: userSettings.sl_percent_max ?? 2.0,
    calculator_type: (userSettings.calculator_type ?? 'simple_percent') as 'simple_percent' | 'risk_reward' | 'atr_based',
    sl_method: (userSettings.sl_method ?? 'percent_entry') as 'percent_margin' | 'percent_entry' | 'fixed_usdt' | 'atr_based',
    simple_sl_percent: userSettings.simple_sl_percent ?? 1.5,
    simple_tp_percent: userSettings.simple_tp_percent ?? 3.0,
    simple_tp2_percent: userSettings.simple_tp2_percent ?? 0,
    simple_tp3_percent: userSettings.simple_tp3_percent ?? 0,
    rr_ratio: userSettings.rr_ratio ?? 2.0,
    rr_adaptive: userSettings.rr_adaptive ?? false,
    rr_sl_percent_margin: userSettings.rr_sl_percent_margin ?? 2.0,
    atr_sl_multiplier: userSettings.atr_sl_multiplier ?? 2.0,
    atr_tp_multiplier: userSettings.atr_tp_multiplier ?? 3.0,
    atr_tp2_multiplier: userSettings.atr_tp2_multiplier ?? 0,
    atr_tp3_multiplier: userSettings.atr_tp3_multiplier ?? 0,
    tp_strategy: (userSettings.tp_strategy ?? 'partial_close') as 'partial_close' | 'main_tp_only' | 'trailing_stop',
    tp_levels: userSettings.tp_levels ?? 1,
    tp1_close_percent: userSettings.tp1_close_percent ?? 100,
    tp2_close_percent: userSettings.tp2_close_percent ?? 0,
    tp3_close_percent: userSettings.tp3_close_percent ?? 0,
    tp1_rr_ratio: userSettings.tp1_rr_ratio ?? 1.5,
    tp2_rr_ratio: userSettings.tp2_rr_ratio ?? 2.5,
    tp3_rr_ratio: userSettings.tp3_rr_ratio ?? 3.5,
    adaptive_tp_spacing: userSettings.adaptive_tp_spacing ?? false,
    adaptive_tp_high_volatility_multiplier: userSettings.adaptive_tp_high_volatility_multiplier ?? 1.3,
    adaptive_tp_low_volatility_multiplier: userSettings.adaptive_tp_low_volatility_multiplier ?? 0.9,
    momentum_based_tp: userSettings.momentum_based_tp ?? false,
    momentum_weak_multiplier: userSettings.momentum_weak_multiplier ?? 0.9,
    momentum_moderate_multiplier: userSettings.momentum_moderate_multiplier ?? 1.1,
    momentum_strong_multiplier: userSettings.momentum_strong_multiplier ?? 1.3,
    adaptive_rr: userSettings.adaptive_rr ?? false,
    adaptive_rr_weak_signal: userSettings.adaptive_rr_weak_signal ?? 0.8,
    adaptive_rr_standard: userSettings.adaptive_rr_standard ?? 1.0,
    adaptive_rr_strong: userSettings.adaptive_rr_strong ?? 1.2,
    adaptive_rr_very_strong: userSettings.adaptive_rr_very_strong ?? 1.5,
    sl_to_breakeven: userSettings.sl_to_breakeven ?? true,
    breakeven_trigger_tp: userSettings.breakeven_trigger_tp ?? 1,
    trailing_stop: userSettings.trailing_stop ?? false,
    trailing_stop_trigger_tp: userSettings.trailing_stop_trigger_tp ?? 1,
    trailing_stop_distance: userSettings.trailing_stop_distance ?? 1.0,
    max_open_positions: userSettings.max_open_positions ?? 3,
    daily_loss_limit: userSettings.daily_loss_limit ?? 500,
    daily_loss_percent: userSettings.daily_loss_percent ?? 5.0,
    loss_limit_type: userSettings.loss_limit_type ?? 'fixed_usdt',
    default_leverage: userSettings.default_leverage ?? 10,
    use_alert_leverage: userSettings.use_alert_leverage ?? true,
    use_max_leverage_global: userSettings.use_max_leverage_global ?? false,
    symbol_leverage_overrides: userSettings.symbol_leverage_overrides ?? {},
    filter_by_tier: userSettings.filter_by_tier ?? false,
    allowed_tiers: userSettings.allowed_tiers ?? ['Platinum', 'Premium', 'Standard', 'Quick'],
    excluded_tiers: userSettings.excluded_tiers ?? [],
    alert_strength_threshold: userSettings.alert_strength_threshold ?? 0.20,
    duplicate_alert_handling: userSettings.duplicate_alert_handling ?? true,
    require_profit_for_same_direction: userSettings.require_profit_for_same_direction ?? true,
    pnl_threshold_percent: userSettings.pnl_threshold_percent ?? 0.5,
    taker_fee_rate: userSettings.taker_fee_rate ?? 0.06,
    include_fees_in_calculations: userSettings.include_fees_in_calculations ?? true,
    min_profitable_tp_percent: userSettings.min_profitable_tp_percent ?? 0.2,
    fee_aware_breakeven: userSettings.fee_aware_breakeven ?? true,
  };

  // Money Management settings (copy_admin mode)
  if (userSettings.money_mode === 'copy_admin' && adminSettings) {
    finalSettings.position_sizing_type = adminSettings.position_sizing_type;
    finalSettings.position_size_value = adminSettings.position_size_value;
    finalSettings.max_margin_per_trade = adminSettings.max_margin_per_trade ?? 2;
    finalSettings.max_loss_per_trade = adminSettings.max_loss_per_trade ?? 1;
    finalSettings.sl_percent_min = adminSettings.sl_percent_min ?? 0.3;
    finalSettings.sl_percent_max = adminSettings.sl_percent_max ?? 2.0;
    finalSettings.max_open_positions = adminSettings.max_open_positions ?? 3;
    finalSettings.daily_loss_limit = adminSettings.daily_loss_limit ?? 500;
    finalSettings.daily_loss_percent = adminSettings.daily_loss_percent ?? 5.0;
    finalSettings.loss_limit_type = adminSettings.loss_limit_type ?? 'fixed_usdt';
    finalSettings.default_leverage = adminSettings.default_leverage ?? 10;
    finalSettings.use_alert_leverage = adminSettings.use_alert_leverage ?? true;
    finalSettings.use_max_leverage_global = adminSettings.use_max_leverage_global ?? false;
    finalSettings.symbol_leverage_overrides = adminSettings.symbol_leverage_overrides ?? {};
  }

  // SL/TP settings (copy_admin mode)
  if (userSettings.sltp_mode === 'copy_admin' && adminSettings) {
    finalSettings.calculator_type = (adminSettings.calculator_type ?? 'simple_percent') as 'simple_percent' | 'risk_reward' | 'atr_based';
    finalSettings.sl_method = (adminSettings.sl_method ?? 'percent_entry') as 'percent_margin' | 'percent_entry' | 'fixed_usdt' | 'atr_based';
    finalSettings.simple_sl_percent = adminSettings.simple_sl_percent ?? 1.5;
    finalSettings.simple_tp_percent = adminSettings.simple_tp_percent ?? 3.0;
    finalSettings.simple_tp2_percent = adminSettings.simple_tp2_percent ?? 0;
    finalSettings.simple_tp3_percent = adminSettings.simple_tp3_percent ?? 0;
    finalSettings.rr_ratio = adminSettings.rr_ratio ?? 2.0;
    finalSettings.rr_adaptive = adminSettings.rr_adaptive ?? false;
    finalSettings.rr_sl_percent_margin = adminSettings.rr_sl_percent_margin ?? 2.0;
    finalSettings.atr_sl_multiplier = adminSettings.atr_sl_multiplier ?? 2.0;
    finalSettings.atr_tp_multiplier = adminSettings.atr_tp_multiplier ?? 3.0;
    finalSettings.atr_tp2_multiplier = adminSettings.atr_tp2_multiplier ?? 0;
    finalSettings.atr_tp3_multiplier = adminSettings.atr_tp3_multiplier ?? 0;
    finalSettings.tp_strategy = (adminSettings.tp_strategy ?? 'partial_close') as 'partial_close' | 'main_tp_only' | 'trailing_stop';
    finalSettings.tp_levels = adminSettings.tp_levels ?? 1;
    finalSettings.tp1_close_percent = adminSettings.tp1_close_percent ?? 100;
    finalSettings.tp2_close_percent = adminSettings.tp2_close_percent ?? 0;
    finalSettings.tp3_close_percent = adminSettings.tp3_close_percent ?? 0;
    finalSettings.tp1_rr_ratio = adminSettings.tp1_rr_ratio ?? 1.5;
    finalSettings.tp2_rr_ratio = adminSettings.tp2_rr_ratio ?? 2.5;
    finalSettings.tp3_rr_ratio = adminSettings.tp3_rr_ratio ?? 3.5;
    finalSettings.adaptive_tp_spacing = adminSettings.adaptive_tp_spacing ?? false;
    finalSettings.adaptive_tp_high_volatility_multiplier = adminSettings.adaptive_tp_high_volatility_multiplier ?? 1.3;
    finalSettings.adaptive_tp_low_volatility_multiplier = adminSettings.adaptive_tp_low_volatility_multiplier ?? 0.9;
    finalSettings.momentum_based_tp = adminSettings.momentum_based_tp ?? false;
    finalSettings.momentum_weak_multiplier = adminSettings.momentum_weak_multiplier ?? 0.9;
    finalSettings.momentum_moderate_multiplier = adminSettings.momentum_moderate_multiplier ?? 1.1;
    finalSettings.momentum_strong_multiplier = adminSettings.momentum_strong_multiplier ?? 1.3;
    finalSettings.adaptive_rr = adminSettings.adaptive_rr ?? false;
    finalSettings.adaptive_rr_weak_signal = adminSettings.adaptive_rr_weak_signal ?? 0.8;
    finalSettings.adaptive_rr_standard = adminSettings.adaptive_rr_standard ?? 1.0;
    finalSettings.adaptive_rr_strong = adminSettings.adaptive_rr_strong ?? 1.2;
    finalSettings.adaptive_rr_very_strong = adminSettings.adaptive_rr_very_strong ?? 1.5;
    finalSettings.sl_to_breakeven = adminSettings.sl_to_breakeven ?? true;
    finalSettings.breakeven_trigger_tp = adminSettings.breakeven_trigger_tp ?? 1;
    finalSettings.trailing_stop = adminSettings.trailing_stop ?? false;
    finalSettings.trailing_stop_trigger_tp = adminSettings.trailing_stop_trigger_tp ?? 1;
    finalSettings.trailing_stop_distance = adminSettings.trailing_stop_distance ?? 1.0;
  }

  // Tier settings (copy_admin mode)
  if (userSettings.tier_mode === 'copy_admin' && adminSettings) {
    finalSettings.filter_by_tier = adminSettings.filter_by_tier ?? false;
    finalSettings.allowed_tiers = adminSettings.allowed_tiers ?? ['Platinum', 'Premium', 'Standard', 'Quick'];
    finalSettings.excluded_tiers = adminSettings.excluded_tiers ?? [];
    finalSettings.alert_strength_threshold = adminSettings.alert_strength_threshold ?? 0.20;
    finalSettings.duplicate_alert_handling = adminSettings.duplicate_alert_handling ?? true;
    finalSettings.require_profit_for_same_direction = adminSettings.require_profit_for_same_direction ?? true;
    finalSettings.pnl_threshold_percent = adminSettings.pnl_threshold_percent ?? 0.5;
  }

  // Apply category-specific overrides if symbol provided
  if (symbol) {
    // Import getSymbolCategory dynamically or implement inline
    const getSymbolCategory = (sym: string): 'BTC_ETH' | 'MAJOR' | 'ALTCOIN' => {
      if (['BTCUSDT', 'ETHUSDT'].includes(sym)) return 'BTC_ETH';
      if (['XRPUSDT', 'SOLUSDT', 'BNBUSDT'].includes(sym)) return 'MAJOR';
      return 'ALTCOIN';
    };
    
    // Determine which category_settings to use
    const useAdminCategorySettings = 
      userSettings.money_mode === 'copy_admin' || 
      userSettings.sltp_mode === 'copy_admin';
    
    const categorySettingsSource = useAdminCategorySettings && adminSettings 
      ? adminSettings.category_settings 
      : userSettings.category_settings;
    
    if (categorySettingsSource) {
      const category = getSymbolCategory(symbol);
      const categorySettings = categorySettingsSource[category];
      
      // Only apply category overrides if enabled=true
      if (categorySettings && categorySettings.enabled === true) {
        // Override with category-specific values
        finalSettings.default_leverage = Math.min(
          finalSettings.default_leverage,
          categorySettings.max_leverage || finalSettings.default_leverage
        );
        finalSettings.max_margin_per_trade = categorySettings.max_margin ?? finalSettings.max_margin_per_trade;
        finalSettings.max_loss_per_trade = categorySettings.max_loss ?? finalSettings.max_loss_per_trade;
        finalSettings.tp_levels = categorySettings.tp_levels ?? finalSettings.tp_levels;
        finalSettings.tp1_rr_ratio = categorySettings.tp1_rr ?? finalSettings.tp1_rr_ratio;
        finalSettings.tp2_rr_ratio = categorySettings.tp2_rr ?? finalSettings.tp2_rr_ratio;
        finalSettings.tp3_rr_ratio = categorySettings.tp3_rr ?? finalSettings.tp3_rr_ratio;
        finalSettings.tp1_close_percent = categorySettings.tp1_close_pct ?? finalSettings.tp1_close_percent;
        finalSettings.tp2_close_percent = categorySettings.tp2_close_pct ?? finalSettings.tp2_close_percent;
        finalSettings.tp3_close_percent = categorySettings.tp3_close_pct ?? finalSettings.tp3_close_percent;
      }
    }
  }

  return finalSettings as UserSettings;
}
