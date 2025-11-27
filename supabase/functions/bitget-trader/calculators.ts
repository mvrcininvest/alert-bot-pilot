// SL/TP Calculation Logic

interface AlertData {
  price: number;
  sl: number;
  tp1: number;
  tp2?: number;
  tp3?: number;
  main_tp: number;
  atr: number;
  leverage: number;
  side: 'BUY' | 'SELL';
  strength: number;
  technical?: any;
  volume_ratio?: number;
}

interface Settings {
  calculator_type: 'simple_percent' | 'risk_reward' | 'atr_based';
  sl_method: 'percent_margin' | 'percent_entry' | 'fixed_usdt' | 'atr_based';
  simple_sl_percent: number;
  simple_tp_percent: number;
  rr_sl_percent_margin: number;
  rr_ratio: number;
  rr_adaptive: boolean;
  atr_sl_multiplier: number;
  atr_tp_multiplier: number;
  tp_levels: number;
  tp1_rr_ratio: number;
  tp2_rr_ratio: number;
  tp3_rr_ratio: number;
  adaptive_tp_spacing: boolean;
  adaptive_tp_high_volatility_multiplier: number;
  adaptive_tp_low_volatility_multiplier: number;
  momentum_based_tp: boolean;
  momentum_weak_multiplier: number;
  momentum_moderate_multiplier: number;
  momentum_strong_multiplier: number;
  adaptive_rr: boolean;
  adaptive_rr_weak_signal: number;
  adaptive_rr_standard: number;
  adaptive_rr_strong: number;
  adaptive_rr_very_strong: number;
}

interface CalculatedPrices {
  sl_price: number;
  tp1_price?: number;
  tp2_price?: number;
  tp3_price?: number;
}

export function calculatePositionSize(
  settings: Settings,
  alertData: AlertData,
  accountBalance: number
): number {
  const positionSizingType = (settings as any).position_sizing_type || 'fixed_usdt';
  const positionSizeValue = (settings as any).position_size_value || 100;

  if (positionSizingType === 'fixed_usdt') {
    // Fixed USDT amount
    const quantity = positionSizeValue / alertData.price;
    return quantity;
  } else {
    // Percentage of capital
    const capitalToUse = accountBalance * (positionSizeValue / 100);
    const quantity = capitalToUse / alertData.price;
    return quantity;
  }
}

export function calculateSLTP(
  alertData: AlertData,
  settings: Settings,
  positionSize: number,
  effectiveLeverage: number
): CalculatedPrices {
  let slPrice: number;
  let tp1Price: number | undefined;
  let tp2Price: number | undefined;
  let tp3Price: number | undefined;

  // Calculate SL based on method AND calculator type
  // CRITICAL: When using risk_reward calculator, use rr_sl_percent_margin
  if (settings.calculator_type === 'risk_reward' && settings.sl_method === 'percent_entry') {
    // For risk_reward: use rr_sl_percent_margin (e.g., 10% margin = 1% from entry at 10x leverage)
    slPrice = calculateSLByPercentMargin(alertData, settings, positionSize, effectiveLeverage);
  } else {
    // For other calculators or methods, use the specified sl_method
    switch (settings.sl_method) {
      case 'percent_entry':
        slPrice = calculateSLByPercentEntry(alertData, settings);
        break;
      case 'percent_margin':
        slPrice = calculateSLByPercentMargin(alertData, settings, positionSize, effectiveLeverage);
        break;
      case 'fixed_usdt':
        slPrice = calculateSLByFixedUSDT(alertData, settings, positionSize);
        break;
      case 'atr_based':
        slPrice = calculateSLByATR(alertData, settings);
        break;
      default:
        slPrice = alertData.sl;
    }
  }

  // Calculate TP based on calculator type
  switch (settings.calculator_type) {
    case 'simple_percent':
      ({ tp1Price, tp2Price, tp3Price } = calculateTPSimple(alertData, settings, slPrice));
      break;
    case 'risk_reward':
      ({ tp1Price, tp2Price, tp3Price } = calculateTPRiskReward(alertData, settings, slPrice));
      break;
    case 'atr_based':
      ({ tp1Price, tp2Price, tp3Price } = calculateTPATR(alertData, settings, slPrice));
      break;
  }

  // Apply adaptive systems
  if (settings.adaptive_tp_spacing) {
    ({ tp1Price, tp2Price, tp3Price } = applyAdaptiveTPSpacing(
      alertData,
      settings,
      { tp1Price, tp2Price, tp3Price }
    ));
  }

  if (settings.momentum_based_tp) {
    ({ tp1Price, tp2Price, tp3Price } = applyMomentumBasedTP(
      alertData,
      settings,
      { tp1Price, tp2Price, tp3Price }
    ));
  }

  if (settings.adaptive_rr) {
    const rrMultiplier = getAdaptiveRRMultiplier(alertData, settings);
    const slDistance = Math.abs(alertData.price - slPrice);
    
    if (tp1Price) {
      const tp1Distance = Math.abs(tp1Price - alertData.price);
      tp1Price = alertData.side === 'BUY'
        ? alertData.price + (tp1Distance * rrMultiplier)
        : alertData.price - (tp1Distance * rrMultiplier);
    }
    if (tp2Price) {
      const tp2Distance = Math.abs(tp2Price - alertData.price);
      tp2Price = alertData.side === 'BUY'
        ? alertData.price + (tp2Distance * rrMultiplier)
        : alertData.price - (tp2Distance * rrMultiplier);
    }
    if (tp3Price) {
      const tp3Distance = Math.abs(tp3Price - alertData.price);
      tp3Price = alertData.side === 'BUY'
        ? alertData.price + (tp3Distance * rrMultiplier)
        : alertData.price - (tp3Distance * rrMultiplier);
    }
  }

  return { sl_price: slPrice, tp1_price: tp1Price, tp2_price: tp2Price, tp3_price: tp3Price };
}

