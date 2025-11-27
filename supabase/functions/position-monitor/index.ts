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

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    await log({
      functionName: 'position-monitor',
      message: '🔥 OKO SAURONA: Starting monitoring cycle',
      level: 'info'
    });
    console.log('🔥 OKO SAURONA: Starting position monitoring cycle');

    // Get all open positions from DB
    const { data: positions, error: positionsError } = await supabase
      .from('positions')
      .select('*')
      .eq('status', 'open');

    if (positionsError) {
      await log({
        functionName: 'position-monitor',
        message: 'Failed to fetch positions from DB',
        level: 'error',
        metadata: { error: positionsError.message }
      });
      throw positionsError;
    }

    if (!positions || positions.length === 0) {
      await log({
        functionName: 'position-monitor',
        message: 'No open positions to monitor',
        level: 'info'
      });
      console.log('No open positions to monitor');
      return new Response(JSON.stringify({ message: 'No open positions' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await log({
      functionName: 'position-monitor',
      message: `🔥 OKO SAURONA: Monitoring ${positions.length} positions`,
      level: 'info',
      metadata: { positionCount: positions.length }
    });
    console.log(`🔥 OKO SAURONA: Monitoring ${positions.length} positions`);

    // Check each position with full verification
    for (const position of positions) {
      try {
        // Check if position has user_id - if not, it's an orphaned position
        if (!position.user_id) {
          console.log(`⚠️ Position ${position.id} (${position.symbol}) has no user_id - marking as orphaned`);
          await log({
            functionName: 'position-monitor',
            message: `Position without user_id - auto-closing as orphaned`,
            level: 'warn',
            positionId: position.id,
            metadata: { symbol: position.symbol }
          });
          
          await supabase
            .from('positions')
            .update({
              status: 'closed',
              close_reason: 'orphaned_no_user',
              closed_at: new Date().toISOString(),
              realized_pnl: 0
            })
            .eq('id', position.id);
          
          continue; // Skip to next position
        }

        await log({
          functionName: 'position-monitor',
          message: `🔥 Checking position ${position.symbol}`,
          level: 'info',
          positionId: position.id,
          metadata: { symbol: position.symbol, side: position.side }
        });

        // Get user settings
        const userSettings = await getUserSettings(position.user_id);

        await checkPositionFullVerification(supabase, position, userSettings);
      } catch (error) {
        await log({
          functionName: 'position-monitor',
          message: `Error checking position ${position.symbol}`,
          level: 'error',
          positionId: position.id,
          metadata: { error: error instanceof Error ? error.message : 'Unknown error' }
        });
        console.error(`Error checking position ${position.id}:`, error);
        
        // Update position with error
        await supabase
          .from('positions')
          .update({
            check_errors: (position.check_errors || 0) + 1,
            last_error: error instanceof Error ? error.message : 'Unknown error',
            last_check_at: new Date().toISOString(),
          })
          .eq('id', position.id)
          .eq('user_id', position.user_id);
      }
    }

    await log({
      functionName: 'position-monitor',
      message: '🔥 OKO SAURONA: Monitoring cycle completed',
      level: 'info',
      metadata: { positionsChecked: positions.length }
    });

    return new Response(JSON.stringify({ 
      success: true, 
      positions_checked: positions.length 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
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

  // Get all open orders for this symbol (to check SL/TP)
  const { data: ordersResult } = await supabase.functions.invoke('bitget-api', {
    body: {
      action: 'get_plan_orders',
      params: { 
        symbol: position.symbol
      },
      apiCredentials
    }
  });

  const planOrders = ordersResult?.success && ordersResult.data?.entrustedList
    ? ordersResult.data.entrustedList.filter((o: any) => 
        o.symbol.toLowerCase() === position.symbol.toLowerCase() && 
        o.planStatus === 'live'
      )
    : [];
  console.log(`Found ${planOrders.length} plan orders for ${position.symbol}`);

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

  // 5. Check if SL order exists
  const slOrders = planOrders.filter((order: any) => 
    (order.planType === 'pos_loss' || order.planType === 'loss_plan' || 
     (order.planType === 'profit_loss' && order.stopLossTriggerPrice)) &&
    order.planStatus === 'live'
  );
  
  if (slOrders.length === 0) {
    issues.push({
      type: 'missing_sl',
      severity: 'critical',
      message: 'No Stop Loss order found on exchange'
    });
    console.log(`❌ CRITICAL: No SL order found for ${position.symbol}`);
    
    // Auto-repair: Place SL order using TPSL endpoint (always enabled for now)
    const autoRepair = true;
    if (autoRepair) {
      console.log(`🔧 Auto-repairing: Placing SL order`);
      const holdSide = position.side === 'BUY' ? 'long' : 'short';
      const roundedSlPrice = roundPrice(position.sl_price, pricePlace);
      
      // Get repair attempts from metadata
      const metadata = position.metadata || {};
      const slRepairAttempts = metadata.sl_repair_attempts || 0;
      
      const { data: slResult, error: slError } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'place_tpsl_order',
          params: {
            symbol: position.symbol,
            planType: 'pos_loss',
            triggerPrice: roundedSlPrice,
            triggerType: 'mark_price',
            holdSide: holdSide,
            executePrice: 0, // Market order
          },
          apiCredentials
        }
      });
      
      if (slError) {
        console.error(`❌ Supabase invoke error for SL:`, slError);
        await log({
          functionName: 'position-monitor',
          message: 'Failed to invoke bitget-api for SL',
          level: 'error',
          positionId: position.id,
          metadata: { error: slError, attempts: slRepairAttempts + 1 }
        });
        
        // Update repair attempts
        await supabase
          .from('positions')
          .update({ 
            metadata: { ...metadata, sl_repair_attempts: slRepairAttempts + 1 }
          })
          .eq('id', position.id)
          .eq('user_id', position.user_id);
          
        // If 2nd attempt failed, emergency close and ban symbol
        if (slRepairAttempts >= 1) {
          console.log(`🚨 EMERGENCY: 2nd SL repair attempt failed for ${position.symbol}, closing position and banning symbol`);
          
          // Close position at market
          const closeSide = position.side === 'BUY' ? 'close_long' : 'close_short';
          const { data: closeResult } = await supabase.functions.invoke('bitget-api', {
            body: {
              action: 'place_order',
              params: {
                symbol: position.symbol,
                size: bitgetQuantity.toString(),
                side: closeSide,
              },
              apiCredentials
            }
          });
          
          if (closeResult?.success) {
            // Calculate PnL
            const priceDiff = position.side === 'BUY'
              ? currentPrice - Number(position.entry_price)
              : Number(position.entry_price) - currentPrice;
            const realizedPnl = priceDiff * Number(position.quantity);
            
            await supabase
              .from('positions')
              .update({
                status: 'closed',
                close_reason: 'Emergency close - failed to set SL after 2 attempts',
                close_price: currentPrice,
                realized_pnl: realizedPnl,
                closed_at: new Date().toISOString()
              })
              .eq('id', position.id)
              .eq('user_id', position.user_id);
            
            // Ban the symbol
            await supabase
              .from('banned_symbols')
              .insert({
                symbol: position.symbol,
                reason: 'Failed to set SL after 2 attempts - emergency close'
              });
            
            actions.push(`🚨 EMERGENCY: Closed position and banned ${position.symbol}`);
            
            await log({
              functionName: 'position-monitor',
              message: `Emergency close and ban: ${position.symbol}`,
              level: 'error',
              positionId: position.id,
              metadata: { 
                reason: 'Failed to set SL after 2 attempts',
                closePrice: currentPrice
              }
            });
            
            // Log to monitoring_logs
            await supabase
              .from('monitoring_logs')
              .insert({
                position_id: position.id,
                check_type: 'emergency_close',
                status: 'critical',
                issues: [{
                  type: 'emergency_close',
                  reason: 'Failed to set SL after 2 attempts'
                }],
                actions_taken: `Closed position at market (${currentPrice}) and banned symbol ${position.symbol}`,
                expected_data: { sl_price: position.sl_price },
                actual_data: { current_price: currentPrice, sl_missing: true }
              });
          }
        }
      } else if (slResult?.success) {
        await supabase
          .from('positions')
          .update({ 
            sl_order_id: slResult.data.orderId,
            metadata: { ...metadata, sl_repair_attempts: 0 }
          })
          .eq('id', position.id)
          .eq('user_id', position.user_id);
        actions.push('Placed missing SL order');
        console.log(`✅ SL order placed: ${slResult.data.orderId}`);
      }
    }
  }

  // 6. Check TP orders exist
  const tpOrders = planOrders.filter((order: any) => 
    (order.planType === 'pos_profit' || order.planType === 'profit_plan' || order.planType === 'normal_plan') &&
    order.planStatus === 'live' &&
    order.tradeSide === 'close'
  );
  
  console.log(`📊 Found ${tpOrders.length} TP orders on exchange for ${position.symbol}`);
  
  // Check each TP level
  const expectedTPs = [];
  if (position.tp1_price && position.tp1_quantity > 0) expectedTPs.push({ level: 1, price: position.tp1_price, quantity: position.tp1_quantity, orderId: position.tp1_order_id });
  if (position.tp2_price && position.tp2_quantity > 0) expectedTPs.push({ level: 2, price: position.tp2_price, quantity: position.tp2_quantity, orderId: position.tp2_order_id });
  if (position.tp3_price && position.tp3_quantity > 0) expectedTPs.push({ level: 3, price: position.tp3_price, quantity: position.tp3_quantity, orderId: position.tp3_order_id });
  
  console.log(`📋 Expected ${expectedTPs.length} TP levels in DB`);
  
  // Track used order IDs to prevent one order matching multiple TPs
  const usedOrderIds = new Set<string>();
  
  for (const expectedTP of expectedTPs) {
    console.log(`🔍 Checking TP${expectedTP.level}: expected=${expectedTP.price}, orders on exchange:`, 
      tpOrders.map((o: any) => ({ orderId: o.orderId, price: o.triggerPrice })));
    
    const matchingOrder = tpOrders.find((order: any) => {
      // Skip if this order was already matched to another TP
      if (usedOrderIds.has(order.orderId)) {
        console.log(`⏭️ Skipping order ${order.orderId} - already matched to another TP`);
        return false;
      }
      
      const orderPrice = Number(order.triggerPrice || order.takeProfit || 0);
      const expectedPrice = Number(expectedTP.price);
      const priceDiff = Math.abs(orderPrice - expectedPrice) / expectedPrice;
      
      console.log(`  📊 Order ${order.orderId}: price=${orderPrice}, diff=${(priceDiff * 100).toFixed(4)}%`);
      
      return priceDiff < 0.00001; // 0.001% tolerance - only for floating point rounding
    });
    
    const tpExists = !!matchingOrder;
    
    if (!tpExists) {
      issues.push({
        type: `missing_tp${expectedTP.level}`,
        severity: 'high',
        message: `TP${expectedTP.level} order not found on exchange`,
        expected: { price: expectedTP.price, quantity: expectedTP.quantity }
      });
      console.log(`⚠️ TP${expectedTP.level} missing for ${position.symbol} - will auto-repair`);
      
      // Auto-repair missing TP
      console.log(`🔧 Auto-repairing: Placing TP${expectedTP.level} order`);
      const holdSide = position.side === 'BUY' ? 'long' : 'short';
      const roundedTpPrice = roundPrice(expectedTP.price, pricePlace);
      
      const { data: tpResult } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'place_plan_order',
          params: {
            symbol: position.symbol,
            planType: 'normal_plan',
            triggerPrice: roundedTpPrice,
            triggerType: 'mark_price',
            side: position.side === 'BUY' ? 'sell' : 'buy',
            tradeSide: 'close',
            size: expectedTP.quantity.toString(),
            orderType: 'market',
          },
          apiCredentials
        }
      });
      
      if (tpResult?.success) {
        const updateField = `tp${expectedTP.level}_order_id` as const;
        await supabase
          .from('positions')
          .update({ [updateField]: tpResult.data.orderId })
          .eq('id', position.id)
          .eq('user_id', position.user_id);
        actions.push(`Placed missing TP${expectedTP.level} order`);
        console.log(`✅ TP${expectedTP.level} order placed: ${tpResult.data.orderId}`);
      } else {
        console.error(`❌ Failed to place TP${expectedTP.level}:`, tpResult);
      }
    } else {
      // Mark this order as used
      usedOrderIds.add(matchingOrder.orderId);
      console.log(`✅ TP${expectedTP.level} exists on exchange (order: ${matchingOrder.orderId})`);
    }
  }

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
