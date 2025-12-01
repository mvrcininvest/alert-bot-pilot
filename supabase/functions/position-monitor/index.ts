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
// ✅ FIX: Use close_position FIRST (flash_close may ignore size parameter)
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
  
  // 2. Try close_position FIRST with explicit size (more reliable for partial closes)
  console.log(`⚡ Attempting close_position with explicit size=${quantity}`);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const { data: closeResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'close_position',
        params: { 
          symbol: position.symbol, 
          side: holdSide === 'long' ? 'close_long' : 'close_short',
          size: quantity.toString() 
        },
        apiCredentials
      }
    });
    
    if (closeResult?.success) {
      await new Promise(r => setTimeout(r, 500));
      
      const afterSize = await getPositionSizeFromExchange(supabase, position.symbol, holdSide, apiCredentials);
      console.log(`📊 Position size AFTER close_position: ${afterSize} (was: ${beforeSize})`);
      
      if (afterSize < beforeSize * 0.99) {
        const closedQty = beforeSize - afterSize;
        console.log(`✅ Verified close: ${closedQty} units closed via close_position`);
        return { success: true, actualClosedQty: closedQty, method: 'close_position' };
      }
    }
    
    if (attempt < 3) await new Promise(r => setTimeout(r, 500));
  }
  
  // 3. Try flash_close as fallback (may close entire position - use with caution)
  console.warn(`⚠️ close_position failed, trying flash_close (may close more than requested)`);
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
      await new Promise(r => setTimeout(r, 500));
      
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
          side: holdSide === 'long' ? 'close_long' : 'close_short',  // ✅ Explicit format
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

// ============= MINIMUM QUANTITY HELPERS =============
function getMinQuantityForSymbol(symbol: string): number {
  // Minimum quantities from Bitget API (notional values converted to quantity)
  const minQuantities: Record<string, number> = {
    'BTCUSDT': 0.001,
    'ETHUSDT': 0.01,
    'BNBUSDT': 0.01,
    'SOLUSDT': 0.1,
    'XRPUSDT': 1,
    'ADAUSDT': 1,
    'DOGEUSDT': 10,
    'MATICUSDT': 1,
    'DOTUSDT': 0.1,
    'AVAXUSDT': 0.1,
    'LINKUSDT': 0.1,
    'UNIUSDT': 0.1,
    'LTCUSDT': 0.01,
    'ATOMUSDT': 0.1,
    'ETCUSDT': 0.1,
    'XLMUSDT': 10,
    'NEARUSDT': 0.1,
    'ALGOUSDT': 1,
    'TRXUSDT': 1,
    'FILUSDT': 0.1,
  };
  return minQuantities[symbol] || 0.1; // Default minimum
}