function calculateSLByPercentEntry(alertData: AlertData, settings: Settings): number {
  const percent = settings.simple_sl_percent / 100;
  return alertData.side === 'BUY'
    ? alertData.price * (1 - percent)
    : alertData.price * (1 + percent);
}

function calculateSLByPercentMargin(
  alertData: AlertData,
  settings: Settings,
  positionSize: number,
  effectiveLeverage: number
): number {
  // CRITICAL FIX: Use effectiveLeverage (from bot settings) instead of alertData.leverage (from TradingView)
  const marginValue = positionSize * alertData.price / effectiveLeverage;
  const maxLoss = marginValue * (settings.rr_sl_percent_margin / 100);
  const slDistance = maxLoss / positionSize;
  
  return alertData.side === 'BUY'
    ? alertData.price - slDistance
    : alertData.price + slDistance;
}

function calculateSLByFixedUSDT(
  alertData: AlertData,
  settings: Settings,
  positionSize: number
): number {
  const fixedLoss = (settings as any).sl_fixed_usdt || 50;
  const slDistance = fixedLoss / positionSize;
  
  return alertData.side === 'BUY'
    ? alertData.price - slDistance
    : alertData.price + slDistance;
}

function calculateSLByATR(alertData: AlertData, settings: Settings): number {
  const atrMultiplier = settings.atr_sl_multiplier;
  const slDistance = alertData.atr * atrMultiplier;
  
  return alertData.side === 'BUY'
    ? alertData.price - slDistance
    : alertData.price + slDistance;
}

function calculateTPSimple(
  alertData: AlertData,
  settings: Settings,
  slPrice: number
): { tp1Price?: number; tp2Price?: number; tp3Price?: number } {
  const percent = settings.simple_tp_percent / 100;
  
  const tp1Price = alertData.side === 'BUY'
    ? alertData.price * (1 + percent)
    : alertData.price * (1 - percent);

  let tp2Price, tp3Price;
  if (settings.tp_levels >= 2) {
    // Use simple_tp2_percent if available, otherwise fallback to 1.5x multiplier
    const tp2Percent = ((settings as any).simple_tp2_percent || (settings.simple_tp_percent * 1.5)) / 100;
    tp2Price = alertData.side === 'BUY'
      ? alertData.price * (1 + tp2Percent)
      : alertData.price * (1 - tp2Percent);
  }
  if (settings.tp_levels >= 3) {
    // Use simple_tp3_percent if available, otherwise fallback to 2x multiplier
    const tp3Percent = ((settings as any).simple_tp3_percent || (settings.simple_tp_percent * 2)) / 100;
    tp3Price = alertData.side === 'BUY'
      ? alertData.price * (1 + tp3Percent)
      : alertData.price * (1 - tp3Percent);
  }

  return { tp1Price, tp2Price, tp3Price };
}

function calculateTPRiskReward(
  alertData: AlertData,
  settings: Settings,
  slPrice: number
): { tp1Price?: number; tp2Price?: number; tp3Price?: number } {
  const slDistance = Math.abs(alertData.price - slPrice);
  
  const tp1Price = alertData.side === 'BUY'
    ? alertData.price + (slDistance * settings.tp1_rr_ratio)
    : alertData.price - (slDistance * settings.tp1_rr_ratio);

  let tp2Price, tp3Price;
  if (settings.tp_levels >= 2) {
    tp2Price = alertData.side === 'BUY'
      ? alertData.price + (slDistance * settings.tp2_rr_ratio)
      : alertData.price - (slDistance * settings.tp2_rr_ratio);
  }
  if (settings.tp_levels >= 3) {
    tp3Price = alertData.side === 'BUY'
      ? alertData.price + (slDistance * settings.tp3_rr_ratio)
      : alertData.price - (slDistance * settings.tp3_rr_ratio);
  }

  return { tp1Price, tp2Price, tp3Price };
}

