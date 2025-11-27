import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { log } from "../_shared/logger.ts";
import { getUserApiKeys } from "../_shared/userKeys.ts";
import { getUserSettings } from "../_shared/userSettings.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to get price precision from Bitget API
async function getPricePrecision(supabase: any, symbol: string, apiCredentials: any): Promise<number> {
  const { data: symbolInfoResult } = await supabase.functions.invoke('bitget-api', {
    body: {
      action: 'get_symbol_info',
      params: { symbol },
      apiCredentials
    }
  });
  
  let pricePlace = 2; // Default to 2 decimal places
  if (symbolInfoResult?.success && symbolInfoResult.data?.[0]) {
    pricePlace = parseInt(symbolInfoResult.data[0].pricePlace || '2');
  }
  
  return pricePlace;
}

// Helper function to round price to correct precision
function roundPrice(price: number, places: number): string {
  return price.toFixed(places);
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

  // Calculate TP quantities based on close percentages
  const totalQty = position.quantity;
  const tp1Qty = settings.tp_levels >= 1 ? totalQty * (settings.tp1_close_percent / 100) : totalQty;
  const tp2Qty = settings.tp_levels >= 2 ? totalQty * (settings.tp2_close_percent / 100) : 0;
  const tp3Qty = settings.tp_levels >= 3 ? totalQty * (settings.tp3_close_percent / 100) : 0;

  return {
    sl_price: slPrice,
    tp1_price: tp1Price,
    tp2_price: tp2Price,
    tp3_price: tp3Price,
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
  
  const slPriceDiff = Math.abs(Number(slOrders[0].triggerPrice) - expected.sl_price) / expected.sl_price;
  if (slPriceDiff > 0.00001) { // 0.001% tolerance
    return { 
      mismatch: true, 
      reason: `SL price mismatch: expected=${expected.sl_price.toFixed(4)}, actual=${slOrders[0].triggerPrice}, diff=${(slPriceDiff * 100).toFixed(4)}%` 
    };
  }
  
  // Check TP count - must match tp_levels
  const expectedTPCount = settings.tp_levels || 1;
  const validTPOrders = tpOrders.filter((o: any) => o.tradeSide === 'close');
  
  if (validTPOrders.length !== expectedTPCount) {
    return { 
      mismatch: true, 
      reason: `Expected ${expectedTPCount} TP orders, found ${validTPOrders.length}` 
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
      return priceDiff < 0.00001 && qtyDiff < 0.001; // 0.001% price, 0.1% qty tolerance
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

// Helper function to close orphan position on exchange
async function closeOrphanPosition(supabase: any, exchangePosition: any, apiCredentials: any) {
  const side = exchangePosition.holdSide === 'long' ? 'close_long' : 'close_short';
  
  console.log(`🚨 Closing ORPHAN position: ${exchangePosition.symbol} ${side}, size=${exchangePosition.total}`);
  
  const { data: closeResult, error: closeError } = await supabase.functions.invoke('bitget-api', {
    body: {
      action: 'close_position',
      apiCredentials,
      params: {
        symbol: exchangePosition.symbol,
        size: exchangePosition.total,
        side: side
      }
    }
  });
  
  if (closeError || !closeResult?.success) {
    console.error(`❌ Failed to close ORPHAN position:`, closeError || closeResult);
    await log({
      functionName: 'position-monitor',
      message: `Failed to close orphan position`,
      level: 'error',
      metadata: { 
        symbol: exchangePosition.symbol, 
        error: closeError?.message || closeResult?.error || 'Unknown error' 
      }
    });
    return;
  }
  
  console.log(`✅ ORPHAN position closed: ${exchangePosition.symbol}`);
  
  // Log the orphan closure
  await supabase.from('monitoring_logs').insert({
    check_type: 'orphan_closed',
    position_id: null,
    status: 'completed',
    actions_taken: JSON.stringify({
      symbol: exchangePosition.symbol,
      side: exchangePosition.holdSide,
      size: exchangePosition.total,
      reason: 'Orphan position found on exchange without matching DB record'
    })
  });
  
  await log({
    functionName: 'position-monitor',
    message: `Orphan position closed successfully`,
    level: 'info',
    metadata: { symbol: exchangePosition.symbol, side: exchangePosition.holdSide }
  });
}

// Helper function to mark position as closed in DB
async function markPositionAsClosed(supabase: any, position: any, reason: string) {
  console.log(`⚠️ Marking position ${position.symbol} as closed in DB: ${reason}`);
  
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

  let lockRecord: any = null;

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Check if another monitor cycle is already running (prevent parallel execution)
    const { data: existingLock } = await supabase
      .from('monitoring_logs')
      .select('*')
      .eq('check_type', 'monitor_lock')
      .eq('status', 'running')
      .gte('created_at', new Date(Date.now() - 60000).toISOString())
      .maybeSingle();

    if (existingLock) {
      console.log('⏳ Another monitor cycle is running, skipping...');
      return new Response(JSON.stringify({ 
        skipped: true, 
        reason: 'Another cycle in progress',
        existingLock: existingLock.id
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Create lock
    const { data: newLock } = await supabase
      .from('monitoring_logs')
      .insert({
        check_type: 'monitor_lock',
        status: 'running',
        position_id: null
      })
      .select()
      .single();
    
    lockRecord = newLock;

    await log({
      functionName: 'position-monitor',
      message: '🔥 OKO SAURONA: Starting monitoring cycle',
      level: 'info',
      metadata: { lockId: lockRecord?.id }
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
      
      if (lockRecord) {
        await supabase
          .from('monitoring_logs')
          .update({ status: 'completed' })
          .eq('id', lockRecord.id);
      }
      
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
        const { data: exchangePositionsResult } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'get_positions',
            apiCredentials
          }
        });

        const exchangePositions = exchangePositionsResult?.success && exchangePositionsResult.data
          ? exchangePositionsResult.data.filter((p: any) => parseFloat(p.total || '0') > 0)
          : [];

        console.log(`📊 Found ${exchangePositions.length} positions on exchange for user ${user_id}`);

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
              // ORPHAN on exchange - close it
              console.log(`🚨 ORPHAN position on exchange: ${exchPos.symbol} ${exchPos.holdSide}`);
              await closeOrphanPosition(supabase, exchPos, apiCredentials);
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

        // STEP 4: SYNC - For each position in DB that's NOT on exchange
        for (const dbPos of dbPositionsList) {
          try {
            const exchMatch = exchangePositions.find((e: any) => 
              e.symbol === dbPos.symbol && 
              ((dbPos.side === 'BUY' && e.holdSide === 'long') || 
               (dbPos.side === 'SELL' && e.holdSide === 'short'))
            );

            if (!exchMatch) {
              // Position in DB but not on exchange - mark as closed
              console.log(`⚠️ Position in DB but not on exchange: ${dbPos.symbol}`);
              await markPositionAsClosed(supabase, dbPos, 'not_found_on_exchange');
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

    // Release lock
    if (lockRecord) {
      await supabase
        .from('monitoring_logs')
        .update({ status: 'completed' })
        .eq('id', lockRecord.id);
    }

    return new Response(JSON.stringify({ 
      success: true, 
      positions_checked: totalPositionsChecked 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    // Release lock on error
    if (lockRecord) {
      try {
        const supabase = createClient(
          Deno.env.get('SUPABASE_URL') ?? '',
          Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
        );
        
        await supabase
          .from('monitoring_logs')
          .update({ status: 'error' })
          .eq('id', lockRecord.id);
      } catch (lockError) {
        console.error('Failed to release lock on error:', lockError);
      }
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
  
  // Get price precision for this symbol
  const pricePlace = await getPricePrecision(supabase, position.symbol, apiCredentials);
  console.log(`📏 Price precision for ${position.symbol}: ${pricePlace} decimals`);

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

  // 4. Check quantity match
  const bitgetQuantity = Number(bitgetPosition.total || 0);
  const dbQuantity = Number(position.quantity);
  
  if (Math.abs(bitgetQuantity - dbQuantity) > 0.0001) {
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
  console.log(`📊 Expected from settings: SL=${expected.sl_price.toFixed(4)}, TP1=${expected.tp1_price?.toFixed(4)}, TP2=${expected.tp2_price?.toFixed(4)}, TP3=${expected.tp3_price?.toFixed(4)}`);
  
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
      updated_at: new Date().toISOString()
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
    
    console.log(`💾 Updated position in DB with new expected values`);
    
    // STEP 3: Place NEW orders using correct types (pos_loss, pos_profit)
    const holdSide = position.side === 'BUY' ? 'long' : 'short';
    
    // Place SL
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
    
    // Place TP orders
    for (let i = 1; i <= settings.tp_levels; i++) {
      const tpPrice = expected[`tp${i}_price` as keyof ExpectedSLTP] as number | undefined;
      const tpQty = expected[`tp${i}_quantity` as keyof ExpectedSLTP] as number | undefined;
      
      if (!tpPrice || !tpQty) continue;
      
      console.log(`🔧 Placing TP${i} order at ${tpPrice.toFixed(4)}, qty=${tpQty.toFixed(4)}...`);
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
            size: tpQty.toString(),
          },
          apiCredentials
        }
      });
      
      if (newTpResult?.success) {
        const updateField = `tp${i}_order_id` as const;
        await supabase
          .from('positions')
          .update({ [updateField]: newTpResult.data.orderId })
          .eq('id', position.id)
          .eq('user_id', position.user_id);
        console.log(`✅ TP${i} order placed: ${newTpResult.data.orderId}`);
        actions.push(`Placed new TP${i} order after resync`);
      } else {
        console.error(`❌ Failed to place TP${i}:`, newTpResult);
      }
    }
    
    await log({
      functionName: 'position-monitor',
      message: `Resync complete for ${position.symbol}`,
      level: 'info',
      positionId: position.id,
      metadata: { actions }
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