// Determine actual TP levels based on quantity constraints
function determineActualTPLevels(
  requestedLevels: number,
  quantity: number,
  minQuantity: number,
  percentages: { tp1: number; tp2: number; tp3: number }
): number {
  if (requestedLevels === 1) {
    return 1;
  }
  
  if (requestedLevels >= 2) {
    // For 3 requested levels, redistribute TP3 to TP1 and TP2
    if (requestedLevels === 3) {
      const redistributed = percentages.tp3 / 2;
      const adjustedTp1Percent = percentages.tp1 + redistributed;
      const adjustedTp2Percent = percentages.tp2 + redistributed;
      
      const tp1Qty = quantity * (adjustedTp1Percent / 100);
      const tp2Qty = quantity * (adjustedTp2Percent / 100);
      
      // Original check - user percentages work directly
      if (tp1Qty >= minQuantity && tp2Qty >= minQuantity) {
        return 2;
      }
      
      // Check if we can split at all (even with different percentages)
      const canSplitAtAll = (quantity / 2) >= minQuantity;
      if (canSplitAtAll) {
        return 2; // Signal: "2 TP possible with redistribution"
      }
    } else {
      // Requested exactly 2 levels
      const tp1Qty = quantity * (percentages.tp1 / 100);
      const tp2Qty = quantity * (percentages.tp2 / 100);
      
      if (tp1Qty >= minQuantity && tp2Qty >= minQuantity) {
        return 2;
      }
      
      const canSplitAtAll = (quantity / 2) >= minQuantity;
      if (canSplitAtAll) {
        return 2;
      }
    }
  }
  
  // Fallback to 1 TP if we can't split
  return 1;
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

interface ResyncResult {
  mismatch: boolean;
  reason: string;
  missingOrders: {
    sl: boolean;
    tp1: boolean;
    tp2: boolean;
    tp3: boolean;
  };
  priceIssues: {
    sl: boolean;
    tp1: boolean;
    tp2: boolean;
    tp3: boolean;
  };
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
    
    // Calculate quantities with smart redistribution if not in DB
    const totalQty = position.quantity;
    const minQuantity = getMinQuantityForSymbol(position.symbol);
    
    if (dbTp1Qty && dbTp2Qty) {
      // ✅ Validate that DB quantities sum to total
      const sumQty = dbTp1Qty + (dbTp2Qty || 0) + (dbTp3Qty || 0);
      const tolerance = 0.0001;
      
      if (Math.abs(sumQty - totalQty) > tolerance) {
        console.log(`⚠️ DB quantities mismatch! Sum=${sumQty} vs Total=${totalQty} (diff=${Math.abs(sumQty - totalQty).toFixed(6)}) - RECALCULATING`);
        // Fall through to recalculate instead of returning DB values
      } else {
        // Use DB quantities as-is - they're valid
        return {
          sl_price: dbSl,
          tp1_price: !position.tp1_filled ? dbTp1 : undefined,
          tp2_price: !position.tp2_filled && dbTp2 ? dbTp2 : undefined,
          tp3_price: !position.tp3_filled && dbTp3 ? dbTp3 : undefined,
          tp1_quantity: dbTp1Qty > 0 ? dbTp1Qty : undefined,
          tp2_quantity: dbTp2Qty > 0 ? dbTp2Qty : undefined,
          tp3_quantity: dbTp3Qty && dbTp3Qty > 0 ? dbTp3Qty : undefined,
        };
      }
    }
    
    // Calculate with smart redistribution using settings_snapshot if available
    const snapshot = position.metadata?.settings_snapshot || settings;
    const actualLevels = determineActualTPLevels(
      snapshot.tp_levels,
      totalQty,
      minQuantity,
      { 
        tp1: snapshot.tp1_close_percent, 
        tp2: snapshot.tp2_close_percent || 0, 
        tp3: snapshot.tp3_close_percent || 0 
      }
    );
    
    let tp1Qty = 0, tp2Qty = 0;
    
    if (actualLevels === 2 && !position.tp1_filled && !position.tp2_filled) {
      const redistributed = (snapshot.tp3_close_percent || 0) / 2;
      let adjustedTp1 = snapshot.tp1_close_percent + redistributed;
      let adjustedTp2 = snapshot.tp2_close_percent + redistributed;
      
      const tp1QtyRaw = totalQty * (adjustedTp1 / 100);
      const tp2QtyRaw = totalQty * (adjustedTp2 / 100);
      
      // Smart redistribution
      if (tp1QtyRaw < minQuantity && tp2QtyRaw >= minQuantity) {
        const minPercent = (minQuantity / totalQty) * 100;
        tp1Qty = minQuantity;
        tp2Qty = totalQty - minQuantity;
        console.log(`⚠️ Smart redistribution: TP1=${minPercent.toFixed(1)}% (${minQuantity}), TP2=${(100-minPercent).toFixed(1)}%`);
      } else if (tp2QtyRaw < minQuantity && tp1QtyRaw >= minQuantity) {
        const minPercent = (minQuantity / totalQty) * 100;
        tp2Qty = minQuantity;
        tp1Qty = totalQty - minQuantity;
        console.log(`⚠️ Smart redistribution: TP1=${(100-minPercent).toFixed(1)}%, TP2=${minPercent.toFixed(1)}% (${minQuantity})`);
      } else if (tp1QtyRaw >= minQuantity && tp2QtyRaw >= minQuantity) {
        tp1Qty = tp1QtyRaw;
        tp2Qty = tp2QtyRaw;
      } else {
        // Both too small - use single TP
        tp1Qty = totalQty;
      }
    } else if (actualLevels === 1 && !position.tp1_filled) {
      tp1Qty = totalQty;
    }
    
    return {
      sl_price: dbSl,
      tp1_price: !position.tp1_filled ? dbTp1 : undefined,
      tp2_price: !position.tp2_filled && dbTp2 ? dbTp2 : undefined,
      tp3_price: !position.tp3_filled && dbTp3 ? dbTp3 : undefined,
      tp1_quantity: tp1Qty > 0 ? tp1Qty : undefined,
      tp2_quantity: tp2Qty > 0 ? tp2Qty : undefined,
      tp3_quantity: undefined, // Not using 3 TPs with smart redistribution
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
    
    // Calculate TPs with smart redistribution
    const totalQty = position.quantity;
    const minQuantity = getMinQuantityForSymbol(position.symbol);
    
    const actualLevels = determineActualTPLevels(
      settings.tp_levels,
      totalQty,
      minQuantity,
      { 
        tp1: settings.tp1_close_percent, 
        tp2: settings.tp2_close_percent || 0, 
        tp3: settings.tp3_close_percent || 0 
      }
    );
    
    let tp1Qty = 0, tp2Qty = 0, tp3Qty = 0;
    
    if (actualLevels === 2) {
      const redistributed = (settings.tp3_close_percent || 0) / 2;
      let adjustedTp1 = settings.tp1_close_percent + redistributed;
      let adjustedTp2 = settings.tp2_close_percent + redistributed;
      
      const tp1QtyRaw = totalQty * (adjustedTp1 / 100);
      const tp2QtyRaw = totalQty * (adjustedTp2 / 100);
      
      if (tp1QtyRaw < minQuantity && tp2QtyRaw >= minQuantity) {
        tp1Qty = !position.tp1_filled ? minQuantity : 0;
        tp2Qty = !position.tp2_filled ? (totalQty - minQuantity) : 0;
      } else if (tp2QtyRaw < minQuantity && tp1QtyRaw >= minQuantity) {
        tp2Qty = !position.tp2_filled ? minQuantity : 0;
        tp1Qty = !position.tp1_filled ? (totalQty - minQuantity) : 0;
      } else if (tp1QtyRaw >= minQuantity && tp2QtyRaw >= minQuantity) {
        tp1Qty = !position.tp1_filled ? tp1QtyRaw : 0;
        tp2Qty = !position.tp2_filled ? tp2QtyRaw : 0;
      } else {
        tp1Qty = !position.tp1_filled ? totalQty : 0;
      }
    } else if (actualLevels === 1) {
      tp1Qty = !position.tp1_filled ? totalQty : 0;
    }
    
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
      tp3_quantity: undefined, // Not using 3 TPs with smart redistribution
    };
  }

  // Check for scalping mode FIRST
  if (settings.position_sizing_type === 'scalping_mode') {
    const effectiveLeverage = (position.metadata as any)?.effective_leverage || position.leverage;
    const { sl_price, tp1_price, tp2_price, tp3_price } = calculateScalpingSLTP(
      alertData, settings, effectiveLeverage
    );
    
    // Calculate quantities with smart redistribution
    const totalQty = position.quantity;
    const minQuantity = getMinQuantityForSymbol(position.symbol);
    
    const actualLevels = determineActualTPLevels(
      settings.tp_levels,
      totalQty,
      minQuantity,
      { 
        tp1: settings.tp1_close_percent, 
        tp2: settings.tp2_close_percent || 0, 
        tp3: settings.tp3_close_percent || 0 
      }
    );
    
    let tp1Qty = 0, tp2Qty = 0, tp3Qty = 0;
    
    if (actualLevels === 2) {
      const redistributed = (settings.tp3_close_percent || 0) / 2;
      let adjustedTp1 = settings.tp1_close_percent + redistributed;
      let adjustedTp2 = settings.tp2_close_percent + redistributed;
      
      const tp1QtyRaw = totalQty * (adjustedTp1 / 100);
      const tp2QtyRaw = totalQty * (adjustedTp2 / 100);
      
      if (tp1QtyRaw < minQuantity && tp2QtyRaw >= minQuantity) {
        tp1Qty = !position.tp1_filled ? minQuantity : 0;
        tp2Qty = !position.tp2_filled ? (totalQty - minQuantity) : 0;
      } else if (tp2QtyRaw < minQuantity && tp1QtyRaw >= minQuantity) {
        tp2Qty = !position.tp2_filled ? minQuantity : 0;
        tp1Qty = !position.tp1_filled ? (totalQty - minQuantity) : 0;
      } else if (tp1QtyRaw >= minQuantity && tp2QtyRaw >= minQuantity) {
        tp1Qty = !position.tp1_filled ? tp1QtyRaw : 0;
        tp2Qty = !position.tp2_filled ? tp2QtyRaw : 0;
      } else {
        tp1Qty = !position.tp1_filled ? totalQty : 0;
      }
    } else if (actualLevels === 1) {
      tp1Qty = !position.tp1_filled ? totalQty : 0;
    }
    
    return {
      sl_price,
      tp1_price: !position.tp1_filled ? tp1_price : undefined,
      tp2_price: !position.tp2_filled ? tp2_price : undefined,
      tp3_price: !position.tp3_filled ? tp3_price : undefined,
      tp1_quantity: tp1Qty > 0 ? tp1Qty : undefined,
      tp2_quantity: tp2Qty > 0 ? tp2Qty : undefined,
      tp3_quantity: undefined, // Not using 3 TPs with smart redistribution
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

  // Calculate TP quantities with smart redistribution
  const totalQty = position.quantity;
  const minQuantity = getMinQuantityForSymbol(position.symbol);
  
  const actualLevels = determineActualTPLevels(
    settings.tp_levels,
    totalQty,
    minQuantity,
    { 
      tp1: settings.tp1_close_percent, 
      tp2: settings.tp2_close_percent || 0, 
      tp3: settings.tp3_close_percent || 0 
    }
  );
  
  let tp1Qty = 0, tp2Qty = 0, tp3Qty = 0;
  
  if (actualLevels === 2) {
    const redistributed = (settings.tp3_close_percent || 0) / 2;
    let adjustedTp1 = settings.tp1_close_percent + redistributed;
    let adjustedTp2 = settings.tp2_close_percent + redistributed;
    
    const tp1QtyRaw = totalQty * (adjustedTp1 / 100);
    const tp2QtyRaw = totalQty * (adjustedTp2 / 100);
    
    if (tp1QtyRaw < minQuantity && tp2QtyRaw >= minQuantity) {
      tp1Qty = !position.tp1_filled ? minQuantity : 0;
      tp2Qty = !position.tp2_filled ? (totalQty - minQuantity) : 0;
      console.log(`⚠️ Smart redistribution (monitor): TP1=${minQuantity}, TP2=${totalQty - minQuantity}`);
    } else if (tp2QtyRaw < minQuantity && tp1QtyRaw >= minQuantity) {
      tp2Qty = !position.tp2_filled ? minQuantity : 0;
      tp1Qty = !position.tp1_filled ? (totalQty - minQuantity) : 0;
      console.log(`⚠️ Smart redistribution (monitor): TP1=${totalQty - minQuantity}, TP2=${minQuantity}`);
    } else if (tp1QtyRaw >= minQuantity && tp2QtyRaw >= minQuantity) {
      tp1Qty = !position.tp1_filled ? tp1QtyRaw : 0;
      tp2Qty = !position.tp2_filled ? tp2QtyRaw : 0;
    } else {
      tp1Qty = !position.tp1_filled ? totalQty : 0;
    }
  } else if (actualLevels === 1) {
    tp1Qty = !position.tp1_filled ? totalQty : 0;
  }

  return {
    sl_price: slPrice,
    tp1_price: !position.tp1_filled ? tp1Price : undefined,
    tp2_price: !position.tp2_filled ? tp2Price : undefined,
    tp3_price: !position.tp3_filled ? tp3Price : undefined,
    tp1_quantity: tp1Qty > 0 ? tp1Qty : undefined,
    tp2_quantity: tp2Qty > 0 ? tp2Qty : undefined,
    tp3_quantity: undefined, // Not using 3 TPs with smart redistribution
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

// Check if resync is needed - returns detailed information about what needs fixing
function checkIfResyncNeeded(
  slOrders: any[],
  tpOrders: any[],
  expected: ExpectedSLTP,
  settings: any,
  position: any
): ResyncResult {
  const result: ResyncResult = {
    mismatch: false,
    reason: '',
    missingOrders: { sl: false, tp1: false, tp2: false, tp3: false },
    priceIssues: { sl: false, tp1: false, tp2: false, tp3: false }
  };
  
  // Check SL - must have exactly 1
  if (slOrders.length !== 1) {
    result.mismatch = true;
    result.missingOrders.sl = true;
    result.reason = `Expected 1 SL order, found ${slOrders.length}`;
    
    // Early return - can't check prices if order doesn't exist
    if (slOrders.length === 0) {
      return result;
    }
  }
  
  const actualSlPrice = Number(slOrders[0]?.triggerPrice || 0);
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
      result.mismatch = true;
      result.priceIssues.sl = true;
      result.reason = `SL should be at breakeven (${position.entry_price.toFixed(4)}) but is at ${actualSlPrice}`;
    }
  } else if (slOrders.length === 1) {
    // Normal SL check when not at breakeven
    const slPriceDiff = Math.abs(actualSlPrice - expected.sl_price) / expected.sl_price;
    if (slPriceDiff > 0.005) { // ✅ PART 5: Increased from 0.001 (0.1%) to 0.005 (0.5%) tolerance
      result.mismatch = true;
      result.priceIssues.sl = true;
      result.reason = `SL price mismatch: expected=${expected.sl_price.toFixed(4)}, actual=${actualSlPrice}, diff=${(slPriceDiff * 100).toFixed(4)}%`;
    }
  }
  
  // ✅ PART 5: Check if DB has order_ids and orders exist on exchange - skip resync if valid
  const slOrderExists = position.sl_order_id && slOrders.some((o: any) => o.orderId === position.sl_order_id);
  const tp1OrderExists = !position.tp1_price || position.tp1_filled || (position.tp1_order_id && tpOrders.some((o: any) => o.orderId === position.tp1_order_id));
  const tp2OrderExists = !position.tp2_price || position.tp2_filled || (position.tp2_order_id && tpOrders.some((o: any) => o.orderId === position.tp2_order_id));
  const tp3OrderExists = !position.tp3_price || position.tp3_filled || (position.tp3_order_id && tpOrders.some((o: any) => o.orderId === position.tp3_order_id));
  
  if (slOrderExists && tp1OrderExists && tp2OrderExists && tp3OrderExists && !result.mismatch) {
    console.log(`✅ All orders from DB exist on exchange by order_id - skipping resync`);
    return result;
  }
  
  // Check TP count - must match tp_levels MINUS filled TPs
  let expectedTPCount = settings.tp_levels || 1;
  
  // Subtract already filled TPs
  if (position.tp1_filled) expectedTPCount--;
  if (position.tp2_filled && settings.tp_levels >= 2) expectedTPCount--;
  if (position.tp3_filled && settings.tp_levels >= 3) expectedTPCount--;
  
  const validTPOrders = tpOrders.filter((o: any) => o.tradeSide === 'close');
  
  if (validTPOrders.length !== expectedTPCount) {
    result.mismatch = true;
    result.reason = `Expected ${expectedTPCount} TP orders (filled: TP1=${position.tp1_filled || false}, TP2=${position.tp2_filled || false}, TP3=${position.tp3_filled || false}), found ${validTPOrders.length}`;
    
    // Determine which specific TPs are missing
    for (let i = 1; i <= settings.tp_levels; i++) {
      const tpFilledKey = `tp${i}_filled` as 'tp1_filled' | 'tp2_filled' | 'tp3_filled';
      const tpPriceKey = `tp${i}_price` as keyof ExpectedSLTP;
      
      if (!position[tpFilledKey] && expected[tpPriceKey]) {
        const tpKey = `tp${i}` as 'tp1' | 'tp2' | 'tp3';
        result.missingOrders[tpKey] = true;
      }
    }
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
      result.mismatch = true;
      const tpKey = `tp${i}` as 'tp1' | 'tp2' | 'tp3';
      result.priceIssues[tpKey] = true;
      result.reason = `TP${i} not found: expected price=${expectedPrice.toFixed(4)}, qty=${expectedQty.toFixed(4)}`;
    }
  }
  
  return result;
}

// Helper function to move SL to breakeven after TP hit
async function moveSlToBreakeven(
  supabase: any, 
  position: any, 
  apiCredentials: any,
  pricePlace: number,
  settings: any
): Promise<boolean> {
  const entryPrice = Number(position.entry_price);
  const currentSlPrice = Number(position.sl_price);
  const isBuy = position.side === 'BUY';
  
  // Determine if fee-aware breakeven is enabled
  const feeAwareBE = settings?.fee_aware_breakeven !== false; // default true
  
  let newSlPrice: number;
  
  if (feeAwareBE) {
    // Fee-aware breakeven: account for 0.12% round-trip fees (0.06% entry + 0.06% exit)
    const feePercent = 0.0012; // 0.12%
    newSlPrice = isBuy 
      ? entryPrice * (1 + feePercent)  // LONG: SL above entry to cover fees
      : entryPrice * (1 - feePercent); // SHORT: SL below entry to cover fees
    
    console.log(`🎯 Fee-Aware BE: ${position.symbol} entry=${entryPrice} → BE=${newSlPrice} (${feePercent * 100}% fee buffer)`);
  } else {
    // Standard breakeven with small buffer (legacy behavior)
    const beBuffer = entryPrice * 0.0001; // 0.01%
    newSlPrice = isBuy ? entryPrice + beBuffer : entryPrice - beBuffer;
    
    console.log(`⚠️ Standard BE: ${position.symbol} entry=${entryPrice} → BE=${newSlPrice} (0.01% buffer, IGNORES FEES)`);
  }
  
  // Check if SL already at target BE or better
  const slAlreadyAtBE = isBuy 
    ? currentSlPrice >= newSlPrice * 0.9999  // Allow small tolerance
    : currentSlPrice <= newSlPrice * 1.0001;
    
  if (slAlreadyAtBE) {
    console.log(`✅ SL already at breakeven or better for ${position.symbol} (current: ${currentSlPrice}, target: ${newSlPrice})`);
    return true;
  }
  
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

// ⚡ ENHANCED: Helper function to clean up orphan orders (orders without open positions + closed position orders)
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
  
  // ⚡ Get ALL positions (open AND closed) with their order IDs
  const { data: allPositions } = await supabase
    .from('positions')
    .select('sl_order_id, tp1_order_id, tp2_order_id, tp3_order_id, status')
    .eq('user_id', userId)
    .in('status', ['open', 'closed']);
  
  // Create a Set of order IDs from OPEN positions only
  const openOrderIds = new Set(
    (allPositions || [])
      .filter((p: any) => p.status === 'open')
      .flatMap((p: any) => [
        p.sl_order_id, 
        p.tp1_order_id, 
        p.tp2_order_id, 
        p.tp3_order_id
      ].filter(Boolean))
  );
  
  // Get order IDs from CLOSED positions (these should be canceled)
  const closedPositionOrderIds = new Set(
    (allPositions || [])
      .filter((p: any) => p.status === 'closed')
      .flatMap((p: any) => [
        p.sl_order_id, 
        p.tp1_order_id, 
        p.tp2_order_id, 
        p.tp3_order_id
      ].filter(Boolean))
  );
  
  console.log(`📋 Found ${openOrderIds.size} order IDs in open positions`);
  console.log(`📋 Found ${closedPositionOrderIds.size} order IDs in closed positions`);
  console.log(`📋 Found ${allOrders.length} live orders on exchange`);
  
  // ⚡ Find orders to cancel: NOT in open positions OR in closed positions
  const ordersToCancel = allOrders.filter((order: any) => 
    !openOrderIds.has(order.orderId) || closedPositionOrderIds.has(order.orderId)
  );
  
  if (ordersToCancel.length > 0) {
    console.log(`🚨 Found ${ordersToCancel.length} orphan/closed orders to cancel`);
    
    for (const order of ordersToCancel) {
      try {
        const reason = closedPositionOrderIds.has(order.orderId) 
          ? 'position closed' 
          : 'orphan (no open position)';
        
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
          console.log(`✅ Canceled order ${order.orderId} for ${order.symbol} (${reason})`);
          await log({
            functionName: 'position-monitor',
            message: `Order canceled: ${reason}`,
            level: 'info',
            metadata: { 
              orderId: order.orderId, 
              symbol: order.symbol,
              planType: order.planType,
              reason 
            }
          });
        }
      } catch (error) {
        console.error(`❌ Failed to cancel order ${order.orderId}:`, error);
      }
    }
  } else {
    console.log(`✅ No orphan or closed position orders found`);
  }
}

