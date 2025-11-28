import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { log } from "../_shared/logger.ts";
import { getUserApiKeys } from "../_shared/userKeys.ts";
import { getUserSettings } from "../_shared/userSettings.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= PART A: PRICE VALIDATION FUNCTION =============
function isPriceBeyondLevel(
  currentPrice: number,
  targetPrice: number,
  side: 'BUY' | 'SELL',
  orderType: 'TP' | 'SL',
  tolerancePercent: number = 0.1 // 0.1% tolerance
): boolean {
  const tolerance = targetPrice * (tolerancePercent / 100);
  const isBuy = side === 'BUY';
  
  if (orderType === 'TP') {
    // For BUY: TP is above entry, price must be BELOW TP for order to make sense
    // For SELL: TP is below entry, price must be ABOVE TP for order to make sense
    return isBuy 
      ? currentPrice >= (targetPrice - tolerance)  // BUY: price already reached TP
      : currentPrice <= (targetPrice + tolerance); // SELL: price already reached TP
  } else {
    // SL
    return isBuy
      ? currentPrice <= (targetPrice + tolerance)  // BUY: price already hit SL
      : currentPrice >= (targetPrice - tolerance); // SELL: price already hit SL
  }
}

// Helper function to get price and volume precision from Bitget API
async function getSymbolPrecision(supabase: any, symbol: string, apiCredentials: any): Promise<{ pricePlace: number; volumePlace: number }> {
  const { data: symbolInfoResult } = await supabase.functions.invoke('bitget-api', {
    body: {
      action: 'get_symbol_info',
      params: { symbol },
      apiCredentials
    }
  });
  
  let pricePlace = 2;  // Default to 2 decimal places
  let volumePlace = 2; // Default to 2 decimal places
  
  if (symbolInfoResult?.success && symbolInfoResult.data?.[0]) {
    pricePlace = parseInt(symbolInfoResult.data[0].pricePlace || '2');
    volumePlace = parseInt(symbolInfoResult.data[0].volumePlace || '2');
  }
  
  return { pricePlace, volumePlace };
}

// Helper function to round price to correct precision
function roundPrice(price: number, places: number): string {
  return price.toFixed(places);
}

// ✅ PART 2: Helper to get actual position size from exchange
async function getPositionSizeFromExchange(
  supabase: any, 
  symbol: string, 
  holdSide: string, 
  apiCredentials: any
): Promise<number> {
  const { data: posData } = await supabase.functions.invoke('bitget-api', {
    body: { action: 'get_position', params: { symbol }, apiCredentials }
  });
  const pos = posData?.data?.find((p: any) => p.holdSide === holdSide);
  return pos ? parseFloat(pos.total) : 0;
}

// ✅ PART 2: executeVerifiedClose - Close with position size verification
async function executeVerifiedClose(
  supabase: any, 
  position: any, 
  quantity: number,
  holdSide: string,
  apiCredentials: any,
  pricePlace: number,
  volumePlace: number
): Promise<{ success: boolean; actualClosedQty: number; method: string }> {
  
  // 1. Get initial position size from exchange
  const beforeSize = await getPositionSizeFromExchange(supabase, position.symbol, holdSide, apiCredentials);
  
  console.log(`📊 Position size BEFORE close attempt: ${beforeSize}`);
  
  if (beforeSize === 0) {
    return { success: true, actualClosedQty: quantity, method: 'already_closed' };
  }
  
  // 2. Try flash_close (3 attempts with verification)
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data: flashResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'flash_close_position',
        params: { symbol: position.symbol, holdSide, size: quantity.toString() },
        apiCredentials
      }
    });
    
    const wasExecuted = flashResult?.wasExecuted || flashResult?.data?.wasExecuted;
    
    if (wasExecuted || flashResult?.success) {
      await new Promise(r => setTimeout(r, 500)); // Wait for propagation
      
      // VERIFY: Check actual position size after close
      const afterSize = await getPositionSizeFromExchange(supabase, position.symbol, holdSide, apiCredentials);
      console.log(`📊 Position size AFTER flash close: ${afterSize} (was: ${beforeSize})`);
      
      if (afterSize < beforeSize * 0.99) {
        const closedQty = beforeSize - afterSize;
        console.log(`✅ Verified close: ${closedQty} units closed via flash_close`);
        return { success: true, actualClosedQty: closedQty, method: 'flash_close' };
      }
      
      console.warn(`⚠️ Flash close reported success but size unchanged (${afterSize})`);
    }
    
    console.warn(`⚠️ Flash close attempt ${attempt}/3 - not verified`);
    if (attempt < 3) await new Promise(r => setTimeout(r, 500));
  }
  
  // 3. Try market close (3 attempts with verification)
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data: closeResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'close_position',
        params: { symbol: position.symbol, side: holdSide, size: quantity.toString() },
        apiCredentials
      }
    });
    
    if (closeResult?.success) {
      await new Promise(r => setTimeout(r, 500));
      
      const afterSize = await getPositionSizeFromExchange(supabase, position.symbol, holdSide, apiCredentials);
      console.log(`📊 Position size AFTER market close: ${afterSize} (was: ${beforeSize})`);
      
      if (afterSize < beforeSize * 0.99) {
        const closedQty = beforeSize - afterSize;
        console.log(`✅ Verified close: ${closedQty} units closed via market_close`);
        return { success: true, actualClosedQty: closedQty, method: 'market_close' };
      }
    }
    
    if (attempt < 3) await new Promise(r => setTimeout(r, 500));
  }
  
  // 4. Last resort: LIMIT order at current price
  const { data: tickerResult } = await supabase.functions.invoke('bitget-api', {
    body: { action: 'get_ticker', params: { symbol: position.symbol }, apiCredentials }
  });
  
  if (tickerResult?.success && tickerResult.data?.[0]) {
    const currentPrice = parseFloat(tickerResult.data[0].lastPr);
    const slippageTolerance = 0.001;
    const limitPrice = holdSide === 'long' 
      ? currentPrice * (1 - slippageTolerance)
      : currentPrice * (1 + slippageTolerance);
    
    const roundedLimitPrice = roundPrice(limitPrice, pricePlace);
    
    const { data: limitResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'place_order',
        params: {
          symbol: position.symbol,
          side: holdSide,
          size: quantity.toString(),
          price: roundedLimitPrice,
          orderType: 'limit',
          reduceOnly: 'YES',
        },
        apiCredentials
      }
    });
    
    if (limitResult?.success) {
      console.log(`✅ Placed LIMIT order as last resort at ${roundedLimitPrice}`);
      return { success: true, actualClosedQty: quantity, method: 'limit_order' };
    }
  }
  
  return { success: false, actualClosedQty: 0, method: 'failed' };
}

// ============= SL/TP CALCULATION FROM SETTINGS =============
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
}

interface ExpectedSLTP {
  sl_price: number;
  tp1_price?: number;
  tp2_price?: number;
  tp3_price?: number;
  tp1_quantity?: number;
  tp2_quantity?: number;
  tp3_quantity?: number;
}

function calculateExpectedSLTP(position: any, settings: any): ExpectedSLTP {
  // ✅ PART 4: PRIORITIZE DB PRICES - Use prices from database as "source of truth"
  // These prices were calculated by bitget-trader when opening the position
  const dbSl = position.sl_price ? Number(position.sl_price) : null;
  const dbTp1 = position.tp1_price ? Number(position.tp1_price) : null;
  const dbTp2 = position.tp2_price ? Number(position.tp2_price) : null;
  const dbTp3 = position.tp3_price ? Number(position.tp3_price) : null;
  
  // Quantities from DB
  const dbTp1Qty = position.tp1_quantity ? Number(position.tp1_quantity) : null;
  const dbTp2Qty = position.tp2_quantity ? Number(position.tp2_quantity) : null;
  const dbTp3Qty = position.tp3_quantity ? Number(position.tp3_quantity) : null;
  
  // If we have prices in DB - use them (they are the "source of truth" for this position)
  if (dbSl && dbTp1) {
    console.log(`📍 Using DB prices: SL=${dbSl}, TP1=${dbTp1}, TP2=${dbTp2}, TP3=${dbTp3}`);
    
    // Calculate quantities based on settings if not in DB
    const totalQty = position.quantity;
    const tp1Qty = dbTp1Qty || (!position.tp1_filled && settings.tp_levels >= 1 ? totalQty * (settings.tp1_close_percent / 100) : 0);
    const tp2Qty = dbTp2Qty || (!position.tp2_filled && settings.tp_levels >= 2 ? totalQty * (settings.tp2_close_percent / 100) : 0);
    const tp3Qty = dbTp3Qty || (!position.tp3_filled && settings.tp_levels >= 3 ? totalQty * (settings.tp3_close_percent / 100) : 0);
    
    return {
      sl_price: dbSl,
      tp1_price: !position.tp1_filled ? dbTp1 : undefined,
      tp2_price: !position.tp2_filled && dbTp2 ? dbTp2 : undefined,
      tp3_price: !position.tp3_filled && dbTp3 ? dbTp3 : undefined,
      tp1_quantity: tp1Qty > 0 ? tp1Qty : undefined,
      tp2_quantity: tp2Qty > 0 ? tp2Qty : undefined,
      tp3_quantity: tp3Qty > 0 ? tp3Qty : undefined,
    };
  }
  
  // Fallback: Calculate from scratch if DB prices are missing
  const alertData: AlertData = {
    price: position.entry_price,
    sl: position.sl_price,
    tp1: position.tp1_price || position.entry_price,
    tp2: position.tp2_price,
    tp3: position.tp3_price,
    main_tp: position.tp1_price || position.entry_price,
    atr: (position.metadata as any)?.atr || 0.01,
    leverage: position.leverage,
    side: position.side,
    strength: (position.metadata as any)?.strength || 0.5,
  };

  // CHECK BREAKEVEN CONDITION FIRST - if TP was hit and sl_to_breakeven is enabled
  const triggerTP = settings.breakeven_trigger_tp || 1;
  const shouldBeAtBreakeven = settings.sl_to_breakeven && (
    (triggerTP === 1 && position.tp1_filled) ||
    (triggerTP === 2 && position.tp2_filled) ||
    (triggerTP === 3 && position.tp3_filled)
  );
  
  if (shouldBeAtBreakeven) {
    // SL should be at entry price (with small buffer to avoid exact entry close)
    const beBuffer = position.entry_price * 0.0001; // 0.01% buffer
    const slPrice = position.side === 'BUY' 
      ? position.entry_price + beBuffer 
      : position.entry_price - beBuffer;
    
    console.log(`📍 Expected SL at BREAKEVEN: ${slPrice} (entry: ${position.entry_price})`);
    
    // Still calculate TPs normally - only SL changes
    const totalQty = position.quantity;
    const tp1Qty = (!position.tp1_filled && settings.tp_levels >= 1) 
      ? totalQty * (settings.tp1_close_percent / 100) 
      : 0;
    const tp2Qty = (!position.tp2_filled && settings.tp_levels >= 2) 
      ? totalQty * (settings.tp2_close_percent / 100) 
      : 0;
    const tp3Qty = (!position.tp3_filled && settings.tp_levels >= 3) 
      ? totalQty * (settings.tp3_close_percent / 100) 
      : 0;
    
    // Get TP prices based on calculator type
    let tp1Price, tp2Price, tp3Price;
    if (settings.position_sizing_type === 'scalping_mode') {
      const effectiveLeverage = (position.metadata as any)?.effective_leverage || position.leverage;
      const tpPrices = calculateScalpingSLTP(alertData, settings, effectiveLeverage);
      tp1Price = tpPrices.tp1_price;
      tp2Price = tpPrices.tp2_price;
      tp3Price = tpPrices.tp3_price;
    } else {
      switch (settings.calculator_type) {
        case 'simple_percent':
          ({ tp1Price, tp2Price, tp3Price } = calculateTPSimple(alertData, settings));
          break;
        case 'risk_reward':
          ({ tp1Price, tp2Price, tp3Price } = calculateTPRiskReward(alertData, settings, slPrice));
          break;
        case 'atr_based':
          ({ tp1Price, tp2Price, tp3Price } = calculateTPATR(alertData, settings));
          break;
      }
    }
    
    return {
      sl_price: slPrice,
      tp1_price: !position.tp1_filled ? tp1Price : undefined,
      tp2_price: !position.tp2_filled ? tp2Price : undefined,
      tp3_price: !position.tp3_filled ? tp3Price : undefined,
      tp1_quantity: tp1Qty > 0 ? tp1Qty : undefined,
      tp2_quantity: tp2Qty > 0 ? tp2Qty : undefined,
      tp3_quantity: tp3Qty > 0 ? tp3Qty : undefined,
    };
  }

  // Check for scalping mode FIRST
  if (settings.position_sizing_type === 'scalping_mode') {
    const effectiveLeverage = (position.metadata as any)?.effective_leverage || position.leverage;
    const { sl_price, tp1_price, tp2_price, tp3_price } = calculateScalpingSLTP(
      alertData, settings, effectiveLeverage
    );
    
    // Calculate quantities - only for unfilled TPs
    const totalQty = position.quantity;
    const tp1Qty = (!position.tp1_filled && settings.tp_levels >= 1) 
      ? totalQty * (settings.tp1_close_percent / 100) 
      : 0;
    const tp2Qty = (!position.tp2_filled && settings.tp_levels >= 2) 
      ? totalQty * (settings.tp2_close_percent / 100) 
      : 0;
    const tp3Qty = (!position.tp3_filled && settings.tp_levels >= 3) 
      ? totalQty * (settings.tp3_close_percent / 100) 
      : 0;
    
    return {
      sl_price,
      tp1_price: !position.tp1_filled ? tp1_price : undefined,
      tp2_price: !position.tp2_filled ? tp2_price : undefined,
      tp3_price: !position.tp3_filled ? tp3_price : undefined,
      tp1_quantity: tp1Qty > 0 ? tp1Qty : undefined,
      tp2_quantity: tp2Qty > 0 ? tp2Qty : undefined,
      tp3_quantity: tp3Qty > 0 ? tp3Qty : undefined,
    };
  }

  // Calculate SL
  let slPrice: number;
  if (settings.calculator_type === 'risk_reward' && settings.sl_method === 'percent_entry') {
    slPrice = calculateSLByPercentMargin(alertData, settings, position.quantity);
  } else {
    switch (settings.sl_method) {
      case 'percent_entry':
        slPrice = calculateSLByPercentEntry(alertData, settings);
        break;
      case 'percent_margin':
        slPrice = calculateSLByPercentMargin(alertData, settings, position.quantity);
        break;
      case 'atr_based':
        slPrice = calculateSLByATR(alertData, settings);
        break;
      default:
        slPrice = alertData.sl;
    }
  }

  // Calculate TP
  let tp1Price, tp2Price, tp3Price;
  switch (settings.calculator_type) {
    case 'simple_percent':
      ({ tp1Price, tp2Price, tp3Price } = calculateTPSimple(alertData, settings));
      break;
    case 'risk_reward':
      ({ tp1Price, tp2Price, tp3Price } = calculateTPRiskReward(alertData, settings, slPrice));
      break;
    case 'atr_based':
      ({ tp1Price, tp2Price, tp3Price } = calculateTPATR(alertData, settings));
      break;
  }

  // Calculate TP quantities based on close percentages - only for unfilled TPs
  const totalQty = position.quantity;
  
  // Only calculate TPs that haven't been filled yet
  const tp1Qty = (!position.tp1_filled && settings.tp_levels >= 1) 
    ? totalQty * (settings.tp1_close_percent / 100) 
    : 0;
  const tp2Qty = (!position.tp2_filled && settings.tp_levels >= 2) 
    ? totalQty * (settings.tp2_close_percent / 100) 
    : 0;
  const tp3Qty = (!position.tp3_filled && settings.tp_levels >= 3) 
    ? totalQty * (settings.tp3_close_percent / 100) 
    : 0;

  return {
    sl_price: slPrice,
    tp1_price: !position.tp1_filled ? tp1Price : undefined,
    tp2_price: !position.tp2_filled ? tp2Price : undefined,
    tp3_price: !position.tp3_filled ? tp3Price : undefined,
    tp1_quantity: tp1Qty > 0 ? tp1Qty : undefined,
    tp2_quantity: tp2Qty > 0 ? tp2Qty : undefined,
    tp3_quantity: tp3Qty > 0 ? tp3Qty : undefined,
  };
}