function calculateTPATR(
  alertData: AlertData,
  settings: Settings,
  slPrice: number
): { tp1Price?: number; tp2Price?: number; tp3Price?: number } {
  const atrMultiplier = settings.atr_tp_multiplier;
  
  const tp1Price = alertData.side === 'BUY'
    ? alertData.price + (alertData.atr * atrMultiplier)
    : alertData.price - (alertData.atr * atrMultiplier);

  let tp2Price, tp3Price;
  if (settings.tp_levels >= 2) {
    // Use atr_tp2_multiplier if available, otherwise fallback to 1.5x
    const tp2Mult = (settings as any).atr_tp2_multiplier || (atrMultiplier * 1.5);
    tp2Price = alertData.side === 'BUY'
      ? alertData.price + (alertData.atr * tp2Mult)
      : alertData.price - (alertData.atr * tp2Mult);
  }
  if (settings.tp_levels >= 3) {
    // Use atr_tp3_multiplier if available, otherwise fallback to 2x
    const tp3Mult = (settings as any).atr_tp3_multiplier || (atrMultiplier * 2);
    tp3Price = alertData.side === 'BUY'
      ? alertData.price + (alertData.atr * tp3Mult)
      : alertData.price - (alertData.atr * tp3Mult);
  }

  return { tp1Price, tp2Price, tp3Price };
}

function applyAdaptiveTPSpacing(
  alertData: AlertData,
  settings: Settings,
  tpPrices: { tp1Price?: number; tp2Price?: number; tp3Price?: number }
): { tp1Price?: number; tp2Price?: number; tp3Price?: number } {
  // Determine volatility based on volume_ratio and ATR
  const isHighVolatility = (alertData.volume_ratio || 1) > 1.5 || alertData.atr > 0.01;
  const multiplier = isHighVolatility
    ? settings.adaptive_tp_high_volatility_multiplier
    : settings.adaptive_tp_low_volatility_multiplier;

  const { tp1Price, tp2Price, tp3Price } = tpPrices;

  return {
    tp1Price: tp1Price ? adjustTPDistance(alertData.price, tp1Price, multiplier, alertData.side) : undefined,
    tp2Price: tp2Price ? adjustTPDistance(alertData.price, tp2Price, multiplier, alertData.side) : undefined,
    tp3Price: tp3Price ? adjustTPDistance(alertData.price, tp3Price, multiplier, alertData.side) : undefined,
  };
}

function applyMomentumBasedTP(
  alertData: AlertData,
  settings: Settings,
  tpPrices: { tp1Price?: number; tp2Price?: number; tp3Price?: number }
): { tp1Price?: number; tp2Price?: number; tp3Price?: number } {
  const strength = alertData.strength || 0;
  let multiplier: number;

  if (strength < 0.3) {
    multiplier = settings.momentum_weak_multiplier;
  } else if (strength < 0.6) {
    multiplier = settings.momentum_moderate_multiplier;
  } else {
    multiplier = settings.momentum_strong_multiplier;
  }

  const { tp1Price, tp2Price, tp3Price } = tpPrices;

  return {
    tp1Price: tp1Price ? adjustTPDistance(alertData.price, tp1Price, multiplier, alertData.side) : undefined,
    tp2Price: tp2Price ? adjustTPDistance(alertData.price, tp2Price, multiplier, alertData.side) : undefined,
    tp3Price: tp3Price ? adjustTPDistance(alertData.price, tp3Price, multiplier, alertData.side) : undefined,
  };
}

function getAdaptiveRRMultiplier(alertData: AlertData, settings: Settings): number {
  // Calculate signal strength score (0-10)
  const strength = alertData.strength || 0;
  const score = strength * 10;

  if (score < 3) return settings.adaptive_rr_weak_signal;
  if (score < 5) return settings.adaptive_rr_standard;
  if (score < 7) return settings.adaptive_rr_strong;
  return settings.adaptive_rr_very_strong;
}

function adjustTPDistance(
  entryPrice: number,
  tpPrice: number,
  multiplier: number,
  side: 'BUY' | 'SELL'
): number {
  const distance = Math.abs(tpPrice - entryPrice);
  const newDistance = distance * multiplier;
  
  return side === 'BUY'
    ? entryPrice + newDistance
    : entryPrice - newDistance;
}