// Helper function to recover orphan position from exchange
// NOTE: Orphan positions don't have snapshots, so we MUST use current settings
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
  console.log(`⚠️ Orphan recovery uses CURRENT settings (no snapshot available)`);
  
  
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

// Helper function to determine close reason from price
function determineCloseReasonFromPrice(position: any, closePrice: number): string {
  const ep = Number(position.entry_price);
  const sl = Number(position.sl_price);
  const tp1 = position.tp1_price ? Number(position.tp1_price) : null;
  const tp2 = position.tp2_price ? Number(position.tp2_price) : null;
  const tp3 = position.tp3_price ? Number(position.tp3_price) : null;
  const isBuy = position.side === 'BUY';
  const tolerance = 0.005; // 0.5%
  
  console.log(`🔍 Determining close reason: price=${closePrice}, EP=${ep}, SL=${sl}, TP1=${tp1}, TP2=${tp2}, TP3=${tp3}`);
  console.log(`🔍 TP filled flags: tp1=${position.tp1_filled}, tp2=${position.tp2_filled}, tp3=${position.tp3_filled}`);
  
  // ✅ PRIORITY 1: Check filled flags first (most reliable)
  if (position.tp3_filled) {
    console.log(`📈 Determined: TP3 hit (tp3_filled=true)`);
    return 'tp3_hit';
  }
  if (position.tp2_filled) {
    console.log(`📈 Determined: TP2 hit (tp2_filled=true)`);
    return 'tp2_hit';
  }
  if (position.tp1_filled) {
    console.log(`📈 Determined: TP1 hit (tp1_filled=true)`);
    return 'tp1_hit';
  }
  
  // ✅ PRIORITY 2: Determine from price comparison
  if (isBuy) {
    if (sl && closePrice <= sl * (1 + tolerance)) {
      console.log(`📉 Determined: SL hit (price ${closePrice} <= SL ${sl})`);
      return 'sl_hit';
    }
    if (tp3 && closePrice >= tp3 * (1 - tolerance)) {
      console.log(`📈 Determined: TP3 hit (price ${closePrice} >= TP3 ${tp3})`);
      return 'tp3_hit';
    }
    if (tp2 && closePrice >= tp2 * (1 - tolerance)) {
      console.log(`📈 Determined: TP2 hit (price ${closePrice} >= TP2 ${tp2})`);
      return 'tp2_hit';
    }
    if (tp1 && closePrice >= tp1 * (1 - tolerance)) {
      console.log(`📈 Determined: TP1 hit (price ${closePrice} >= TP1 ${tp1})`);
      return 'tp1_hit';
    }
    return closePrice > ep ? 'manual_profit' : 'manual_loss';
  } else {
    if (sl && closePrice >= sl * (1 - tolerance)) {
      console.log(`📉 Determined: SL hit (price ${closePrice} >= SL ${sl})`);
      return 'sl_hit';
    }
    if (tp3 && closePrice <= tp3 * (1 + tolerance)) {
      console.log(`📈 Determined: TP3 hit (price ${closePrice} <= TP3 ${tp3})`);
      return 'tp3_hit';
    }
    if (tp2 && closePrice <= tp2 * (1 + tolerance)) {
      console.log(`📈 Determined: TP2 hit (price ${closePrice} <= TP2 ${tp2})`);
      return 'tp2_hit';
    }
    if (tp1 && closePrice <= tp1 * (1 + tolerance)) {
      console.log(`📈 Determined: TP1 hit (price ${closePrice} <= TP1 ${tp1})`);
      return 'tp1_hit';
    }
    return closePrice < ep ? 'manual_profit' : 'manual_loss';
  }
}