function calculateSLByPercentEntry(alertData: AlertData, settings: any): number {
  const percent = settings.simple_sl_percent / 100;
  return alertData.side === 'BUY'
    ? alertData.price * (1 - percent)
    : alertData.price * (1 + percent);
}

function calculateSLByPercentMargin(alertData: AlertData, settings: any, positionSize: number): number {
  const marginValue = positionSize * alertData.price / alertData.leverage;
  const maxLoss = marginValue * (settings.rr_sl_percent_margin / 100);
  const slDistance = maxLoss / positionSize;
  
  return alertData.side === 'BUY'
    ? alertData.price - slDistance
    : alertData.price + slDistance;
}

function calculateSLByATR(alertData: AlertData, settings: any): number {
  const atrMultiplier = settings.atr_sl_multiplier;
  const slDistance = alertData.atr * atrMultiplier;
  
  return alertData.side === 'BUY'
    ? alertData.price - slDistance
    : alertData.price + slDistance;
}

function calculateTPSimple(alertData: AlertData, settings: any): { tp1Price?: number; tp2Price?: number; tp3Price?: number } {
  const percent = settings.simple_tp_percent / 100;
  
  const tp1Price = alertData.side === 'BUY'
    ? alertData.price * (1 + percent)
    : alertData.price * (1 - percent);

  let tp2Price, tp3Price;
  if (settings.tp_levels >= 2) {
    const tp2Percent = (settings.simple_tp2_percent || (settings.simple_tp_percent * 1.5)) / 100;
    tp2Price = alertData.side === 'BUY'
      ? alertData.price * (1 + tp2Percent)
      : alertData.price * (1 - tp2Percent);
  }
  if (settings.tp_levels >= 3) {
    const tp3Percent = (settings.simple_tp3_percent || (settings.simple_tp_percent * 2)) / 100;
    tp3Price = alertData.side === 'BUY'
      ? alertData.price * (1 + tp3Percent)
      : alertData.price * (1 - tp3Percent);
  }

  return { tp1Price, tp2Price, tp3Price };
}