// Helper function to mark position as closed in DB
async function markPositionAsClosed(supabase: any, position: any, reason: string) {
  console.log(`⚠️ Attempting to mark position ${position.symbol} as closed: ${reason}`);
  
  // ✅ CRITICAL VALIDATION: Check for active TP orders before closing
  const validationKeys = await getUserApiKeys(position.user_id);
  if (validationKeys) {
    const validationCredentials = {
      apiKey: validationKeys.apiKey,
      secretKey: validationKeys.secretKey,
      passphrase: validationKeys.passphrase
    };
    
    // Check for active orders on exchange
    const { data: ordersCheck } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_plan_orders',
        params: { symbol: position.symbol, planType: 'normal_plan' },
        apiCredentials: validationCredentials
      }
    });
    
    const activeOrders = ordersCheck?.success && ordersCheck.data?.entrustedList
      ? ordersCheck.data.entrustedList.filter((o: any) => 
          o.symbol.toLowerCase() === position.symbol.toLowerCase() && 
          o.planStatus === 'live' &&
          o.tradeSide === 'close'
        )
      : [];
    
    // Check current position quantity
    const { data: posCheck } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_position',
        params: { symbol: position.symbol },
        apiCredentials: validationCredentials
      }
    });
    
    const currentQty = posCheck?.data?.[0] ? parseFloat(posCheck.data[0].total || '0') : 0;
    const minQty = getMinQuantityForSymbol(position.symbol);
    
    if (activeOrders.length > 0 || currentQty >= minQty) {
      console.warn(`🚨 ABORT CLOSE: Position ${position.symbol} has ${activeOrders.length} active TP orders and quantity ${currentQty} on exchange (min: ${minQty})`);
      console.warn(`⚠️ NOT marking as closed to prevent data loss - position still active`);
      
      await log({
        functionName: 'position-monitor',
        message: `Prevented incorrect position closure - active orders/quantity detected`,
        level: 'warn',
        positionId: position.id,
        metadata: { 
          reason,
          activeOrders: activeOrders.length,
          currentQty,
          minQty,
          orderDetails: activeOrders.map((o: any) => ({
            orderId: o.orderId,
            triggerPrice: o.triggerPrice,
            size: o.size
          }))
        }
      });
      
      return; // ABORT - do not mark as closed
    }
  }
  
  console.log(`✅ Validation passed - proceeding to mark position ${position.symbol} as closed`);
  
  // Determine actual close reason and price if "not_found_on_exchange"
  let actualReason = reason;
  let actualClosePrice = position.current_price || position.entry_price;
  let actualPnL = position.unrealized_pnl || 0;
  
  if (reason === 'not_found_on_exchange') {
    const userKeys = await getUserApiKeys(position.user_id);
    if (userKeys) {
      const apiCredentials = {
        apiKey: userKeys.apiKey,
        secretKey: userKeys.secretKey,
        passphrase: userKeys.passphrase
      };
      
      try {
        // Fetch fill history from Bitget
        const endTime = Date.now().toString();
        const startTime = (new Date(position.created_at).getTime()).toString();
        
        console.log(`📊 Fetching fill history for ${position.symbol} from ${new Date(Number(startTime)).toISOString()}`);
        
        const { data: fillsResult } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'get_history_positions',
            params: { 
              symbol: position.symbol,
              startTime,
              endTime,
              limit: '100'
            },
            apiCredentials
          }
        });
        
        if (fillsResult?.success && fillsResult.data?.length > 0) {
          console.log(`✅ Found ${fillsResult.data.length} fills from exchange`);
          
          // Filter fills that happened after position was opened
          const posOpenTime = new Date(position.created_at).getTime();
          const recentFills = fillsResult.data.filter((f: any) => {
            const fillTime = Number(f.cTime);
            return fillTime > posOpenTime;
          });
          
          if (recentFills.length > 0) {
            // Calculate weighted average close price from fills
            const totalQty = recentFills.reduce((sum: number, f: any) => sum + parseFloat(f.size || '0'), 0);
            const totalValue = recentFills.reduce((sum: number, f: any) => 
              sum + (parseFloat(f.size || '0') * parseFloat(f.price || '0')), 0);
            
            if (totalQty > 0) {
              actualClosePrice = totalValue / totalQty;
              console.log(`✅ Calculated close price from fills: ${actualClosePrice} (from ${recentFills.length} fills)`);
            }
          }
        }
        
        // Determine actual close reason from price
        actualReason = determineCloseReasonFromPrice(position, actualClosePrice);
        
        // Calculate actual PnL
        const priceDiff = position.side === 'BUY'
          ? actualClosePrice - Number(position.entry_price)
          : Number(position.entry_price) - actualClosePrice;
        actualPnL = priceDiff * Number(position.quantity);
        
        console.log(`✅ Determined: reason=${actualReason}, closePrice=${actualClosePrice}, PnL=${actualPnL}`);
      } catch (error) {
        console.error(`❌ Error fetching fills:`, error);
        // Fall back to original reason if fetch fails
      }
    }
  }
  
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
  
  // Update position in DB with actual values
  const { error: updateError } = await supabase
    .from('positions')
    .update({
      status: 'closed',
      close_reason: actualReason,
      closed_at: new Date().toISOString(),
      close_price: actualClosePrice,
      realized_pnl: actualPnL
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
    message: `Position marked as closed: ${actualReason}`,
    level: 'warn',
    positionId: position.id,
    metadata: { symbol: position.symbol, reason: actualReason, closePrice: actualClosePrice, pnl: actualPnL }
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const bodyText = await req.text();
    const body = bodyText ? JSON.parse(bodyText) : {};
    
    // Handle ping request
    if (body.ping) {
      return new Response(JSON.stringify({ pong: true }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // ============= PART B3: ATOMIC LOCKING MECHANISM =============
    // Generate unique instance ID for this run
    const instanceId = crypto.randomUUID();
    
    // 🆕 FIRST: Clean up expired locks before attempting to acquire
    const { error: cleanupError } = await supabase
      .from('monitor_locks')
      .delete()
      .eq('lock_type', 'position_monitor')
      .lt('expires_at', new Date().toISOString());
    
    if (cleanupError) {
      console.error('⚠️ Failed to cleanup expired locks:', cleanupError);
    } else {
      console.log('🧹 Cleaned up any expired locks');
    }
    
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

        // Get user settings (these are CURRENT settings, may differ from position opening)
        const currentUserSettings = await getUserSettings(user_id);

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
              await recoverOrphanPosition(supabase, exchPos, apiCredentials, user_id, currentUserSettings);
              totalPositionsChecked++;
            } else {
              // Position exists in both - check SL/TP orders
              console.log(`✅ Matched position: ${dbMatch.symbol} ${dbMatch.side}`);
              // Use settings_snapshot from position if available, otherwise current settings
              const positionSettings = dbMatch.metadata?.settings_snapshot || currentUserSettings;
              const usingSnapshot = !!dbMatch.metadata?.settings_snapshot;
              console.log(`${usingSnapshot ? '📸' : '⚠️'} Using ${usingSnapshot ? 'SNAPSHOT' : 'CURRENT (fallback)'} settings for position ${dbMatch.id}`);
              await checkPositionFullVerification(supabase, dbMatch, positionSettings);
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

        // ⚡ INTELLIGENT SYNC: If exchange shows 0 positions but DB has some, verify each individually
        if (exchangePositions.length === 0 && dbPositionsList.length > 0) {
          console.warn(`⚠️ Exchange returned 0 positions but DB has ${dbPositionsList.length} - verifying each individually`);
          await log({
            functionName: 'position-monitor',
            message: 'Individual position verification started',
            level: 'warn',
            metadata: { 
              userId: user_id, 
              dbPositions: dbPositionsList.length,
              exchangePositions: 0
            }
          });
          
          // Verify EACH position individually
          for (const dbPos of dbPositionsList) {
            try {
              const { data: verifyResult } = await supabase.functions.invoke('bitget-api', {
                body: {
                  action: 'get_position',
                  params: { symbol: dbPos.symbol },
                  apiCredentials
                }
              });
              
              const isReallyEmpty = verifyResult?.success && 
                (!verifyResult.data || verifyResult.data.length === 0 ||
                 !verifyResult.data.some((p: any) => 
                   parseFloat(p.total || '0') > 0 &&
                   ((dbPos.side === 'BUY' && p.holdSide === 'long') ||
                    (dbPos.side === 'SELL' && p.holdSide === 'short'))
                 ));
              
              if (isReallyEmpty) {
                console.log(`✅ Confirmed: ${dbPos.symbol} is closed on exchange - marking in DB`);
                await markPositionAsClosed(supabase, dbPos, 'manual_external');
              } else {
                console.warn(`⚠️ ${dbPos.symbol} still has position on exchange - NOT closing`);
              }
            } catch (error) {
              console.error(`Error verifying position ${dbPos.symbol}:`, error);
            }
          }
          
          // DON'T SKIP - continue to orphan cleanup
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
        console.log(`🧹 Checking for orphan orders for user ${user_id}`);
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
  
  // ✅ FIX: Settings are now from position snapshot (passed from caller)
  // Log which settings we're using
  const usingSnapshot = !!position.metadata?.settings_snapshot;
  if (usingSnapshot) {
    console.log(`📸 Using SNAPSHOT settings from position opened at ${position.created_at}`);
  } else {
    console.log(`⚠️ No snapshot found - using CURRENT settings (fallback for old positions)`);
  }

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
    
    // Position already closed on exchange - try to get actual fill data
    let actualClosePrice = Number(position.entry_price);
    let realizedPnl = 0;
    let closeReason = 'unknown';
    
    // Try to fetch fills from last 5 minutes
    const fillNow = Date.now();
    const fillFiveMinutesAgo = fillNow - (5 * 60 * 1000);
    
    const { data: fillsResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_fills',
        params: {
          symbol: position.symbol,
          startTime: fillFiveMinutesAgo.toString(),
          endTime: fillNow.toString()
        },
        apiCredentials
      }
    });
    
    if (fillsResult?.success && fillsResult.data?.fillList && Array.isArray(fillsResult.data.fillList) && fillsResult.data.fillList.length > 0) {
      const expectedTradeSide = position.side === 'BUY' ? 'close_long' : 'close_short';
      const recentFills = fillsResult.data.fillList.filter((fill: any) => 
        fill.tradeSide === expectedTradeSide
      );
      
      if (recentFills.length > 0) {
        // Calculate average close price from fills
        const totalQty = recentFills.reduce((sum: number, f: any) => sum + Number(f.sizeQty || 0), 0);
        const totalValue = recentFills.reduce((sum: number, f: any) => {
          return sum + Number(f.price || 0) * Number(f.sizeQty || 0);
        }, 0);
        
        if (totalQty > 0) {
          actualClosePrice = totalValue / totalQty;
        }
        
        // Calculate PnL
        const entryPrice = Number(position.entry_price);
        const priceDiff = position.side === 'BUY'
          ? actualClosePrice - entryPrice
          : entryPrice - actualClosePrice;
        realizedPnl = priceDiff * Number(position.quantity);
        
        // Determine close reason from actual close price
        const slPrice = Number(position.sl_price);
        const isBuy = position.side === 'BUY';
        
        if (isBuy) {
          if (actualClosePrice <= slPrice * 1.005) {
            closeReason = 'sl_hit';
          } else if (position.tp3_price && actualClosePrice >= Number(position.tp3_price) * 0.995) {
            closeReason = 'tp3_hit';
          } else if (position.tp2_price && actualClosePrice >= Number(position.tp2_price) * 0.995) {
            closeReason = 'tp2_hit';
          } else if (position.tp1_price && actualClosePrice >= Number(position.tp1_price) * 0.995) {
            closeReason = 'tp1_hit';
          } else {
            closeReason = actualClosePrice > entryPrice ? 'tp_hit' : 'sl_hit';
          }
        } else {
          if (actualClosePrice >= slPrice * 0.995) {
            closeReason = 'sl_hit';
          } else if (position.tp3_price && actualClosePrice <= Number(position.tp3_price) * 1.005) {
            closeReason = 'tp3_hit';
          } else if (position.tp2_price && actualClosePrice <= Number(position.tp2_price) * 1.005) {
            closeReason = 'tp2_hit';
          } else if (position.tp1_price && actualClosePrice <= Number(position.tp1_price) * 1.005) {
            closeReason = 'tp1_hit';
          } else {
            closeReason = actualClosePrice < entryPrice ? 'tp_hit' : 'sl_hit';
          }
        }
      }
    } else {
      // Fallback to ticker if fills not available
      const { data: tickerResult } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'get_ticker',
          params: { symbol: position.symbol },
          apiCredentials
        }
      });
      
      actualClosePrice = tickerResult?.success && tickerResult.data?.[0]
        ? Number(tickerResult.data[0].lastPr)
        : Number(position.entry_price);
      
      const entryPrice = Number(position.entry_price);
      const slPrice = Number(position.sl_price);
      const isBuy = position.side === 'BUY';
      
      // Calculate PnL with fallback price
      const priceDiff = isBuy
        ? actualClosePrice - entryPrice
        : entryPrice - actualClosePrice;
      realizedPnl = priceDiff * Number(position.quantity);
      
      // Determine close reason from ticker price
      if (isBuy) {
        if (actualClosePrice <= slPrice * 1.005) {
          closeReason = 'sl_hit';
        } else if (position.tp3_price && actualClosePrice >= Number(position.tp3_price) * 0.995) {
          closeReason = 'tp3_hit';
        } else if (position.tp2_price && actualClosePrice >= Number(position.tp2_price) * 0.995) {
          closeReason = 'tp2_hit';
        } else if (position.tp1_price && actualClosePrice >= Number(position.tp1_price) * 0.995) {
          closeReason = 'tp1_hit';
        } else {
          closeReason = actualClosePrice > entryPrice ? 'tp_hit' : 'sl_hit';
        }
      } else {
        if (actualClosePrice >= slPrice * 0.995) {
          closeReason = 'sl_hit';
        } else if (position.tp3_price && actualClosePrice <= Number(position.tp3_price) * 1.005) {
          closeReason = 'tp3_hit';
        } else if (position.tp2_price && actualClosePrice <= Number(position.tp2_price) * 1.005) {
          closeReason = 'tp2_hit';
        } else if (position.tp1_price && actualClosePrice <= Number(position.tp1_price) * 1.005) {
          closeReason = 'tp1_hit';
        } else {
          closeReason = actualClosePrice < entryPrice ? 'tp_hit' : 'sl_hit';
        }
      }
    }
    
    const currentPrice = actualClosePrice;
    const entryPrice = Number(position.entry_price);
    
    console.log(`📊 Position ${position.symbol} closed on exchange. Determined reason: ${closeReason}, PnL: ${realizedPnl.toFixed(2)}`);
    
    await log({
      functionName: 'position-monitor',
      message: `Position closed on exchange: ${closeReason}`,
      level: 'info',
      positionId: position.id,
      metadata: { closeReason, realizedPnl, actualClosePrice }
    });
    
    // Update position in DB with actual close price and PnL
    await supabase
      .from('positions')
      .update({
        status: 'closed',
        close_reason: closeReason,
        close_price: actualClosePrice,
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
        await moveSlToBreakeven(supabase, position, apiCredentials, pricePlace, settings);
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
  
  let tpOrders = planOrders.filter((order: any) => 
    (order.planType === 'pos_profit' || order.planType === 'profit_plan' || order.planType === 'normal_plan') &&
    order.planStatus === 'live'
  );
  
  // ✅ BUGFIX: RETRY API if TP orders are empty but we expect some
  // This prevents false positives when API temporarily returns empty list
  let expectedTPCount = settings.tp_levels || 1;
  if (position.tp1_filled) expectedTPCount--;
  if (position.tp2_filled && settings.tp_levels >= 2) expectedTPCount--;
  if (position.tp3_filled && settings.tp_levels >= 3) expectedTPCount--;
  
  if (tpOrders.length === 0 && expectedTPCount > 0) {
    console.log(`⚠️ API returned 0 TP orders but expected ${expectedTPCount} - retrying API call in 500ms...`);
    await new Promise(r => setTimeout(r, 500));
    
    // Retry fetching orders
    const { data: retryProfitLoss } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_plan_orders',
        params: { symbol: position.symbol, planType: 'profit_loss' },
        apiCredentials
      }
    });
    
    const { data: retryNormalPlan } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_plan_orders',
        params: { symbol: position.symbol, planType: 'normal_plan' },
        apiCredentials
      }
    });
    
    const retryProfitLossOrders = retryProfitLoss?.success && retryProfitLoss.data?.entrustedList
      ? retryProfitLoss.data.entrustedList.filter((o: any) => 
          o.symbol.toLowerCase() === position.symbol.toLowerCase() && o.planStatus === 'live'
        )
      : [];
      
    const retryNormalPlanOrders = retryNormalPlan?.success && retryNormalPlan.data?.entrustedList
      ? retryNormalPlan.data.entrustedList.filter((o: any) => 
          o.symbol.toLowerCase() === position.symbol.toLowerCase() && o.planStatus === 'live'
        )
      : [];
    
    const retryPlanOrders = [...retryProfitLossOrders, ...retryNormalPlanOrders];
    const retryTPOrders = retryPlanOrders.filter((order: any) => 
      (order.planType === 'pos_profit' || order.planType === 'profit_plan' || order.planType === 'normal_plan') &&
      order.planStatus === 'live'
    );
    
    if (retryTPOrders.length > 0) {
      console.log(`✅ Retry successful - found ${retryTPOrders.length} TP orders (was 0)`);
      tpOrders = retryTPOrders;
      // Also update slOrders if retry found more
      const retrySlOrders = retryPlanOrders.filter((order: any) => 
        (order.planType === 'pos_loss' || order.planType === 'loss_plan' || 
         (order.planType === 'profit_loss' && order.stopLossTriggerPrice)) &&
        order.planStatus === 'live'
      );
      if (retrySlOrders.length > slOrders.length) {
        slOrders.length = 0;
        slOrders.push(...retrySlOrders);
      }
    } else {
      console.log(`⚠️ Retry still returned 0 TP orders - proceeding with resync`);
    }
  }
  
  // Check if resync is needed
  const resyncCheck = checkIfResyncNeeded(slOrders, tpOrders, expected, settings, position);
  
  // ✅ SMART RESYNC: Check fill history BEFORE triggering resync
  // If orders are "missing" but were actually executed, mark as filled instead of resync
  if (resyncCheck.mismatch && (resyncCheck.missingOrders.tp1 || resyncCheck.missingOrders.tp2 || resyncCheck.missingOrders.tp3)) {
    console.log(`🔍 CRITICAL: Checking order fill history before resync...`);
    
    // STEP 1: Verify current position quantity on exchange
    const { data: posCheck } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_position',
        params: { symbol: position.symbol },
        apiCredentials
      }
    });
    
    const currentExchangeQty = posCheck?.data?.[0] ? parseFloat(posCheck.data[0].total || '0') : 0;
    const dbQuantity = Number(position.quantity);
    const quantityReduced = currentExchangeQty < dbQuantity * 0.99;
    
    console.log(`📊 Quantity check: DB=${dbQuantity}, Exchange=${currentExchangeQty}, Reduced=${quantityReduced}`);
    
    // STEP 2: If quantity reduced, TP was likely filled - fetch fill history
    const { data: orderHistory } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_order_fills',
        params: { 
          symbol: position.symbol, 
          startTime: new Date(position.created_at).getTime() 
        },
        apiCredentials
      }
    });
    
    // CRITICAL: Validate fills array to prevent filter errors
    const fillsData = orderHistory?.success && orderHistory.data ? orderHistory.data : [];
    const fills = Array.isArray(fillsData) ? fillsData : (Array.isArray(fillsData.fillList) ? fillsData.fillList : []);
    
    console.log(`📊 Fill history check: success=${orderHistory?.success}, fills count=${fills.length}`);
    
    if (fills.length > 0) {
      const closeFills = fills.filter((f: any) => 
        f.side !== position.side && 
        f.tradeSide === 'close'
      );
      
      console.log(`📊 Found ${closeFills.length} close fills in history`);
      
      if (closeFills.length > 0) {
        // Match fills to specific TP orders by orderId
        const updates: any = {};
        let totalFilledQty = 0;
        let anyTPFilled = false;
        
        // Check TP1
        if (!position.tp1_filled && position.tp1_order_id) {
          const tp1Fills = closeFills.filter((f: any) => f.orderId === position.tp1_order_id);
          if (tp1Fills.length > 0) {
            const tp1FilledQty = tp1Fills.reduce((sum: number, f: any) => 
              sum + parseFloat(f.size || f.baseVolume || '0'), 0
            );
            if (tp1FilledQty > 0) {
              updates.tp1_filled = true;
              totalFilledQty += tp1FilledQty;
              anyTPFilled = true;
              console.log(`✅ TP1 EXECUTED (orderId: ${position.tp1_order_id}, qty: ${tp1FilledQty}) - marking as filled`);
              resyncCheck.missingOrders.tp1 = false; // Cancel resync for TP1
            }
          }
        }
        
        // Check TP2
        if (!position.tp2_filled && position.tp2_order_id) {
          const tp2Fills = closeFills.filter((f: any) => f.orderId === position.tp2_order_id);
          if (tp2Fills.length > 0) {
            const tp2FilledQty = tp2Fills.reduce((sum: number, f: any) => 
              sum + parseFloat(f.size || f.baseVolume || '0'), 0
            );
            if (tp2FilledQty > 0) {
              updates.tp2_filled = true;
              totalFilledQty += tp2FilledQty;
              anyTPFilled = true;
              console.log(`✅ TP2 EXECUTED (orderId: ${position.tp2_order_id}, qty: ${tp2FilledQty}) - marking as filled`);
              resyncCheck.missingOrders.tp2 = false; // Cancel resync for TP2
            }
          }
        }
        
        // Check TP3
        if (!position.tp3_filled && position.tp3_order_id) {
          const tp3Fills = closeFills.filter((f: any) => f.orderId === position.tp3_order_id);
          if (tp3Fills.length > 0) {
            const tp3FilledQty = tp3Fills.reduce((sum: number, f: any) => 
              sum + parseFloat(f.size || f.baseVolume || '0'), 0
            );
            if (tp3FilledQty > 0) {
              updates.tp3_filled = true;
              totalFilledQty += tp3FilledQty;
              anyTPFilled = true;
              console.log(`✅ TP3 EXECUTED (orderId: ${position.tp3_order_id}, qty: ${tp3FilledQty}) - marking as filled`);
              resyncCheck.missingOrders.tp3 = false; // Cancel resync for TP3
            }
          }
        }
        
        console.log(`📊 Total filled quantity from matched TP orders: ${totalFilledQty}, any filled: ${anyTPFilled}`);
        
        if (Object.keys(updates).length > 0) {
          // Calculate new quantity
          const newQuantity = Math.max(0, position.quantity - totalFilledQty);
          
          await supabase
            .from('positions')
            .update({
              ...updates,
              quantity: newQuantity
            })
            .eq('id', position.id);
          
          await log({
            functionName: 'position-monitor',
            message: `TP orders VERIFIED as executed - updated filled status, prevented incorrect resync`,
            level: 'info',
            positionId: position.id,
            metadata: { 
              updates, 
              totalFilledQty,
              oldQuantity: position.quantity,
              newQuantity: newQuantity
            }
          });
          
          // Update position object for rest of function
          if (updates.tp1_filled) position.tp1_filled = true;
          if (updates.tp2_filled) position.tp2_filled = true;
          if (updates.tp3_filled) position.tp3_filled = true;
          position.quantity = newQuantity;
          
          // Check if ANY missingOrders remain - if not, cancel resync completely
          const anyMissing = resyncCheck.missingOrders.tp1 || resyncCheck.missingOrders.tp2 || resyncCheck.missingOrders.tp3;
          
          if (!anyMissing && !resyncCheck.priceIssues.sl && !resyncCheck.priceIssues.tp1 && !resyncCheck.priceIssues.tp2 && !resyncCheck.priceIssues.tp3) {
            console.log(`✅ ALL missing orders were verified as executed - CANCELING RESYNC COMPLETELY`);
            resyncCheck.mismatch = false;
            resyncCheck.reason = 'all_orders_executed_verified';
          } else {
            console.log(`⚠️ Some orders still need resync: missingOrders=${JSON.stringify(resyncCheck.missingOrders)}, priceIssues=${JSON.stringify(resyncCheck.priceIssues)}`);
          }
        } else if (quantityReduced) {
          // Quantity reduced but no fills found - WARNING situation
          console.warn(`🚨 CRITICAL: Position quantity reduced (${dbQuantity} → ${currentExchangeQty}) but NO fills found in history!`);
          console.warn(`⚠️ This may indicate API delay - waiting 3 seconds before proceeding with resync...`);
          
          await new Promise(r => setTimeout(r, 3000));
          
          // Re-check fills after delay
          const { data: recheckHistory } = await supabase.functions.invoke('bitget-api', {
            body: {
              action: 'get_order_fills',
              params: { 
                symbol: position.symbol, 
                startTime: new Date(position.created_at).getTime() 
              },
              apiCredentials
            }
          });
          
          if (recheckHistory?.success) {
            const recheckFills = Array.isArray(recheckHistory.data) ? recheckHistory.data : (Array.isArray(recheckHistory.data?.fillList) ? recheckHistory.data.fillList : []);
            console.log(`📊 Recheck found ${recheckFills.length} total fills`);
            
            if (recheckFills.length > fills.length) {
              console.log(`✅ New fills appeared after delay - NOT proceeding with resync to prevent order cancellation`);
              resyncCheck.mismatch = false;
              resyncCheck.reason = 'fills_appeared_after_delay';
            }
          }
        }
      } else {
        console.log(`⚠️ No close fills found in order history`);
        
        // If quantity hasn't changed, orders may have been canceled - proceed with resync
        if (!quantityReduced) {
          console.log(`📊 Quantity unchanged - orders likely canceled, proceeding with resync`);
        } else {
          console.warn(`🚨 Quantity reduced but no fills - possible API delay, adding safety delay before resync`);
          await new Promise(r => setTimeout(r, 2000));
        }
      }
    } else {
      console.warn(`⚠️ Failed to fetch order history or invalid data - proceeding cautiously with resync`);
    }
  }
  
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
    console.log(`🔄 SELECTIVE RESYNC for ${position.symbol}: ${resyncCheck.reason}`);
    console.log(`📊 Resync details:`, {
      missingOrders: resyncCheck.missingOrders,
      priceIssues: resyncCheck.priceIssues
    });
    
    // ✅ PRE-RESYNC VALIDATION: Verify position still exists and check active orders
    console.log(`🔍 PRE-RESYNC VALIDATION: Checking exchange state before making changes...`);
    
    const { data: preResyncPosCheck } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_position',
        params: { symbol: position.symbol },
        apiCredentials
      }
    });
    
    const preResyncPosition = preResyncPosCheck?.data?.[0];
    const preResyncQty = preResyncPosition ? parseFloat(preResyncPosition.total || '0') : 0;
    
    if (preResyncQty === 0) {
      console.warn(`🚨 CRITICAL: Position fully closed on exchange (qty=0) - aborting resync and marking as closed`);
      await markPositionAsClosed(supabase, position, 'closed_before_resync');
      return;
    }
    
    // Check for active TP orders one more time
    const { data: preResyncOrders } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_plan_orders',
        params: { symbol: position.symbol, planType: 'normal_plan' },
        apiCredentials
      }
    });
    
    const activeTPOrders = preResyncOrders?.success && preResyncOrders.data?.entrustedList
      ? preResyncOrders.data.entrustedList.filter((o: any) => 
          o.symbol.toLowerCase() === position.symbol.toLowerCase() && 
          o.planStatus === 'live' &&
          o.tradeSide === 'close'
        )
      : [];
    
    console.log(`📊 Pre-resync check: Exchange qty=${preResyncQty}, DB qty=${position.quantity}, Active TP orders=${activeTPOrders.length}`);
    
    // If we have active TP orders but they're flagged as missing, they might be correct - skip resync
    if (activeTPOrders.length > 0 && resyncCheck.missingOrders.tp1 && !resyncCheck.priceIssues.tp1) {
      console.warn(`⚠️ Found ${activeTPOrders.length} active TP orders on exchange, but they're flagged as "missing" - possible detection issue`);
      console.log(`⚠️ Skipping resync to prevent canceling valid orders - will re-check next cycle`);
      resyncCheck.mismatch = false;
      resyncCheck.reason = 'active_orders_found_skip_resync';
    }
    
    if (!resyncCheck.mismatch) {
      console.log(`✅ Pre-resync validation canceled resync - no changes needed`);
      return;
    }
    
    await log({
      functionName: 'position-monitor',
      message: `Selective resync triggered: ${resyncCheck.reason}`,
      level: 'warn',
      positionId: position.id,
      metadata: { 
        expected, 
        currentOrders: planOrders.length,
        missingOrders: resyncCheck.missingOrders,
        priceIssues: resyncCheck.priceIssues,
        preResyncQty,
        activeTPOrders: activeTPOrders.length
      }
    });
    
    const holdSide = position.side === 'BUY' ? 'long' : 'short';
    
    // ✅ SELECTIVE RESYNC: Only fix what's broken
    
    // 1. Handle SL if needed
    if (resyncCheck.missingOrders.sl || resyncCheck.priceIssues.sl) {
      console.log(`🔧 Fixing SL order...`);
      
      // Cancel existing SL if it exists
      if (position.sl_order_id) {
        for (const planType of ['pos_loss', 'profit_loss']) {
          const { data: cancelResult } = await supabase.functions.invoke('bitget-api', {
            body: {
              action: 'cancel_plan_order',
              params: { symbol: position.symbol, orderId: position.sl_order_id, planType },
              apiCredentials
            }
          });
          if (cancelResult?.success) {
            console.log(`✅ Canceled SL order ${position.sl_order_id}`);
            break;
          }
        }
      }
      
      await new Promise(r => setTimeout(r, 500));
      
      // Check if price already passed SL level
      const slAlreadyTriggered = isPriceBeyondLevel(currentPrice, expected.sl_price, position.side, 'SL');
      
      if (slAlreadyTriggered) {
        console.log(`🚨 CRITICAL: Price ${currentPrice} already past SL ${expected.sl_price} - closing position immediately!`);
        
        const { data: posData } = await supabase.functions.invoke('bitget-api', {
          body: { action: 'get_position', params: { symbol: position.symbol }, apiCredentials }
        });
        
        const exchangePosition = posData?.data?.find((p: any) => 
          p.holdSide === (position.side === 'BUY' ? 'long' : 'short')
        );
        
        if (exchangePosition && parseFloat(exchangePosition.total) > 0) {
          const closeResult = await executeVerifiedClose(
            supabase, position, parseFloat(exchangePosition.total), 
            holdSide, apiCredentials, pricePlace, volumePlace
          );
          
          if (closeResult.success) {
            await markPositionAsClosed(supabase, position, 'sl_hit_delayed');
            console.log(`✅ Emergency close executed - SL was already breached`);
            actions.push(`Emergency close - SL already hit (price: ${currentPrice})`);
            return;
          }
        }
      } else {
        // Place new SL
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
            .update({ 
              sl_order_id: newSlResult.data.orderId,
              sl_price: expected.sl_price,
              metadata: {
                ...position.metadata,
                last_resync_at: new Date().toISOString(),
                resync_count: (position.metadata?.resync_count || 0) + 1
              }
            })
            .eq('id', position.id);
          console.log(`✅ SL order placed: ${newSlResult.data.orderId}`);
          actions.push('Fixed SL order');
        }
      }
    }
    
    // 2. Handle all TP orders in PARALLEL (like bitget-trader does)
    // First, collect all TPs that need fixing
    const tpsToFix: Array<{
      level: number;
      key: 'tp1' | 'tp2' | 'tp3';
      price: number;
      quantity: number;
      orderIdKey: 'tp1_order_id' | 'tp2_order_id' | 'tp3_order_id';
      filledKey: 'tp1_filled' | 'tp2_filled' | 'tp3_filled';
      existingOrderId?: string;
    }> = [];
    
    for (let i = 1; i <= settings.tp_levels; i++) {
      const tpKey = `tp${i}` as 'tp1' | 'tp2' | 'tp3';
      const tpFilledKey = `${tpKey}_filled` as 'tp1_filled' | 'tp2_filled' | 'tp3_filled';
      const tpOrderIdKey = `${tpKey}_order_id` as 'tp1_order_id' | 'tp2_order_id' | 'tp3_order_id';
      const tpPriceKey = `${tpKey}_price` as keyof ExpectedSLTP;
      const tpQtyKey = `${tpKey}_quantity` as keyof ExpectedSLTP;
      
      // Skip if already filled
      if (position[tpFilledKey] === true) {
        console.log(`⏭️ Skipping TP${i} - already filled`);
        continue;
      }
      
      // Skip if no issue with this TP
      if (!resyncCheck.missingOrders[tpKey] && !resyncCheck.priceIssues[tpKey]) {
        console.log(`⏭️ Skipping TP${i} - no issues detected`);
        continue;
      }
      
      const tpPrice = expected[tpPriceKey] as number | undefined;
      const tpQty = expected[tpQtyKey] as number | undefined;
      
      if (!tpPrice || !tpQty) {
        console.log(`⏭️ Skipping TP${i} - no expected values`);
        continue;
      }
      
      // Check if price already passed this TP level
      const priceAlreadyPastTP = isPriceBeyondLevel(currentPrice, tpPrice, position.side, 'TP');
      
      if (priceAlreadyPastTP) {
        console.log(`⚠️ Price ${currentPrice} already past TP${i} ${tpPrice} - executing immediate partial close`);
        
        const roundedQty = Math.floor(tpQty * Math.pow(10, volumePlace)) / Math.pow(10, volumePlace);
        
        const closeResult = await executeVerifiedClose(
          supabase, position, roundedQty, 
          holdSide, apiCredentials, pricePlace, volumePlace
        );
        
        if (closeResult.success) {
          await supabase
            .from('positions')
            .update({ [tpFilledKey]: true })
            .eq('id', position.id);
          
          console.log(`✅ Immediate TP${i} close executed (verified: ${closeResult.actualClosedQty} units)`);
          actions.push(`Immediate TP${i} close (verified: ${closeResult.actualClosedQty} units)`);
          
          // Move SL to breakeven if needed
          if (settings.sl_to_breakeven && i >= (settings.breakeven_trigger_tp || 1)) {
            await moveSlToBreakeven(supabase, position, apiCredentials, pricePlace, settings);
          }
        }
      } else {
        // Add to list of TPs to fix
        tpsToFix.push({
          level: i,
          key: tpKey,
          price: tpPrice,
          quantity: tpQty,
          orderIdKey: tpOrderIdKey,
          filledKey: tpFilledKey,
          existingOrderId: position[tpOrderIdKey] || undefined
        });
      }
    }
    
    // Now handle all TPs to fix in parallel
    if (tpsToFix.length > 0) {
      console.log(`🔧 Fixing ${tpsToFix.length} TP orders in PARALLEL...`);
      
      // Step 1: Cancel all existing orders in parallel
      const cancelPromises = tpsToFix
        .filter(tp => tp.existingOrderId)
        .map(tp => 
          supabase.functions.invoke('bitget-api', {
            body: {
              action: 'cancel_plan_order',
              params: { 
                symbol: position.symbol, 
                orderId: tp.existingOrderId, 
                planType: 'normal_plan' 
              },
              apiCredentials
            }
          }).then((result: any) => ({
            level: tp.level,
            orderId: tp.existingOrderId,
            success: result.data?.success || false
          }))
        );
      
      if (cancelPromises.length > 0) {
        const cancelResults = await Promise.allSettled(cancelPromises);
        cancelResults.forEach((result, idx) => {
          if (result.status === 'fulfilled' && result.value.success) {
            console.log(`✅ Canceled old TP${result.value.level} order ${result.value.orderId}`);
          }
        });
        
        // Small delay after cancellations
        await new Promise(r => setTimeout(r, 300));
      }
      
      // Step 2: Place all new TP orders in parallel
      const tpOrderPromises = tpsToFix.map(tp => {
        const roundedTpPrice = roundPrice(tp.price, pricePlace);
        const roundedQty = Math.floor(tp.quantity * Math.pow(10, volumePlace)) / Math.pow(10, volumePlace);
        
        return {
          level: tp.level,
          key: tp.key,
          orderIdKey: tp.orderIdKey,
          price: tp.price,
          quantity: tp.quantity,
          promise: supabase.functions.invoke('bitget-api', {
            body: {
              action: 'place_plan_order',
              params: {
                symbol: position.symbol,
                planType: 'normal_plan',
                side: holdSide === 'long' ? 'close_long' : 'close_short',
                size: roundedQty.toString(),
                triggerPrice: roundedTpPrice,
                triggerType: 'mark_price',
                orderType: 'market',
              },
              apiCredentials
            }
          })
        };
      });
      
      const tpStartTime = Date.now();
      console.log(`🚀 Placing ${tpOrderPromises.length} TP orders in parallel...`);
      const tpResults = await Promise.allSettled(tpOrderPromises.map(tp => tp.promise));
      const tpElapsed = Date.now() - tpStartTime;
      console.log(`⏱️ All TP orders completed in ${tpElapsed}ms (parallel execution)`);
      
      // Step 3: Process results and update database
      const dbUpdates: any = {};
      
      tpResults.forEach((result, index) => {
        const tpOrder = tpOrderPromises[index];
        
        if (result.status === 'fulfilled') {
          const tpResult = result.value?.data;
          console.log(`📊 TP${tpOrder.level} result:`, JSON.stringify(tpResult, null, 2));
          
          if (tpResult?.success && tpResult.data?.orderId) {
            const orderId = tpResult.data.orderId;
            
            dbUpdates[tpOrder.orderIdKey] = orderId;
            dbUpdates[`${tpOrder.key}_price`] = tpOrder.price;
            dbUpdates[`${tpOrder.key}_quantity`] = tpOrder.quantity;
            
            console.log(`✅ TP${tpOrder.level} order placed: ${orderId} at ${tpOrder.price}`);
            actions.push(`Fixed TP${tpOrder.level} order`);
          } else {
            console.error(`❌ Failed to place TP${tpOrder.level} order:`, JSON.stringify(tpResult, null, 2));
          }
        } else {
          console.error(`❌ TP${tpOrder.level} order promise rejected:`, result.reason);
        }
      });
      
      // Update database with all successful TPs in one operation
      if (Object.keys(dbUpdates).length > 0) {
        await supabase
          .from('positions')
          .update({
            ...dbUpdates,
            metadata: {
              ...position.metadata,
              last_resync_at: new Date().toISOString(),
              resync_count: (position.metadata?.resync_count || 0) + 1
            }
          })
          .eq('id', position.id);
        console.log(`✅ Database updated with ${Object.keys(dbUpdates).length / 3} TP orders`);
      }
    }
    
    console.log(`✅ Selective resync completed for ${position.symbol}`);
    
    // Log intervention to monitoring_logs for Diagnostics dashboard
    await supabase.from('monitoring_logs').insert({
      check_type: 'selective_resync',
      position_id: position.id,
      status: 'success',
      actions_taken: actions.join('; '),
      issues: [{
        reason: resyncCheck.reason,
        severity: 'high',
        missing_orders: resyncCheck.missingOrders,
        price_issues: resyncCheck.priceIssues
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
    
    console.log(`✅ Position ${position.symbol} selective resync complete`);
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