function calculateTPRiskReward(alertData: AlertData, settings: any, slPrice: number): { tp1Price?: number; tp2Price?: number; tp3Price?: number } {
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

function calculateTPATR(alertData: AlertData, settings: any): { tp1Price?: number; tp2Price?: number; tp3Price?: number } {
  const atrMultiplier = settings.atr_tp_multiplier;
  
  const tp1Price = alertData.side === 'BUY'
    ? alertData.price + (alertData.atr * atrMultiplier)
    : alertData.price - (alertData.atr * atrMultiplier);

  let tp2Price, tp3Price;
  if (settings.tp_levels >= 2) {
    const tp2Mult = settings.atr_tp2_multiplier || (atrMultiplier * 1.5);
    tp2Price = alertData.side === 'BUY'
      ? alertData.price + (alertData.atr * tp2Mult)
      : alertData.price - (alertData.atr * tp2Mult);
  }
  if (settings.tp_levels >= 3) {
    const tp3Mult = settings.atr_tp3_multiplier || (atrMultiplier * 2);
    tp3Price = alertData.side === 'BUY'
      ? alertData.price + (alertData.atr * tp3Mult)
      : alertData.price - (alertData.atr * tp3Mult);
  }

  return { tp1Price, tp2Price, tp3Price };
}

// ============= SCALPING MODE CALCULATION =============
function calculateScalpingSLTP(
  alertData: AlertData,
  settings: any,
  effectiveLeverage: number
): { sl_price: number; tp1_price?: number; tp2_price?: number; tp3_price?: number } {
  const maxMargin = settings.max_margin_per_trade || 2;
  const maxLoss = settings.max_loss_per_trade || 1;
  const slMin = (settings.sl_percent_min || 0.3) / 100;
  const slMax = (settings.sl_percent_max || 2.0) / 100;

  let slPercent = maxLoss / (maxMargin * effectiveLeverage);

  if (slPercent < slMin) {
    slPercent = slMin;
  } else if (slPercent > slMax) {
    slPercent = slMax;
  }

  const slDistance = alertData.price * slPercent;
  const slPrice = alertData.side === 'BUY'
    ? alertData.price - slDistance
    : alertData.price + slDistance;

  // Calculate TP prices using RR ratios
  const tp1Distance = slDistance * (settings.tp1_rr_ratio || 1.5);
  const tp1Price = alertData.side === 'BUY'
    ? alertData.price + tp1Distance
    : alertData.price - tp1Distance;

  let tp2Price, tp3Price;
  if (settings.tp_levels >= 2) {
    const tp2Distance = slDistance * (settings.tp2_rr_ratio || 2.5);
    tp2Price = alertData.side === 'BUY'
      ? alertData.price + tp2Distance
      : alertData.price - tp2Distance;
  }
  if (settings.tp_levels >= 3) {
    const tp3Distance = slDistance * (settings.tp3_rr_ratio || 3.5);
    tp3Price = alertData.side === 'BUY'
      ? alertData.price + tp3Distance
      : alertData.price - tp3Distance;
  }

  return { sl_price: slPrice, tp1_price: tp1Price, tp2_price: tp2Price, tp3_price: tp3Price };
}

// Check if resync is needed
function checkIfResyncNeeded(
  slOrders: any[],
  tpOrders: any[],
  expected: ExpectedSLTP,
  settings: any,
  position: any
): { mismatch: boolean; reason: string } {
  // Check SL - must have exactly 1
  if (slOrders.length !== 1) {
    return { mismatch: true, reason: `Expected 1 SL order, found ${slOrders.length}` };
  }
  
  const actualSlPrice = Number(slOrders[0].triggerPrice);
  const isBuy = position.side === 'BUY';
  
  // SPECIAL CASE: If position has tp filled and sl_to_breakeven enabled, allow SL at entry price
  const triggerTP = settings.breakeven_trigger_tp || 1;
  const shouldBeAtBreakeven = settings.sl_to_breakeven && (
    (triggerTP === 1 && position.tp1_filled) ||
    (triggerTP === 2 && position.tp2_filled) ||
    (triggerTP === 3 && position.tp3_filled)
  );
  
  if (shouldBeAtBreakeven) {
    // Check if SL is at breakeven or better (more protective)
    const slAtBEOrBetter = isBuy 
      ? actualSlPrice >= position.entry_price * 0.9999 // Allow small tolerance
      : actualSlPrice <= position.entry_price * 1.0001;
      
    if (slAtBEOrBetter) {
      console.log(`✅ SL at breakeven or better - no resync needed`);
      // SL is at breakeven or better - don't flag as mismatch
      // Continue to check TPs...
    } else {
      // SL should be at BE but it's not - flag for correction
      return { 
        mismatch: true, 
        reason: `SL should be at breakeven (${position.entry_price.toFixed(4)}) but is at ${actualSlPrice}` 
      };
    }
  } else {
    // Normal SL check when not at breakeven
    const slPriceDiff = Math.abs(actualSlPrice - expected.sl_price) / expected.sl_price;
    if (slPriceDiff > 0.005) { // ✅ PART 5: Increased from 0.001 (0.1%) to 0.005 (0.5%) tolerance
      return { 
        mismatch: true, 
        reason: `SL price mismatch: expected=${expected.sl_price.toFixed(4)}, actual=${actualSlPrice}, diff=${(slPriceDiff * 100).toFixed(4)}%` 
      };
    }
  }
  
  // ✅ PART 5: Check if DB has order_ids and orders exist on exchange - skip resync if valid
  const slOrderExists = position.sl_order_id && slOrders.some((o: any) => o.orderId === position.sl_order_id);
  const tp1OrderExists = !position.tp1_price || position.tp1_filled || (position.tp1_order_id && tpOrders.some((o: any) => o.orderId === position.tp1_order_id));
  const tp2OrderExists = !position.tp2_price || position.tp2_filled || (position.tp2_order_id && tpOrders.some((o: any) => o.orderId === position.tp2_order_id));
  const tp3OrderExists = !position.tp3_price || position.tp3_filled || (position.tp3_order_id && tpOrders.some((o: any) => o.orderId === position.tp3_order_id));
  
  if (slOrderExists && tp1OrderExists && tp2OrderExists && tp3OrderExists) {
    console.log(`✅ All orders from DB exist on exchange by order_id - skipping resync`);
    return { mismatch: false, reason: '' };
  }
  
  // Check TP count - must match tp_levels MINUS filled TPs
  let expectedTPCount = settings.tp_levels || 1;
  
  // Subtract already filled TPs
  if (position.tp1_filled) expectedTPCount--;
  if (position.tp2_filled && settings.tp_levels >= 2) expectedTPCount--;
  if (position.tp3_filled && settings.tp_levels >= 3) expectedTPCount--;
  
  const validTPOrders = tpOrders.filter((o: any) => o.tradeSide === 'close');
  
  if (validTPOrders.length !== expectedTPCount) {
    return { 
      mismatch: true, 
      reason: `Expected ${expectedTPCount} TP orders (filled: TP1=${position.tp1_filled || false}, TP2=${position.tp2_filled || false}, TP3=${position.tp3_filled || false}), found ${validTPOrders.length}` 
    };
  }
  
  // Check each TP price and quantity
  for (let i = 1; i <= expectedTPCount; i++) {
    const expectedPrice = expected[`tp${i}_price` as keyof ExpectedSLTP] as number | undefined;
    const expectedQty = expected[`tp${i}_quantity` as keyof ExpectedSLTP] as number | undefined;
    
    if (!expectedPrice || !expectedQty) continue;
    
    const matchingTP = validTPOrders.find((o: any) => {
      const priceDiff = Math.abs(Number(o.triggerPrice) - expectedPrice) / expectedPrice;
      const qtyDiff = Math.abs(Number(o.size) - expectedQty) / expectedQty;
      return priceDiff < 0.005 && qtyDiff < 0.05; // ✅ PART 5: Increased from 0.1%/2% to 0.5%/5% tolerance
    });
    
    if (!matchingTP) {
      return { 
        mismatch: true, 
        reason: `TP${i} not found: expected price=${expectedPrice.toFixed(4)}, qty=${expectedQty.toFixed(4)}` 
      };
    }
  }
  
  return { mismatch: false, reason: '' };
}

// Helper function to move SL to breakeven after TP hit
async function moveSlToBreakeven(
  supabase: any, 
  position: any, 
  apiCredentials: any,
  pricePlace: number
): Promise<boolean> {
  const entryPrice = Number(position.entry_price);
  const currentSlPrice = Number(position.sl_price);
  const isBuy = position.side === 'BUY';
  
  // Check if SL already at BE or better
  const slAlreadyAtBE = isBuy 
    ? currentSlPrice >= entryPrice 
    : currentSlPrice <= entryPrice;
    
  if (slAlreadyAtBE) {
    console.log(`✅ SL already at breakeven or better for ${position.symbol} (current: ${currentSlPrice}, entry: ${entryPrice})`);
    return true;
  }
  
  // Add small buffer (0.01%) to avoid closing exactly at entry
  const beBuffer = entryPrice * 0.0001;
  const newSlPrice = isBuy ? entryPrice + beBuffer : entryPrice - beBuffer;
  
  console.log(`🔄 Moving SL to breakeven: ${position.symbol} ${currentSlPrice} → ${newSlPrice}`);
  
  try {
    // 1. Cancel existing SL order
    if (position.sl_order_id) {
      console.log(`🗑️ Canceling existing SL order: ${position.sl_order_id}`);
      const { data: cancelResult } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'cancel_plan_order',
          params: { 
            symbol: position.symbol, 
            orderId: position.sl_order_id,
            planType: 'pos_loss'
          },
          apiCredentials
        }
      });
      
      if (!cancelResult?.success) {
        console.warn(`⚠️ Failed to cancel SL order, continuing anyway...`);
      }
    }
    
    // 2. Place new SL at breakeven
    const roundedSlPrice = roundPrice(newSlPrice, pricePlace);
    const holdSide = isBuy ? 'long' : 'short';
    
    console.log(`📊 Placing new SL at breakeven: ${roundedSlPrice}`);
    const { data: newSlResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'place_tpsl_order',
        params: {
          symbol: position.symbol,
          planType: 'pos_loss',
          triggerPrice: roundedSlPrice,
          triggerType: 'mark_price',
          holdSide: holdSide,
          executePrice: 0,
        },
        apiCredentials
      }
    });
    
    // 3. Update DB
    if (newSlResult?.success && newSlResult.data?.orderId) {
      await supabase
        .from('positions')
        .update({
          sl_price: newSlPrice,
          sl_order_id: newSlResult.data.orderId,
          metadata: {
            ...position.metadata,
            sl_moved_to_breakeven: true,
            sl_moved_at: new Date().toISOString()
          }
        })
        .eq('id', position.id);
      
      console.log(`✅ SL moved to breakeven successfully: ${newSlPrice} (order: ${newSlResult.data.orderId})`);
      
      await log({
        functionName: 'position-monitor',
        message: `SL moved to breakeven after TP hit`,
        level: 'info',
        positionId: position.id,
        metadata: { 
          symbol: position.symbol,
          old_sl: currentSlPrice,
          new_sl: newSlPrice,
          entry_price: entryPrice
        }
      });
      
      return true;
    } else {
      console.error(`❌ Failed to place breakeven SL:`, newSlResult);
      await log({
        functionName: 'position-monitor',
        message: `Failed to move SL to breakeven`,
        level: 'error',
        positionId: position.id,
        metadata: { 
          symbol: position.symbol,
          error: newSlResult?.error || 'Unknown error'
        }
      });
      return false;
    }
  } catch (error) {
    console.error(`❌ Error moving SL to breakeven:`, error);
    await log({
      functionName: 'position-monitor',
      message: `Error moving SL to breakeven`,
      level: 'error',
      positionId: position.id,
      metadata: { 
        symbol: position.symbol,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    });
    return false;
  }
}

// Helper function to log deviations (when they exist but are within tolerance)
async function logDeviations(
  supabase: any,
  position: any,
  expected: ExpectedSLTP,
  slOrders: any[],
  tpOrders: any[]
) {
  const deviations: any[] = [];
  const tolerance = 0.001; // 0.1% tolerance
  
  // Check SL deviations
  if (slOrders.length === 1) {
    const actualSlPrice = Number(slOrders[0].triggerPrice);
    const priceDiff = Math.abs(actualSlPrice - expected.sl_price) / expected.sl_price;
    
    if (priceDiff > 0.00001 && priceDiff <= tolerance) {
      deviations.push({
        type: 'SL',
        label: 'Stop Loss',
        planned: expected.sl_price,
        actual: actualSlPrice,
        deviation_percent: (priceDiff * 100).toFixed(4)
      });
    }
  }
  
  // Check TP deviations
  for (let i = 1; i <= 3; i++) {
    const expectedPrice = expected[`tp${i}_price` as keyof ExpectedSLTP] as number | undefined;
    const expectedQty = expected[`tp${i}_quantity` as keyof ExpectedSLTP] as number | undefined;
    
    if (!expectedPrice || !expectedQty) continue;
    
    const matchingTP = tpOrders.find((o: any) => {
      const priceDiff = Math.abs(Number(o.triggerPrice) - expectedPrice) / expectedPrice;
      return priceDiff < 0.01; // Find the matching TP order
    });
    
    if (matchingTP) {
      const actualPrice = Number(matchingTP.triggerPrice);
      const actualQty = Number(matchingTP.size);
      
      const priceDiff = Math.abs(actualPrice - expectedPrice) / expectedPrice;
      const qtyDiff = Math.abs(actualQty - expectedQty) / expectedQty;
      
      // Log if there's a deviation within tolerance
      if (priceDiff > 0.00001 && priceDiff <= tolerance) {
        deviations.push({
          type: `TP${i}_PRICE`,
          label: `Take Profit ${i} Price`,
          planned: expectedPrice,
          actual: actualPrice,
          deviation_percent: (priceDiff * 100).toFixed(4)
        });
      }
      
      if (qtyDiff > 0.00001 && qtyDiff <= 0.01) { // 1% tolerance for quantity
        deviations.push({
          type: `TP${i}_QTY`,
          label: `Take Profit ${i} Quantity`,
          planned: expectedQty,
          actual: actualQty,
          deviation_percent: (qtyDiff * 100).toFixed(4)
        });
      }
    }
  }
  
  // Only log if we found deviations
  if (deviations.length > 0) {
    // Check if there's a recent deviation log with the same issues
    const { data: lastDeviation } = await supabase
      .from('monitoring_logs')
      .select('issues')
      .eq('position_id', position.id)
      .eq('check_type', 'deviations')
      .order('created_at', { ascending: false })
      .limit(1)
      .single();
    
    // Only insert if:
    // 1. No previous deviation exists, OR
    // 2. The deviations are different
    const shouldLog = !lastDeviation || 
      JSON.stringify(lastDeviation.issues) !== JSON.stringify(deviations);
    
    if (shouldLog) {
      await supabase.from('monitoring_logs').insert({
        check_type: 'deviations',
        position_id: position.id,
        status: 'detected',
        issues: deviations
      });
    }
  }
}

// Helper function to clean up orphan orders (orders without open positions)
async function cleanupOrphanOrders(supabase: any, userId: string, apiCredentials: any, exchangePositions: any[]) {
  console.log(`🧹 Checking for orphan orders for user ${userId}`);
  
  // Get ALL plan orders from exchange (both types)
  const { data: profitLossOrders } = await supabase.functions.invoke('bitget-api', {
    body: {
      action: 'get_plan_orders',
      params: { planType: 'profit_loss' },
      apiCredentials
    }
  });
  
  const { data: normalPlanOrders } = await supabase.functions.invoke('bitget-api', {
    body: {
      action: 'get_plan_orders',
      params: { planType: 'normal_plan' },
      apiCredentials
    }
  });
  
  const allOrders = [
    ...(profitLossOrders?.success && profitLossOrders.data?.entrustedList || []),
    ...(normalPlanOrders?.success && normalPlanOrders.data?.entrustedList || [])
  ].filter((o: any) => o.planStatus === 'live');
  
  // Get unique symbols from orders
  const orderSymbols = [...new Set(allOrders.map((o: any) => o.symbol.toUpperCase()))];
  
  // Get symbols with open positions
  const positionSymbols = exchangePositions.map((p: any) => p.symbol.toUpperCase());
  
  // Find orders for symbols WITHOUT positions
  const orphanOrders = allOrders.filter((order: any) => 
    !positionSymbols.includes(order.symbol.toUpperCase())
  );
  
  if (orphanOrders.length > 0) {
    console.log(`🚨 Found ${orphanOrders.length} orphan orders to cancel`);
    
    for (const order of orphanOrders) {
      try {
        const { data: cancelResult } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'cancel_plan_order',
            params: {
              symbol: order.symbol,
              orderId: order.orderId,
              planType: order.planType
            },
            apiCredentials
          }
        });
        
        if (cancelResult?.success) {
          console.log(`✅ Canceled orphan order ${order.orderId} for ${order.symbol}`);
          await log({
            functionName: 'position-monitor',
            message: `Orphan order canceled`,
            level: 'info',
            metadata: { 
              orderId: order.orderId, 
              symbol: order.symbol,
              planType: order.planType 
            }
          });
        }
      } catch (error) {
        console.error(`❌ Failed to cancel orphan order ${order.orderId}:`, error);
      }
    }
  } else {
    console.log(`✅ No orphan orders found`);
  }
}

// Helper function to recover orphan position from exchange
async function recoverOrphanPosition(
  supabase: any, 
  exchangePosition: any, 
  apiCredentials: any, 
  userId: string,
  userSettings: any
) {
  const symbol = exchangePosition.symbol;
  const side = exchangePosition.holdSide === 'long' ? 'BUY' : 'SELL';
  const entryPrice = parseFloat(exchangePosition.openPriceAvg || exchangePosition.averageOpenPrice);
  const quantity = parseFloat(exchangePosition.total);
  const leverage = parseInt(exchangePosition.leverage || '20');
  
  console.log(`🔄 RECOVERING orphan position: ${symbol} ${side}, qty=${quantity}, entry=${entryPrice}`);
  
  try {
    // 1. Get symbol precision
    const { pricePlace, volumePlace } = await getSymbolPrecision(supabase, symbol, apiCredentials);
    
    // 2. Prepare position data for SL/TP calculation
    const positionData = {
      entry_price: entryPrice,
      sl_price: entryPrice, // placeholder - will be calculated
      tp1_price: null,
      tp2_price: null,
      tp3_price: null,
      quantity,
      leverage,
      side,
      tp1_filled: false,
      tp2_filled: false,
      tp3_filled: false,
      metadata: { 
        atr: entryPrice * 0.01, // estimated ATR as 1% of price
        effective_leverage: leverage,
        strength: 0.5
      }
    };
    
    // 3. Calculate SL/TP according to user settings
    const calculated = calculateExpectedSLTP(positionData, userSettings);
    
    // ============= PART B4: INSERT WITH ON CONFLICT HANDLING =============
    // 4. Try to create position record in DB (atomic insert)
    const { data: newPosition, error: insertError } = await supabase
      .from('positions')
      .insert({
        user_id: userId,
        symbol,
        side,
        entry_price: entryPrice,
        quantity,
        leverage,
        sl_price: calculated.sl_price,
        tp1_price: calculated.tp1_price,
        tp1_quantity: calculated.tp1_quantity,
        tp2_price: calculated.tp2_price,
        tp2_quantity: calculated.tp2_quantity,
        tp3_price: calculated.tp3_price,
        tp3_quantity: calculated.tp3_quantity,
        status: 'open',
        metadata: {
          recovered: true,
          recovered_at: new Date().toISOString(),
          original_exchange_data: exchangePosition
        }
      })
      .select()
      .single();
    
    // Handle unique violation (concurrent insert)
    if (insertError?.code === '23505') {
      console.log(`⚠️ Position already exists (concurrent insert) - fetching existing`);
      const { data: existing } = await supabase
        .from('positions')
        .select('*')
        .eq('user_id', userId)
        .eq('symbol', symbol)
        .eq('side', side)
        .eq('status', 'open')
        .single();
      
      if (existing) {
        console.log(`✅ Using existing position: ${existing.id}`);
        return existing;
      }
    }
    
    if (insertError && insertError.code !== '23505') {
      console.error(`❌ Failed to create recovered position:`, insertError);
      await log({
        functionName: 'position-monitor',
        message: `Failed to recover orphan position`,
        level: 'error',
        metadata: { symbol, error: insertError.message }
      });
      return null;
    }
    
    // 5. Check for existing SL/TP orders on exchange
    const { data: ordersResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_plan_orders',
        params: { symbol, planType: 'profit_loss' },
        apiCredentials
      }
    });
    
    const existingOrders = ordersResult?.data?.entrustedList?.filter(
      (o: any) => o.symbol.toLowerCase() === symbol.toLowerCase() && o.planStatus === 'live'
    ) || [];
    
    // 6. If no SL/TP orders exist - place them
    if (existingOrders.length === 0) {
      console.log(`📊 No existing SL/TP orders - placing new ones for recovered position`);
      
      // Place SL order
      const { data: slResult } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'place_tpsl_order',
          params: {
            symbol,
            planType: 'loss_plan',
            triggerPrice: roundPrice(calculated.sl_price, pricePlace),
            holdSide: side === 'BUY' ? 'long' : 'short',
            size: quantity.toFixed(volumePlace)
          },
          apiCredentials
        }
      });
      
      if (slResult?.success) {
        await supabase.from('positions').update({
          sl_order_id: slResult.data?.orderId
        }).eq('id', newPosition.id);
        console.log(`✅ SL order placed: ${slResult.data?.orderId}`);
      }
      
      // Place TP1 order
      if (calculated.tp1_price && calculated.tp1_quantity) {
        const { data: tp1Result } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'place_tpsl_order',
            params: {
              symbol,
              planType: 'profit_plan',
              triggerPrice: roundPrice(calculated.tp1_price, pricePlace),
              holdSide: side === 'BUY' ? 'long' : 'short',
              size: calculated.tp1_quantity.toFixed(volumePlace)
            },
            apiCredentials
          }
        });
        
        if (tp1Result?.success) {
          await supabase.from('positions').update({
            tp1_order_id: tp1Result.data?.orderId
          }).eq('id', newPosition.id);
          console.log(`✅ TP1 order placed: ${tp1Result.data?.orderId}`);
        }
      }
      
      // Place TP2 order
      if (calculated.tp2_price && calculated.tp2_quantity) {
        const { data: tp2Result } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'place_tpsl_order',
            params: {
              symbol,
              planType: 'profit_plan',
              triggerPrice: roundPrice(calculated.tp2_price, pricePlace),
              holdSide: side === 'BUY' ? 'long' : 'short',
              size: calculated.tp2_quantity.toFixed(volumePlace)
            },
            apiCredentials
          }
        });
        
        if (tp2Result?.success) {
          await supabase.from('positions').update({
            tp2_order_id: tp2Result.data?.orderId
          }).eq('id', newPosition.id);
          console.log(`✅ TP2 order placed: ${tp2Result.data?.orderId}`);
        }
      }
      
      // Place TP3 order
      if (calculated.tp3_price && calculated.tp3_quantity) {
        const { data: tp3Result } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'place_tpsl_order',
            params: {
              symbol,
              planType: 'profit_plan',
              triggerPrice: roundPrice(calculated.tp3_price, pricePlace),
              holdSide: side === 'BUY' ? 'long' : 'short',
              size: calculated.tp3_quantity.toFixed(volumePlace)
            },
            apiCredentials
          }
        });
        
        if (tp3Result?.success) {
          await supabase.from('positions').update({
            tp3_order_id: tp3Result.data?.orderId
          }).eq('id', newPosition.id);
          console.log(`✅ TP3 order placed: ${tp3Result.data?.orderId}`);
        }
      }
    } else {
      console.log(`📊 Found ${existingOrders.length} existing orders - position recovered with existing protection`);
    }
    
    // 7. Log success
    await log({
      functionName: 'position-monitor',
      message: `✅ Orphan position RECOVERED: ${symbol}`,
      level: 'info',
      positionId: newPosition.id,
      metadata: { 
        symbol, side, entryPrice, quantity, leverage,
        sl_price: calculated.sl_price,
        tp1_price: calculated.tp1_price,
        existing_orders: existingOrders.length
      }
    });
    
    await supabase.from('monitoring_logs').insert({
      check_type: 'orphan_recovered',
      position_id: newPosition.id,
      status: 'completed',
      actions_taken: JSON.stringify({
        symbol, side, entryPrice, quantity,
        sl_price: calculated.sl_price,
        tp1_price: calculated.tp1_price,
        tp2_price: calculated.tp2_price,
        tp3_price: calculated.tp3_price
      })
    });
    
    return newPosition;
  } catch (error) {
    console.error(`❌ Error recovering orphan position ${symbol}:`, error);
    await log({
      functionName: 'position-monitor',
      message: `Error recovering orphan position`,
      level: 'error',
      metadata: { 
        symbol,
        error: error instanceof Error ? error.message : 'Unknown error'
      }
    });
    return null;
  }
}

// Helper function to mark position as closed in DB
async function markPositionAsClosed(supabase: any, position: any, reason: string) {
  console.log(`⚠️ Marking position ${position.symbol} as closed in DB: ${reason}`);
  
  // Get user API keys to cancel remaining orders
  const userKeys = await getUserApiKeys(position.user_id);
  if (userKeys) {
    const apiCredentials = {
      apiKey: userKeys.apiKey,
      secretKey: userKeys.secretKey,
      passphrase: userKeys.passphrase
    };
    
    // Fetch ALL orders for this symbol from exchange
    const { data: ordersResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_plan_orders',
        params: { symbol: position.symbol },
        apiCredentials
      }
    });
    
    const allOrders = ordersResult?.success && ordersResult.data?.entrustedList
      ? ordersResult.data.entrustedList.filter((o: any) => 
          o.symbol.toLowerCase() === position.symbol.toLowerCase() &&
          o.planStatus === 'live'
        )
      : [];
    
    console.log(`🗑️ Found ${allOrders.length} remaining orders to cancel for ${position.symbol}`);
    
    // Cancel each order
    for (const order of allOrders) {
      try {
        const { data: cancelResult } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'cancel_plan_order',
            params: {
              symbol: position.symbol,
              orderId: order.orderId,
              planType: order.planType
            },
            apiCredentials
          }
        });
        
        if (cancelResult?.success) {
          console.log(`✅ Canceled orphan order ${order.orderId} (${order.planType})`);
        } else {
          console.warn(`⚠️ Failed to cancel order ${order.orderId}:`, cancelResult?.error);
        }
      } catch (error) {
        console.error(`❌ Error canceling order ${order.orderId}:`, error);
      }
    }
  }
  
  // Then update position in DB
  const { error: updateError } = await supabase
    .from('positions')
    .update({
      status: 'closed',
      close_reason: reason,
      closed_at: new Date().toISOString(),
      close_price: position.current_price || position.entry_price,
      realized_pnl: position.unrealized_pnl || 0
    })
    .eq('id', position.id)
    .eq('user_id', position.user_id);
  
  if (updateError) {
    console.error(`❌ Failed to mark position as closed:`, updateError);
    return;
  }
  
  console.log(`✅ Position ${position.symbol} marked as closed in DB`);
  
  await log({
    functionName: 'position-monitor',
    message: `Position marked as closed: ${reason}`,
    level: 'warn',
    positionId: position.id,
    metadata: { symbol: position.symbol, reason }
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ============= PART B3: ATOMIC LOCKING MECHANISM =============
    // Generate unique instance ID for this run
    const instanceId = crypto.randomUUID();
    
    // Try to acquire lock (atomic upsert)
    await supabase
      .from('monitor_locks')
      .upsert({
        lock_type: 'position_monitor',
        instance_id: instanceId,
        acquired_at: new Date().toISOString(),
        expires_at: new Date(Date.now() + 120000).toISOString()
      }, { 
        onConflict: 'lock_type',
        ignoreDuplicates: true  // If lock exists, do nothing
      });

    // Check if WE own the lock
    const { data: ourLock } = await supabase
      .from('monitor_locks')
      .select('instance_id')
      .eq('lock_type', 'position_monitor')
      .single();

    if (ourLock?.instance_id !== instanceId) {
      console.log('⏳ Another instance holds the lock, skipping');
      return new Response(JSON.stringify({ 
        skipped: true, 
        reason: 'Another instance holds the lock',
        ourInstance: instanceId,
        lockOwner: ourLock?.instance_id
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`🔒 Lock acquired by instance ${instanceId}`);

    await log({
      functionName: 'position-monitor',
      message: '🔥 OKO SAURONA: Starting monitoring cycle',
      level: 'info',
      metadata: { instanceId }
    });
    console.log('🔥 OKO SAURONA: Starting position monitoring cycle');

    // NEW APPROACH: Start from exchange, not DB
    // Get all users with active API keys
    const { data: activeUsers, error: usersError } = await supabase
      .from('user_api_keys')
      .select('user_id')
      .eq('is_active', true);

    if (usersError) {
      throw new Error(`Failed to fetch active users: ${usersError.message}`);
    }

    if (!activeUsers || activeUsers.length === 0) {
      console.log('No active users with API keys');
      
      // Release lock before returning
      await supabase
        .from('monitor_locks')
        .delete()
        .eq('lock_type', 'position_monitor')
        .eq('instance_id', instanceId);
      
      return new Response(JSON.stringify({ message: 'No active users' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`🔥 Monitoring ${activeUsers.length} active users`);
    let totalPositionsChecked = 0;

    // Process each user
    for (const { user_id } of activeUsers) {
      try {
        console.log(`\n🔥 Processing user ${user_id}`);
        
        // Get user API keys
        const userKeys = await getUserApiKeys(user_id);
        if (!userKeys) {
          console.log(`⚠️ User ${user_id} has no valid API keys, skipping`);
          continue;
        }

        const apiCredentials = {
          apiKey: userKeys.apiKey,
          secretKey: userKeys.secretKey,
          passphrase: userKeys.passphrase
        };

        // Get user settings
        const userSettings = await getUserSettings(user_id);

        // STEP 1: Get ALL positions from EXCHANGE
        const { data: exchangePositionsResult, error: exchangeError } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'get_positions',
            apiCredentials
          }
        });

        // CRITICAL: Validate API response before any sync operations
        if (exchangeError || !exchangePositionsResult?.success) {
          console.error(`❌ API error getting positions from exchange - SKIPPING user sync to prevent data loss`);
          await log({
            functionName: 'position-monitor',
            message: 'API error - skipping user sync',
            level: 'error',
            metadata: { 
              userId: user_id, 
              error: exchangeError?.message || exchangePositionsResult?.error || 'Unknown API error'
            }
          });
          continue; // Skip this user entirely - don't close positions based on failed API response
        }

        const exchangePositions = exchangePositionsResult.data
          ? exchangePositionsResult.data.filter((p: any) => parseFloat(p.total || '0') > 0)
          : [];

        console.log(`📊 Exchange API response: success=${exchangePositionsResult?.success}, positions=${exchangePositions.length}`);

        // STEP 2: Get ALL open positions from DB for this user
        const { data: dbPositions } = await supabase
          .from('positions')
          .select('*')
          .eq('user_id', user_id)
          .eq('status', 'open');

        const dbPositionsList = dbPositions || [];
        console.log(`📊 Found ${dbPositionsList.length} positions in DB for user ${user_id}`);

        // STEP 3: SYNC - For each position on EXCHANGE
        for (const exchPos of exchangePositions) {
          try {
            // Find matching position in DB
            const dbMatch = dbPositionsList.find(p => 
              p.symbol === exchPos.symbol && 
              ((p.side === 'BUY' && exchPos.holdSide === 'long') || 
               (p.side === 'SELL' && exchPos.holdSide === 'short'))
            );

            if (!dbMatch) {
              // ORPHAN on exchange - RECOVER it!
              console.log(`🔄 ORPHAN position on exchange - RECOVERING: ${exchPos.symbol} ${exchPos.holdSide}`);
              await recoverOrphanPosition(supabase, exchPos, apiCredentials, user_id, userSettings);
              totalPositionsChecked++;
            } else {
              // Position exists in both - check SL/TP orders
              console.log(`✅ Matched position: ${dbMatch.symbol} ${dbMatch.side}`);
              await checkPositionFullVerification(supabase, dbMatch, userSettings);
              totalPositionsChecked++;
            }
          } catch (error) {
            console.error(`Error syncing exchange position ${exchPos.symbol}:`, error);
            await log({
              functionName: 'position-monitor',
              message: `Error syncing exchange position`,
              level: 'error',
              metadata: { 
                symbol: exchPos.symbol, 
                error: error instanceof Error ? error.message : 'Unknown error' 
              }
            });
          }
        }

        // SAFETY CHECK: If exchange shows 0 positions but DB has many, something is wrong
        if (exchangePositions.length === 0 && dbPositionsList.length > 0) {
          console.warn(`⚠️ SAFETY: Exchange returned 0 positions but DB has ${dbPositionsList.length} - NOT auto-closing to prevent data loss`);
          await log({
            functionName: 'position-monitor',
            message: 'Safety check: Skipping auto-close due to empty exchange response',
            level: 'warn',
            metadata: { 
              userId: user_id, 
              dbPositions: dbPositionsList.length,
              exchangePositions: 0
            }
          });
          continue; // Skip closing positions for this user
        }

        // STEP 4: SYNC - For each position in DB that's NOT on exchange
        for (const dbPos of dbPositionsList) {
          try {
            const exchMatch = exchangePositions.find((e: any) => 
              e.symbol === dbPos.symbol && 
              ((dbPos.side === 'BUY' && e.holdSide === 'long') || 
               (dbPos.side === 'SELL' && e.holdSide === 'short'))
            );

            if (!exchMatch) {
              // DOUBLE CHECK: Verify this specific position directly before closing
              console.log(`⚠️ Position in DB but not in main exchange list: ${dbPos.symbol} - verifying...`);
              
              const { data: verifyResult } = await supabase.functions.invoke('bitget-api', {
                body: {
                  action: 'get_position',
                  params: { symbol: dbPos.symbol },
                  apiCredentials
                }
              });
              
              const verifiedEmpty = verifyResult?.success && 
                (!verifyResult.data || verifyResult.data.length === 0 ||
                 !verifyResult.data.some((p: any) => 
                   parseFloat(p.total || '0') > 0 &&
                   ((dbPos.side === 'BUY' && p.holdSide === 'long') ||
                    (dbPos.side === 'SELL' && p.holdSide === 'short'))
                 ));
              
              if (verifiedEmpty) {
                console.log(`✅ Double-verified: ${dbPos.symbol} truly not on exchange - marking as closed`);
                await markPositionAsClosed(supabase, dbPos, 'not_found_on_exchange');
              } else {
                console.warn(`⚠️ Verification inconclusive for ${dbPos.symbol} - NOT closing to be safe`);
                await log({
                  functionName: 'position-monitor',
                  message: 'Position verification inconclusive - skipped closing',
                  level: 'warn',
                  positionId: dbPos.id,
                  metadata: { 
                    symbol: dbPos.symbol,
                    verifySuccess: verifyResult?.success,
                    verifyDataLength: verifyResult?.data?.length
                  }
                });
              }
            }
          } catch (error) {
            console.error(`Error processing DB position ${dbPos.symbol}:`, error);
            await log({
              functionName: 'position-monitor',
              message: `Error processing DB position`,
              level: 'error',
              positionId: dbPos.id,
              metadata: { 
                symbol: dbPos.symbol, 
                error: error instanceof Error ? error.message : 'Unknown error' 
              }
            });
          }
        }

        // STEP 5: Clean up orphan orders (orders without open positions)
        await cleanupOrphanOrders(supabase, user_id, apiCredentials, exchangePositions);

      } catch (error) {
        console.error(`Error processing user ${user_id}:`, error);
        await log({
          functionName: 'position-monitor',
          message: `Error processing user`,
          level: 'error',
          metadata: { 
            userId: user_id, 
            error: error instanceof Error ? error.message : 'Unknown error' 
          }
        });
      }
    }

    await log({
      functionName: 'position-monitor',
      message: '🔥 OKO SAURONA: Monitoring cycle completed',
      level: 'info',
      metadata: { positionsChecked: totalPositionsChecked }
    });

    // Release lock (delete from monitor_locks)
    await supabase
      .from('monitor_locks')
      .delete()
      .eq('lock_type', 'position_monitor')
      .eq('instance_id', instanceId);
    
    console.log(`🔓 Lock released by instance ${instanceId}`);

    return new Response(JSON.stringify({ 
      success: true, 
      positions_checked: totalPositionsChecked 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    // Release lock on error (delete from monitor_locks)
    try {
      const supabase = createClient(
        Deno.env.get('SUPABASE_URL') ?? '',
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
      );
      
      await supabase
        .from('monitor_locks')
        .delete()
        .eq('lock_type', 'position_monitor');
      
      console.log(`🔓 Lock released on error`);
    } catch (lockError) {
      console.error('Failed to release lock on error:', lockError);
    }

    await log({
      functionName: 'position-monitor',
      message: 'Monitor cycle failed',
      level: 'error',
      metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
    });
    console.error('Monitor error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function checkPositionFullVerification(supabase: any, position: any, settings: any) {
  console.log(`🔥 Full verification for ${position.id} - ${position.symbol}`);

  // Get user API keys
  const userKeys = await getUserApiKeys(position.user_id);
  if (!userKeys) {
    throw new Error('User API keys not found or inactive');
  }

  const apiCredentials = {
    apiKey: userKeys.apiKey,
    secretKey: userKeys.secretKey,
    passphrase: userKeys.passphrase
  };

  const issues: any[] = [];
  const actions: string[] = [];
  
  // Get price and volume precision for this symbol
  const { pricePlace, volumePlace } = await getSymbolPrecision(supabase, position.symbol, apiCredentials);
  console.log(`📏 Precision for ${position.symbol}: price=${pricePlace}, volume=${volumePlace} decimals`);

  // 1. Get current position from Bitget with retry logic
  let positionResult: any = null;
  let retryCount = 0;
  const maxRetries = 3;
  
  while (retryCount < maxRetries) {
    const { data } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_position',
        params: { symbol: position.symbol },
        apiCredentials
      }
    });
    
    if (data?.success && data.data?.[0]) {
      positionResult = data;
      break;
    }
    
    retryCount++;
    if (retryCount < maxRetries) {
      console.log(`⚠️ Retry ${retryCount}/${maxRetries} for get_position: ${position.symbol}`);
      await new Promise(r => setTimeout(r, 1000)); // Wait 1s between retries
    }
  }

  // If still not found after retries, verify with get_positions (all positions)
  if (!positionResult?.success || !positionResult.data || !positionResult.data[0]) {
    console.log(`⚠️ Position not found after ${maxRetries} retries, checking all positions...`);
    
    const { data: allPositionsResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_positions',
        apiCredentials
      }
    });
    
    // Check if position exists in all positions list
    const foundInAll = allPositionsResult?.success && allPositionsResult.data?.some((p: any) => 
      p.symbol === position.symbol && parseFloat(p.total || '0') > 0
    );
    
    if (foundInAll) {
      console.log(`✅ Position ${position.symbol} found in get_positions - likely API issue, skipping`);
      await log({
        functionName: 'position-monitor',
        message: `Position found in get_positions but not in get_position - skipping close`,
        level: 'warn',
        positionId: position.id,
        metadata: { symbol: position.symbol }
      });
      return;
    }
    
    // Final verification: check fill history for recent closure
    console.log(`⚠️ Position not in all positions, checking fill history...`);
    const now = Date.now();
    const fiveMinutesAgo = now - (5 * 60 * 1000);
    
    const { data: historyResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_history_positions',
        params: { 
          symbol: position.symbol,
          startTime: fiveMinutesAgo.toString(),
          endTime: now.toString()
        },
        apiCredentials
      }
    });
    
    const recentClose = historyResult?.success && historyResult.data?.some((h: any) => 
      h.symbol === position.symbol && 
      h.tradeSide === 'close' &&
      parseInt(h.cTime) > fiveMinutesAgo
    );
    
    if (!recentClose) {
      console.log(`⚠️ No recent closure found in history - API may be unreliable, NOT closing position`);
      await log({
        functionName: 'position-monitor',
        message: `Position not found but no closure confirmation - skipping auto-close to prevent false closure`,
        level: 'error',
        positionId: position.id,
        metadata: { 
          symbol: position.symbol,
          retriesAttempted: maxRetries,
          message: 'Manual verification required'
        }
      });
      
      // Increment check errors but don't close
      await supabase
        .from('positions')
        .update({
          check_errors: (position.check_errors || 0) + 1,
          last_error: 'Position not found on exchange but no closure confirmation',
          last_check_at: new Date().toISOString(),
        })
        .eq('id', position.id)
        .eq('user_id', position.user_id);
      
      return;
    }
    
    // Confirmed closure - proceed with closing logic
    await log({
      functionName: 'position-monitor',
      message: `❌ Position confirmed closed on exchange: ${position.symbol}`,
      level: 'warn',
      positionId: position.id
    });
    
    // Position already closed on exchange - try to determine why
    let closeReason = 'unknown';
    
    // Get current price to determine direction
    const { data: tickerResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_ticker',
        params: { symbol: position.symbol },
        apiCredentials
      }
    });
    
    const currentPrice = tickerResult?.success && tickerResult.data?.[0]
      ? Number(tickerResult.data[0].lastPr)
      : Number(position.entry_price);
    
    const entryPrice = Number(position.entry_price);
    const slPrice = Number(position.sl_price);
    const isBuy = position.side === 'BUY';
    
    // Determine close reason based on price movement
    if (isBuy) {
      if (currentPrice <= slPrice * 1.005) {
        closeReason = 'sl_hit';
      } else if (position.tp3_price && currentPrice >= Number(position.tp3_price) * 0.995) {
        closeReason = 'tp3_hit';
      } else if (position.tp2_price && currentPrice >= Number(position.tp2_price) * 0.995) {
        closeReason = 'tp2_hit';
      } else if (position.tp1_price && currentPrice >= Number(position.tp1_price) * 0.995) {
        closeReason = 'tp1_hit';
      } else if (currentPrice > entryPrice) {
        closeReason = 'tp_hit';
      } else {
        closeReason = 'sl_hit';
      }
    } else {
      if (currentPrice >= slPrice * 0.995) {
        closeReason = 'sl_hit';
      } else if (position.tp3_price && currentPrice <= Number(position.tp3_price) * 1.005) {
        closeReason = 'tp3_hit';
      } else if (position.tp2_price && currentPrice <= Number(position.tp2_price) * 1.005) {
        closeReason = 'tp2_hit';
      } else if (position.tp1_price && currentPrice <= Number(position.tp1_price) * 1.005) {
        closeReason = 'tp1_hit';
      } else if (currentPrice < entryPrice) {
        closeReason = 'tp_hit';
      } else {
        closeReason = 'sl_hit';
      }
    }
    
    // Calculate PnL
    const priceDiff = isBuy
      ? currentPrice - entryPrice
      : entryPrice - currentPrice;
    const realizedPnl = priceDiff * Number(position.quantity);
    
    console.log(`📊 Position ${position.symbol} closed on exchange. Determined reason: ${closeReason}, PnL: ${realizedPnl.toFixed(2)}`);
    
    await log({
      functionName: 'position-monitor',
      message: `Position closed on exchange: ${closeReason}`,
      level: 'info',
      positionId: position.id,
      metadata: { closeReason, realizedPnl, currentPrice }
    });
    
    // Update position in DB with proper close reason and PnL
    await supabase
      .from('positions')
      .update({
        status: 'closed',
        close_reason: closeReason,
        close_price: currentPrice,
        realized_pnl: realizedPnl,
        closed_at: new Date().toISOString()
      })
      .eq('id', position.id)
      .eq('user_id', position.user_id);
    
    // Update performance metrics
    const today = new Date().toISOString().split('T')[0];
    const { data: existingMetrics } = await supabase
      .from('performance_metrics')
      .select('*')
      .eq('date', today)
      .eq('symbol', position.symbol)
      .single();

    if (existingMetrics) {
      await supabase
        .from('performance_metrics')
        .update({
          total_trades: existingMetrics.total_trades + 1,
          winning_trades: realizedPnl > 0 ? existingMetrics.winning_trades + 1 : existingMetrics.winning_trades,
          losing_trades: realizedPnl < 0 ? existingMetrics.losing_trades + 1 : existingMetrics.losing_trades,
          total_pnl: Number(existingMetrics.total_pnl) + realizedPnl,
        })
        .eq('id', existingMetrics.id);
    } else {
      await supabase
        .from('performance_metrics')
        .insert({
          date: today,
          symbol: position.symbol,
          total_trades: 1,
          winning_trades: realizedPnl > 0 ? 1 : 0,
          losing_trades: realizedPnl < 0 ? 1 : 0,
          total_pnl: realizedPnl,
        });
    }
    
    return;
  }

  const bitgetPosition = positionResult.data[0];
  
  // 2. Get current price
  const { data: tickerResult } = await supabase.functions.invoke('bitget-api', {
    body: {
      action: 'get_ticker',
      params: { symbol: position.symbol },
      apiCredentials
    }
  });

  if (!tickerResult?.success || !tickerResult.data || !tickerResult.data[0]) {
    throw new Error('Failed to get ticker data');
  }

  const currentPrice = Number(tickerResult.data[0].lastPr);
  console.log(`Current price for ${position.symbol}: ${currentPrice}`);

  // Get all open orders - fetch BOTH profit_loss and normal_plan types
  const { data: profitLossResult } = await supabase.functions.invoke('bitget-api', {
    body: {
      action: 'get_plan_orders',
      params: { 
        symbol: position.symbol,
        planType: 'profit_loss'
      },
      apiCredentials
    }
  });

  const { data: normalPlanResult } = await supabase.functions.invoke('bitget-api', {
    body: {
      action: 'get_plan_orders',
      params: { 
        symbol: position.symbol,
        planType: 'normal_plan'
      },
      apiCredentials
    }
  });

  const profitLossOrders = profitLossResult?.success && profitLossResult.data?.entrustedList
    ? profitLossResult.data.entrustedList.filter((o: any) => 
        o.symbol.toLowerCase() === position.symbol.toLowerCase() && 
        o.planStatus === 'live'
      )
    : [];
    
  const normalPlanOrders = normalPlanResult?.success && normalPlanResult.data?.entrustedList
    ? normalPlanResult.data.entrustedList.filter((o: any) => 
        o.symbol.toLowerCase() === position.symbol.toLowerCase() && 
        o.planStatus === 'live'
      )
    : [];

  const planOrders = [...profitLossOrders, ...normalPlanOrders];
  console.log(`Found ${planOrders.length} plan orders for ${position.symbol} (profit_loss: ${profitLossOrders.length}, normal_plan: ${normalPlanOrders.length})`);

  // 4. Check quantity match and detect partial closes (TP hits)
  const bitgetQuantity = Number(bitgetPosition.total || 0);
  const dbQuantity = Number(position.quantity);
  
  // Detect partial close (TP was hit)
  if (bitgetQuantity < dbQuantity * 0.99) {
    console.log(`📉 Detected partial close: DB=${dbQuantity}, Exchange=${bitgetQuantity}`);
    
    const closedQty = dbQuantity - bitgetQuantity;
    const tp1Qty = Number(position.tp1_quantity || 0);
    const tp2Qty = Number(position.tp2_quantity || 0);
    const tp3Qty = Number(position.tp3_quantity || 0);
    
    const updates: any = { quantity: bitgetQuantity };
    
    // Check which TP was filled based on closed quantity
    // Check TP3 first (highest), then TP2, then TP1
    if (position.tp3_quantity && !position.tp3_filled && Math.abs(closedQty - tp3Qty) / tp3Qty < 0.1) {
      updates.tp3_filled = true;
      console.log(`✅ TP3 was filled - marking tp3_filled = true`);
    } else if (position.tp2_quantity && !position.tp2_filled && Math.abs(closedQty - tp2Qty) / tp2Qty < 0.1) {
      updates.tp2_filled = true;
      console.log(`✅ TP2 was filled - marking tp2_filled = true`);
    } else if (position.tp1_quantity && !position.tp1_filled && Math.abs(closedQty - tp1Qty) / tp1Qty < 0.1) {
      updates.tp1_filled = true;
      console.log(`✅ TP1 was filled - marking tp1_filled = true`);
    }
    
    // Update DB with actual quantity and filled flags
    await supabase
      .from('positions')
      .update(updates)
      .eq('id', position.id)
      .eq('user_id', position.user_id);
    
    await log({
      functionName: 'position-monitor',
      message: `Partial close detected and TP marked as filled`,
      level: 'info',
      positionId: position.id,
      metadata: { closedQty, updates }
    });
    
    // Update position object with new values for rest of the function
    position.quantity = bitgetQuantity;
    if (updates.tp1_filled) position.tp1_filled = true;
    if (updates.tp2_filled) position.tp2_filled = true;
    if (updates.tp3_filled) position.tp3_filled = true;
    
    // MOVE SL TO BREAKEVEN if enabled
    if (settings.sl_to_breakeven) {
      const triggerTP = settings.breakeven_trigger_tp || 1;
      const shouldMoveBE = 
        (triggerTP === 1 && updates.tp1_filled) ||
        (triggerTP === 2 && updates.tp2_filled) ||
        (triggerTP === 3 && updates.tp3_filled);
      
      if (shouldMoveBE) {
        console.log(`🔄 TP${triggerTP} filled - moving SL to breakeven`);
        await moveSlToBreakeven(supabase, position, apiCredentials, pricePlace);
      }
    }
  } else if (Math.abs(bitgetQuantity - dbQuantity) > 0.0001) {
    issues.push({
      type: 'quantity_mismatch',
      expected: dbQuantity,
      actual: bitgetQuantity,
      severity: 'high'
    });
    console.log(`⚠️ Quantity mismatch: DB=${dbQuantity}, Bitget=${bitgetQuantity}`);
  }

  // 5. VALIDATION & RESYNC LOGIC
  // Calculate expected SL/TP from current user settings
  const expected = calculateExpectedSLTP(position, settings);
  
  // Round expected values to exchange precision BEFORE comparison to prevent resync loop
  // This ensures expected values match what will actually be placed on exchange
  expected.sl_price = parseFloat(roundPrice(expected.sl_price, pricePlace));
  
  if (expected.tp1_price) {
    expected.tp1_price = parseFloat(roundPrice(expected.tp1_price, pricePlace));
  }
  if (expected.tp1_quantity) {
    expected.tp1_quantity = Math.floor(expected.tp1_quantity * Math.pow(10, volumePlace)) / Math.pow(10, volumePlace);
  }
  
  if (expected.tp2_price) {
    expected.tp2_price = parseFloat(roundPrice(expected.tp2_price, pricePlace));
  }
  if (expected.tp2_quantity) {
    expected.tp2_quantity = Math.floor(expected.tp2_quantity * Math.pow(10, volumePlace)) / Math.pow(10, volumePlace);
  }
  
  if (expected.tp3_price) {
    expected.tp3_price = parseFloat(roundPrice(expected.tp3_price, pricePlace));
  }
  if (expected.tp3_quantity) {
    expected.tp3_quantity = Math.floor(expected.tp3_quantity * Math.pow(10, volumePlace)) / Math.pow(10, volumePlace);
  }
  
  console.log(`📊 Expected from settings (rounded): SL=${expected.sl_price.toFixed(4)}, TP1=${expected.tp1_price?.toFixed(4)} (qty=${expected.tp1_quantity?.toFixed(6)}), TP2=${expected.tp2_price?.toFixed(4)} (qty=${expected.tp2_quantity?.toFixed(6)}), TP3=${expected.tp3_price?.toFixed(4)} (qty=${expected.tp3_quantity?.toFixed(6)})`);
  
  // Separate SL and TP orders
  const slOrders = planOrders.filter((order: any) => 
    (order.planType === 'pos_loss' || order.planType === 'loss_plan' || 
     (order.planType === 'profit_loss' && order.stopLossTriggerPrice)) &&
    order.planStatus === 'live'
  );
  
  const tpOrders = planOrders.filter((order: any) => 
    (order.planType === 'pos_profit' || order.planType === 'profit_plan' || order.planType === 'normal_plan') &&
    order.planStatus === 'live'
  );
  
  // Check if resync is needed
  const resyncCheck = checkIfResyncNeeded(slOrders, tpOrders, expected, settings, position);
  
  // Log deviations BEFORE resync (if deviations exist but within tolerance)
  await logDeviations(supabase, position, expected, slOrders, tpOrders);
  
  // ✅ PART 6: RESYNC COOLDOWN - Check if position was recently resynced
  const lastResync = (position.metadata as any)?.last_resync_at;
  const resyncCount = (position.metadata as any)?.resync_count || 0;
  const fiveMinutesAgo = Date.now() - 5 * 60 * 1000;
  
  if (lastResync && new Date(lastResync).getTime() > fiveMinutesAgo && resyncCheck.mismatch) {
    console.log(`⏳ Position was resynced ${Math.floor((Date.now() - new Date(lastResync).getTime()) / 1000)}s ago - skipping resync (cooldown)`);
    resyncCheck.mismatch = false;
    resyncCheck.reason = 'cooldown';
  }
  
  if (resyncCount >= 3 && resyncCheck.mismatch) {
    console.log(`⚠️ Position has been resynced ${resyncCount} times - flagging for manual review`);
    await log({
      functionName: 'position-monitor',
      message: `Position resynced ${resyncCount} times - needs manual review`,
      level: 'warn',
      positionId: position.id,
      metadata: { resync_count: resyncCount }
    });
  }
  
  if (resyncCheck.mismatch) {
    console.log(`🔄 RESYNC NEEDED for ${position.symbol}: ${resyncCheck.reason}`);
    await log({
      functionName: 'position-monitor',
      message: `Resync triggered: ${resyncCheck.reason}`,
      level: 'warn',
      positionId: position.id,
      metadata: { expected, currentOrders: planOrders.length }
    });
    
    // STEP 1: Cancel ALL existing SL/TP orders (with verification)
    console.log(`🗑️ Canceling all ${planOrders.length} existing orders...`);
    for (const order of planOrders) {
      const { data: cancelResult, error: cancelError } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'cancel_plan_order',
          params: {
            symbol: position.symbol,
            orderId: order.orderId,
            planType: order.planType
          },
          apiCredentials
        }
      });
      
      if (cancelError || !cancelResult?.success) {
        const errorMsg = cancelError?.message || cancelResult?.error || 'Unknown cancel error';
        console.error(`❌ Failed to cancel order ${order.orderId}:`, errorMsg);
        throw new Error(`Failed to cancel order ${order.orderId}: ${errorMsg}`);
      }
      
      console.log(`✅ Canceled order ${order.orderId} (${order.planType})`);
    }
    
    // Wait a bit for cancellations to process
    await new Promise(r => setTimeout(r, 500));
    
    // STEP 2: Update position in DB with expected values
    const updateData: any = {
      sl_price: expected.sl_price,
      sl_order_id: null,
      updated_at: new Date().toISOString(),
      // ✅ PART 6: Update metadata with resync info
      metadata: {
        ...position.metadata,
        last_resync_at: new Date().toISOString(),
        resync_count: (position.metadata?.resync_count || 0) + 1
      }
    };
    
    if (expected.tp1_price) {
      updateData.tp1_price = expected.tp1_price;
      updateData.tp1_quantity = expected.tp1_quantity;
      updateData.tp1_order_id = null;
    }
    if (expected.tp2_price && settings.tp_levels >= 2) {
      updateData.tp2_price = expected.tp2_price;
      updateData.tp2_quantity = expected.tp2_quantity;
      updateData.tp2_order_id = null;
    }
    if (expected.tp3_price && settings.tp_levels >= 3) {
      updateData.tp3_price = expected.tp3_price;
      updateData.tp3_quantity = expected.tp3_quantity;
      updateData.tp3_order_id = null;
    }
    
    await supabase
      .from('positions')
      .update(updateData)
      .eq('id', position.id)
      .eq('user_id', position.user_id);
    
    console.log(`💾 Updated position in DB with new expected values and resync metadata`);
    
    // STEP 3: Place NEW orders using correct types (pos_loss, pos_profit)
    const holdSide = position.side === 'BUY' ? 'long' : 'short';
    
    // ============= PART A3: SL PRICE VALIDATION =============
    // Check if price already passed SL level
    const slAlreadyTriggered = isPriceBeyondLevel(currentPrice, expected.sl_price, position.side, 'SL');
    
    if (slAlreadyTriggered) {
      console.log(`🚨 CRITICAL: Price ${currentPrice} already past SL ${expected.sl_price} - closing position immediately!`);
      
      // Get current position size from exchange
      const { data: posData } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'get_position',
          params: { symbol: position.symbol },
          apiCredentials
        }
      });
      
      const exchangePosition = posData?.data?.find((p: any) => 
        p.holdSide === (position.side === 'BUY' ? 'long' : 'short')
      );
      
      if (exchangePosition && parseFloat(exchangePosition.total) > 0) {
        // Close entire remaining position at market with retry logic
        let closeSuccess = false;
        let lastError = null;
        
        // STEP 1: Try flash_close_position (dedicated close endpoint) - 3 attempts
        console.log(`⚡ Attempting emergency SL close via flash_close_position...`);
        for (let attempt = 1; attempt <= 3; attempt++) {
          const { data: flashResult, error } = await supabase.functions.invoke('bitget-api', {
            body: {
              action: 'flash_close_position',
              params: {
                symbol: position.symbol,
                holdSide: holdSide,
                size: exchangePosition.total
              },
              apiCredentials
            }
          });
          
          if (flashResult?.success) {
            closeSuccess = true;
            console.log(`✅ Flash close successful on attempt ${attempt}`);
            break;
          }
          
          lastError = error || flashResult;
          console.error(`❌ Flash close attempt ${attempt}/3 failed:`, lastError);
          
          if (attempt < 3) {
            await new Promise(resolve => setTimeout(resolve, 500));
          }
        }
        
        // STEP 2: Fallback to close_position (market order) - 3 attempts
        if (!closeSuccess) {
          console.log(`⚠️ Flash close failed, trying market close...`);
          for (let attempt = 1; attempt <= 3; attempt++) {
            const { data: closeResult, error } = await supabase.functions.invoke('bitget-api', {
              body: {
                action: 'close_position',
                params: {
                  symbol: position.symbol,
                  side: position.side === 'BUY' ? 'long' : 'short',
                  size: exchangePosition.total
                },
                apiCredentials
              }
            });
            
            if (closeResult?.success) {
              closeSuccess = true;
              console.log(`✅ Market close successful on attempt ${attempt}`);
              break;
            }
            
            lastError = error || closeResult;
            console.error(`❌ Market close attempt ${attempt}/3 failed:`, lastError);
            
            if (attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }
        
        if (closeSuccess) {
          // Mark position as closed
          await markPositionAsClosed(supabase, position, 'sl_hit_delayed');
          
          await log({
            functionName: 'position-monitor',
            message: `🚨 Emergency close - SL already breached at ${currentPrice}`,
            level: 'warn',
            positionId: position.id,
            metadata: { expected_sl: expected.sl_price, current_price: currentPrice }
          });
          
          console.log(`✅ Emergency close executed - SL was already breached`);
          actions.push(`Emergency close - SL already hit (price: ${currentPrice})`);
          return;
        } else {
          // STEP 3: Last resort - LIMIT order at current market price
          console.log(`⚠️ Both flash and market close failed, placing LIMIT order as last resort...`);
          
          const ticker = tickerResult.data[0];
          const currentMarketPrice = parseFloat(ticker.lastPr);
          const slippageTolerance = 0.001; // 0.1% slippage
          
          // Apply slippage: for short position (SL is above), buy slightly above current price
          // for long position (SL is below), sell slightly below current price
          const limitPrice = holdSide === 'long' 
            ? currentMarketPrice * (1 - slippageTolerance)  // Sell slightly below for long
            : currentMarketPrice * (1 + slippageTolerance); // Buy slightly above for short
          
          const roundedLimitPrice = roundPrice(limitPrice, pricePlace);
          
          const { data: limitOrderResult } = await supabase.functions.invoke('bitget-api', {
            body: {
              action: 'place_order',
              params: {
                symbol: position.symbol,
                side: holdSide,
                size: exchangePosition.total,
                price: roundedLimitPrice,
                orderType: 'limit',
                reduceOnly: 'YES',
              },
              apiCredentials
            }
          });
          
          if (limitOrderResult?.success) {
            await log({
              functionName: 'position-monitor',
              message: `✅ Placed LIMIT order for emergency SL at market price ${roundedLimitPrice}`,
              level: 'warn',
              positionId: position.id,
              metadata: { 
                expected_sl: expected.sl_price,
                current_price: currentMarketPrice,
                limit_price: roundedLimitPrice,
                order_id: limitOrderResult.data?.orderId 
              }
            });
            
            console.log(`✅ LIMIT order placed for emergency SL at ${roundedLimitPrice}`);
            actions.push(`LIMIT order for SL at market price ${roundedLimitPrice}`);
            return;
          } else {
            // CRITICAL: Even LIMIT order failed
            await log({
              functionName: 'position-monitor',
              message: `🚨 CRITICAL: Failed to place LIMIT order for emergency SL`,
              level: 'error',
              positionId: position.id,
              metadata: { 
                expected_sl: expected.sl_price, 
                current_price: currentMarketPrice,
                limit_price: roundedLimitPrice,
                position_size: exchangePosition.total,
                last_error: lastError,
                limit_result: limitOrderResult
              }
            });
            
            console.error(`🚨 CRITICAL: Emergency SL LIMIT order also failed - position remains open!`);
            return;
          }
        }
      }
    }
    
    // Normal SL placement (price hasn't reached SL yet)
    console.log(`🔧 Placing SL order at ${expected.sl_price.toFixed(4)}...`);
    const roundedSlPrice = roundPrice(expected.sl_price, pricePlace);
    const { data: newSlResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'place_tpsl_order',
        params: {
          symbol: position.symbol,
          planType: 'pos_loss',
          triggerPrice: roundedSlPrice,
          triggerType: 'mark_price',
          holdSide: holdSide,
          executePrice: 0,
        },
        apiCredentials
      }
    });
    
    if (newSlResult?.success) {
      await supabase
        .from('positions')
        .update({ sl_order_id: newSlResult.data.orderId })
        .eq('id', position.id)
        .eq('user_id', position.user_id);
      console.log(`✅ SL order placed: ${newSlResult.data.orderId}`);
      actions.push('Placed new SL order after resync');
    } else {
      console.error(`❌ Failed to place SL:`, newSlResult);
    }
    
    // ============= PART A2: TP ORDERS WITH PRICE VALIDATION =============
    for (let i = 1; i <= settings.tp_levels; i++) {
      // SKIP already filled TPs
      const tpFilledKey = `tp${i}_filled` as 'tp1_filled' | 'tp2_filled' | 'tp3_filled';
      if (position[tpFilledKey] === true) {
        console.log(`⏭️ Skipping TP${i} - already filled`);
        continue;
      }
      
      const tpPrice = expected[`tp${i}_price` as keyof ExpectedSLTP] as number | undefined;
      const tpQty = expected[`tp${i}_quantity` as keyof ExpectedSLTP] as number | undefined;
      
      if (!tpPrice || !tpQty) continue;
      
      // Check if price already passed this TP level
      const priceAlreadyPastTP = isPriceBeyondLevel(currentPrice, tpPrice, position.side, 'TP');
      
      if (priceAlreadyPastTP) {
        console.log(`⚠️ Price ${currentPrice} already past TP${i} ${tpPrice} - executing immediate partial close`);
        
        // Round quantity to volumePlace precision
        const roundedQty = Math.floor(tpQty * Math.pow(10, volumePlace)) / Math.pow(10, volumePlace);
        
        // Execute immediate close with retry logic
        let closeSuccess = false;
        let lastError = null;
        
        // ✅ PART 3: Use executeVerifiedClose with position size verification
        console.log(`⚡ Attempting verified TP${i} close with position size verification...`);
        const closeResult = await executeVerifiedClose(
          supabase, 
          position, 
          roundedQty, 
          holdSide, 
          apiCredentials, 
          pricePlace, 
          volumePlace
        );
        
        if (closeResult.success) {
          console.log(`✅ Verified close: ${closeResult.actualClosedQty} units closed via ${closeResult.method}`);
          
          // ✅ PART 3: Only mark as filled if verified close was successful
          await supabase
            .from('positions')
            .update({ [tpFilledKey]: true })
            .eq('id', position.id);
          
          await log({
            functionName: 'position-monitor',
            message: `✅ Immediate TP${i} close - price already past level (verified)`,
            level: 'info',
            positionId: position.id,
            metadata: { 
              current_price: currentPrice, 
              tp_price: tpPrice, 
              quantity: roundedQty,
              actual_closed: closeResult.actualClosedQty,
              method: closeResult.method
            }
          });
          
          console.log(`✅ Verified immediate partial close executed for TP${i}`);
          actions.push(`Immediate TP${i} close (verified: ${closeResult.actualClosedQty} units)`);
          
          // Check if SL should move to breakeven after this TP
          if (settings.sl_to_breakeven && i >= (settings.breakeven_trigger_tp || 1)) {
            await moveSlToBreakeven(supabase, position, apiCredentials, pricePlace);
          }
          
          closeSuccess = true;
        } else {
          console.error(`❌ Failed to verify TP${i} close - NOT marking as filled`);
          lastError = `Verified close failed - method: ${closeResult.method}`;
        }
        
        // STEP 2: Fallback to close_position (market order) - 3 attempts
        if (!closeSuccess) {
          console.log(`⚠️ Flash close failed, trying market close...`);
          for (let attempt = 1; attempt <= 3; attempt++) {
            const { data: closeResult, error } = await supabase.functions.invoke('bitget-api', {
              body: {
                action: 'close_position',
                params: {
                  symbol: position.symbol,
                  side: holdSide,
                  size: roundedQty.toString()
                },
                apiCredentials
              }
            });
            
            if (closeResult?.success) {
              closeSuccess = true;
              console.log(`✅ Market close successful on attempt ${attempt}`);
              
              // Mark this TP as filled
              await supabase
                .from('positions')
                .update({ [tpFilledKey]: true })
                .eq('id', position.id);
              
              await log({
                functionName: 'position-monitor',
                message: `✅ Immediate TP${i} close - price already past level`,
                level: 'info',
                positionId: position.id,
                metadata: { 
                  current_price: currentPrice, 
                  tp_price: tpPrice, 
                  quantity: roundedQty 
                }
              });
              
              console.log(`✅ Immediate partial close executed for TP${i} (price ${currentPrice} past ${tpPrice})`);
              actions.push(`Immediate TP${i} close (price ${currentPrice} past ${tpPrice})`);
              
              // Check if SL should move to breakeven after this TP
              if (settings.sl_to_breakeven && i >= (settings.breakeven_trigger_tp || 1)) {
                await moveSlToBreakeven(supabase, position, apiCredentials, pricePlace);
              }
              
              break;
            }
            
            lastError = error || closeResult;
            console.error(`❌ Market close attempt ${attempt}/3 failed:`, lastError);
            
            if (attempt < 3) {
              await new Promise(resolve => setTimeout(resolve, 500));
            }
          }
        }
        
        if (closeSuccess) {
          continue; // Skip placing order - close was successful
        } else {
          // STEP 3: Last resort - LIMIT order at current market price
          console.log(`⚠️ Both flash and market close failed, placing LIMIT order as last resort...`);
          
          const ticker = tickerResult.data[0];
          const currentMarketPrice = parseFloat(ticker.lastPr);
          const slippageTolerance = 0.001; // 0.1% slippage
          
          // Apply slippage: for long position TP (sell), slightly below current price
          // for short position TP (buy), slightly above current price
          const limitPrice = holdSide === 'long' 
            ? currentMarketPrice * (1 - slippageTolerance)  // Sell slightly below for long
            : currentMarketPrice * (1 + slippageTolerance); // Buy slightly above for short
          
          const roundedLimitPrice = roundPrice(limitPrice, pricePlace);
          
          const { data: limitOrderResult } = await supabase.functions.invoke('bitget-api', {
            body: {
              action: 'place_order',
              params: {
                symbol: position.symbol,
                side: holdSide,
                size: roundedQty.toString(),
                price: roundedLimitPrice,
                orderType: 'limit',
                reduceOnly: 'YES',
              },
              apiCredentials
            }
          });
          
          if (limitOrderResult?.success) {
            // Mark this TP as filled since we placed the order
            await supabase
              .from('positions')
              .update({ [tpFilledKey]: true })
              .eq('id', position.id);
            
            await log({
              functionName: 'position-monitor',
              message: `✅ Placed LIMIT order for TP${i} at market price ${roundedLimitPrice}`,
              level: 'info',
              positionId: position.id,
              metadata: { 
                current_price: currentMarketPrice,
                tp_price: tpPrice,
                limit_price: roundedLimitPrice,
                quantity: roundedQty,
                order_id: limitOrderResult.data?.orderId 
              }
            });
            
            console.log(`✅ LIMIT order placed for TP${i} at ${roundedLimitPrice}`);
            actions.push(`LIMIT order for TP${i} at market price ${roundedLimitPrice}`);
            
            // Check if SL should move to breakeven after this TP
            if (settings.sl_to_breakeven && i >= (settings.breakeven_trigger_tp || 1)) {
              await moveSlToBreakeven(supabase, position, apiCredentials, pricePlace);
            }
            
            continue;
          } else {
            // CRITICAL: Even LIMIT order failed
            await log({
              functionName: 'position-monitor',
              message: `🚨 CRITICAL: Failed to place LIMIT order for TP${i}`,
              level: 'error',
              positionId: position.id,
              metadata: { 
                current_price: currentMarketPrice,
                tp_price: tpPrice,
                limit_price: roundedLimitPrice,
                quantity: roundedQty,
                last_error: lastError,
                limit_result: limitOrderResult
              }
            });
            
            console.error(`🚨 CRITICAL: TP${i} LIMIT order also failed - NOT placing trigger order`);
            continue;
          }
        }
      }
      
      // Normal TP order placement (price hasn't reached TP yet)
      // Round quantity to volumePlace precision
      const roundedQty = Math.floor(tpQty * Math.pow(10, volumePlace)) / Math.pow(10, volumePlace);
      
      console.log(`🔧 Placing TP${i} order at ${tpPrice.toFixed(4)}, qty=${tpQty.toFixed(4)} → rounded=${roundedQty.toFixed(volumePlace)}...`);
      const roundedTpPrice = roundPrice(tpPrice, pricePlace);
      
      const { data: newTpResult } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'place_plan_order',
          params: {
            symbol: position.symbol,
            planType: 'normal_plan',
            triggerPrice: roundedTpPrice,
            triggerType: 'mark_price',
            side: holdSide === 'long' ? 'sell' : 'buy',
            tradeSide: 'close',
            size: roundedQty.toString(),
          },
          apiCredentials
        }
      });
      
      if (newTpResult?.success && newTpResult.data?.orderId) {
        const updateField = `tp${i}_order_id` as const;
        await supabase
          .from('positions')
          .update({ [updateField]: newTpResult.data.orderId })
          .eq('id', position.id)
          .eq('user_id', position.user_id);
        console.log(`✅ TP${i} order placed: ${newTpResult.data.orderId}`);
        actions.push(`Placed new TP${i} order after resync`);
        
        await log({
          functionName: 'position-monitor',
          message: `TP${i} order placed during resync`,
          level: 'info',
          positionId: position.id,
          metadata: { 
            orderId: newTpResult.data.orderId, 
            price: roundedTpPrice, 
            quantity: roundedQty 
          }
        });
      } else {
        console.error(`❌ Failed to place TP${i}:`, JSON.stringify(newTpResult, null, 2));
        await log({
          functionName: 'position-monitor',
          message: `Failed to place TP${i} during resync`,
          level: 'error',
          positionId: position.id,
          metadata: { 
            response: newTpResult,
            price: roundedTpPrice,
            quantity: roundedQty,
            volumePlace
          }
        });
      }
    }
    
    await log({
      functionName: 'position-monitor',
      message: `Resync complete for ${position.symbol}`,
      level: 'info',
      positionId: position.id,
      metadata: { actions }
    });
    
    // Determine intervention type based on reason
    let checkType = 'tp_repair';
    if (resyncCheck.reason.includes('SL')) {
      checkType = resyncCheck.reason.includes('TP') ? 'sl_repair' : 'sl_repair';
    } else if (resyncCheck.reason.includes('quantity')) {
      checkType = 'emergency_close'; // Quantity mismatches are critical
    }
    
    // Log intervention to monitoring_logs for Diagnostics dashboard
    await supabase.from('monitoring_logs').insert({
      check_type: checkType,
      position_id: position.id,
      status: 'success',
      actions_taken: actions.join('; '),
      issues: [{
        reason: resyncCheck.reason,
        severity: 'high'
      }],
      expected_data: {
        sl_price: expected.sl_price,
        tp1_price: expected.tp1_price,
        tp2_price: expected.tp2_price,
        tp3_price: expected.tp3_price,
        tp1_quantity: expected.tp1_quantity,
        tp2_quantity: expected.tp2_quantity,
        tp3_quantity: expected.tp3_quantity,
      },
      actual_data: {
        sl_orders_count: slOrders.length,
        tp_orders_count: tpOrders.length,
        sl_prices: slOrders.map((o: any) => o.triggerPrice),
        tp_prices: tpOrders.map((o: any) => o.triggerPrice)
      }
    });
    
    // Skip further checks - we just resynced everything
    await supabase
      .from('positions')
      .update({
        last_check_at: new Date().toISOString(),
        current_price: currentPrice,
        unrealized_pnl: (position.side === 'BUY' 
          ? currentPrice - Number(position.entry_price)
          : Number(position.entry_price) - currentPrice) * Number(position.quantity)
      })
      .eq('id', position.id)
      .eq('user_id', position.user_id);
    
    console.log(`✅ Position ${position.symbol} resync complete`);
    return;
  }
  
  console.log(`✅ No resync needed - orders match settings`);

  // Update position last check time
  await supabase
    .from('positions')
    .update({
      last_check_at: new Date().toISOString(),
      current_price: currentPrice,
      unrealized_pnl: (position.side === 'BUY' 
        ? currentPrice - Number(position.entry_price)
        : Number(position.entry_price) - currentPrice) * Number(position.quantity)
    })
    .eq('id', position.id)
    .eq('user_id', position.user_id);

  console.log(`✅ Position ${position.symbol} check complete`);
}
