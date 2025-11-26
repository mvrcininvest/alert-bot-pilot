import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { log } from "../_shared/logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper function to get price precision from Bitget API
async function getPricePrecision(supabase: any, symbol: string): Promise<number> {
  const { data: symbolInfoResult } = await supabase.functions.invoke('bitget-api', {
    body: {
      action: 'get_symbol_info',
      params: { symbol }
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

    // Get settings
    const { data: settings } = await supabase
      .from('settings')
      .select('*')
      .single();

    const autoRepair = settings?.auto_repair || false;
    
    await log({
      functionName: 'position-monitor',
      message: 'Settings loaded',
      level: 'info',
      metadata: { autoRepair }
    });

    // Check each position with full verification
    for (const position of positions) {
      try {
        await log({
          functionName: 'position-monitor',
          message: `🔥 Checking position ${position.symbol}`,
          level: 'info',
          positionId: position.id,
          metadata: { symbol: position.symbol, side: position.side }
        });
        await checkPositionFullVerification(supabase, position, autoRepair, settings);
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
          .eq('id', position.id);
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

async function checkPositionFullVerification(supabase: any, position: any, autoRepair: boolean, settings: any) {
  console.log(`🔥 Full verification for ${position.id} - ${position.symbol}`);

  const issues: any[] = [];
  const actions: string[] = [];
  
  // Get price precision for this symbol
  const pricePlace = await getPricePrecision(supabase, position.symbol);
  console.log(`📏 Price precision for ${position.symbol}: ${pricePlace} decimals`);

  // 1. Get current position from Bitget
  const { data: positionResult } = await supabase.functions.invoke('bitget-api', {
    body: {
      action: 'get_position',
      params: { symbol: position.symbol }
    }
  });

  if (!positionResult?.success || !positionResult.data || !positionResult.data[0]) {
    await log({
      functionName: 'position-monitor',
      message: `❌ Position not found on exchange: ${position.symbol}`,
      level: 'error',
      positionId: position.id
    });
    
    // Position in DB but not on exchange - close it in DB
    await supabase
      .from('positions')
      .update({
        status: 'closed',
        close_reason: 'Position not found on exchange',
        closed_at: new Date().toISOString()
      })
      .eq('id', position.id);
    
    return;
  }

  const bitgetPosition = positionResult.data[0];
  
  // 2. Get current price
  const { data: tickerResult } = await supabase.functions.invoke('bitget-api', {
    body: {
      action: 'get_ticker',
      params: { symbol: position.symbol }
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
      }
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
    
    // Auto-repair: Place SL order using TPSL endpoint
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
          }
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
          .eq('id', position.id);
          
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
              }
            }
          });
          
          if (closeResult?.success) {
            await supabase
              .from('positions')
              .update({
                status: 'closed',
                close_reason: 'Emergency close - failed to set SL after 2 attempts',
                close_price: currentPrice,
                closed_at: new Date().toISOString()
              })
              .eq('id', position.id);
            
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
            metadata: { ...metadata, sl_repair_attempts: 0 } // Reset on success
          })
          .eq('id', position.id);
        actions.push('Placed missing SL order');
        console.log(`✅ SL order placed: ${slResult.data.orderId}`);
        
        // Log successful repair
        await supabase
          .from('monitoring_logs')
          .insert({
            position_id: position.id,
            check_type: 'sl_repair',
            status: 'success',
            issues: [{ type: 'missing_sl', severity: 'critical' }],
            actions_taken: `Successfully placed SL order: ${slResult.data.orderId}`,
            expected_data: { sl_price: position.sl_price },
            actual_data: { sl_order_id: slResult.data.orderId }
          });
      } else {
        console.error(`❌ Failed to place SL order:`, JSON.stringify(slResult));
        await log({
          functionName: 'position-monitor',
          message: 'Failed to place SL order during auto-repair',
          level: 'error',
          positionId: position.id,
          metadata: { error: slResult?.error || 'Unknown error', result: slResult, attempts: slRepairAttempts + 1 }
        });
        
        // Update repair attempts
        await supabase
          .from('positions')
          .update({ 
            metadata: { ...metadata, sl_repair_attempts: slRepairAttempts + 1 }
          })
          .eq('id', position.id);
          
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
              }
            }
          });
          
          if (closeResult?.success) {
            await supabase
              .from('positions')
              .update({
                status: 'closed',
                close_reason: 'Emergency close - failed to set SL after 2 attempts',
                close_price: currentPrice,
                closed_at: new Date().toISOString()
              })
              .eq('id', position.id);
            
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
        } else {
          // Log failed repair attempt
          await supabase
            .from('monitoring_logs')
            .insert({
              position_id: position.id,
              check_type: 'sl_repair',
              status: 'failed',
              issues: [{ type: 'missing_sl', severity: 'critical' }],
              actions_taken: `Failed to place SL order (attempt ${slRepairAttempts + 1}/2)`,
              expected_data: { sl_price: position.sl_price },
              actual_data: { error: slResult?.error || 'Unknown error' }
            });
        }
      }
    }
  }

  // 6. Check if TP orders exist (if configured)
  const tpOrders = planOrders.filter((order: any) => 
    (order.planType === 'pos_profit' || order.planType === 'profit_plan' || 
     (order.planType === 'profit_loss' && order.stopSurplusTriggerPrice)) &&
    order.planStatus === 'live'
  );
  
  const expectedTPs = [position.tp1_price, position.tp2_price, position.tp3_price].filter(Boolean).length;
  
  if (expectedTPs > 0 && tpOrders.length === 0) {
    issues.push({
      type: 'missing_tp',
      severity: 'high',
      message: 'No Take Profit orders found on exchange',
      expected: expectedTPs,
      actual: 0
    });
    console.log(`⚠️ No TP orders found for ${position.symbol}, expected ${expectedTPs}`);
    
    // Auto-repair: Place TP orders using TPSL endpoint
    if (autoRepair) {
      console.log(`🔧 Auto-repairing: Placing TP orders`);
      const holdSide = position.side === 'BUY' ? 'long' : 'short';
      const metadata = position.metadata || {};
      const tpRepairAttempts = metadata.tp_repair_attempts || 0;
      
      let tpRepairFailed = false;
      
      if (position.tp1_price) {
        const tp1Qty = bitgetQuantity * (settings?.tp1_close_percent || 100) / 100;
        const roundedTp1Price = roundPrice(position.tp1_price, pricePlace);
        
        const { data: tp1Result, error: tp1Error } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'place_tpsl_order',
            params: {
              symbol: position.symbol,
              planType: 'pos_profit',
              triggerPrice: roundedTp1Price,
              triggerType: 'mark_price',
              holdSide: holdSide,
              executePrice: 0, // Market order
              size: tp1Qty.toString(), // Partial TP
            }
          }
        });
        
        if (tp1Error || !tp1Result?.success) {
          tpRepairFailed = true;
          console.error(`❌ Failed to place TP1 order:`, tp1Error || tp1Result);
          await log({
            functionName: 'position-monitor',
            message: 'Failed to place TP1 order during auto-repair',
            level: 'error',
            positionId: position.id,
            metadata: { error: tp1Error || tp1Result?.error || 'Unknown error', attempts: tpRepairAttempts + 1 }
          });
        } else {
          await supabase
            .from('positions')
            .update({ 
              tp1_order_id: tp1Result.data.orderId,
              tp1_quantity: tp1Qty
            })
            .eq('id', position.id);
          actions.push('Placed missing TP1 order');
          console.log(`✅ TP1 order placed: ${tp1Result.data.orderId}`);
          
          // Log successful repair
          await supabase
            .from('monitoring_logs')
            .insert({
              position_id: position.id,
              check_type: 'tp_repair',
              status: 'success',
              issues: [{ type: 'missing_tp', severity: 'high' }],
              actions_taken: `Successfully placed TP1 order: ${tp1Result.data.orderId}`,
              expected_data: { tp1_price: position.tp1_price },
              actual_data: { tp1_order_id: tp1Result.data.orderId }
            });
        }
      }
      
      if (position.tp2_price && !tpRepairFailed) {
        const tp2Qty = bitgetQuantity * (settings?.tp2_close_percent || 0) / 100;
        if (tp2Qty > 0) {
          const roundedTp2Price = roundPrice(position.tp2_price, pricePlace);
          
          const { data: tp2Result, error: tp2Error } = await supabase.functions.invoke('bitget-api', {
            body: {
              action: 'place_tpsl_order',
              params: {
                symbol: position.symbol,
                planType: 'pos_profit',
                triggerPrice: roundedTp2Price,
                triggerType: 'mark_price',
                holdSide: holdSide,
                executePrice: 0,
                size: tp2Qty.toString(),
              }
            }
          });
          
          if (tp2Error || !tp2Result?.success) {
            tpRepairFailed = true;
            console.error(`❌ Failed to place TP2 order:`, tp2Error || tp2Result);
          } else {
            await supabase
              .from('positions')
              .update({ 
                tp2_order_id: tp2Result.data.orderId,
                tp2_quantity: tp2Qty
              })
              .eq('id', position.id);
            actions.push('Placed missing TP2 order');
            console.log(`✅ TP2 order placed: ${tp2Result.data.orderId}`);
          }
        }
      }
      
      if (tpRepairFailed) {
        // Update repair attempts
        await supabase
          .from('positions')
          .update({ 
            metadata: { ...metadata, tp_repair_attempts: tpRepairAttempts + 1 }
          })
          .eq('id', position.id);
          
        // If 2nd attempt failed, log as failed but don't emergency close (TP is not critical like SL)
        if (tpRepairAttempts >= 1) {
          console.log(`⚠️ 2nd TP repair attempt failed for ${position.symbol}`);
          
          await log({
            functionName: 'position-monitor',
            message: `Failed to set TP after 2 attempts: ${position.symbol}`,
            level: 'warn',
            positionId: position.id,
            metadata: { reason: 'Failed to set TP after 2 attempts' }
          });
          
          // Log to monitoring_logs
          await supabase
            .from('monitoring_logs')
            .insert({
              position_id: position.id,
              check_type: 'tp_repair',
              status: 'failed',
              issues: [{ type: 'missing_tp', severity: 'high' }],
              actions_taken: `Failed to place TP order after 2 attempts - position continues without TP`,
              expected_data: { tp1_price: position.tp1_price, tp2_price: position.tp2_price },
              actual_data: { tp_missing: true }
            });
        } else {
          // Log failed repair attempt
          await supabase
            .from('monitoring_logs')
            .insert({
              position_id: position.id,
              check_type: 'tp_repair',
              status: 'failed',
              issues: [{ type: 'missing_tp', severity: 'high' }],
              actions_taken: `Failed to place TP order (attempt ${tpRepairAttempts + 1}/2)`,
              expected_data: { tp1_price: position.tp1_price },
              actual_data: { error: 'Failed to place TP order' }
            });
        }
      } else {
        // Reset attempts on success
        await supabase
          .from('positions')
          .update({ 
            metadata: { ...metadata, tp_repair_attempts: 0 }
          })
          .eq('id', position.id);
      }
    }
  }

  // 7. Compare SL/TP order levels and quantities with planned values
  const deviations: any[] = [];
  
  // Check SL order level deviation
  if (slOrders.length > 0) {
    const actualSlPrice = Number(slOrders[0].triggerPrice || slOrders[0].stopLossTriggerPrice);
    const plannedSlPrice = Number(position.sl_price);
    const slPriceDiff = Math.abs(actualSlPrice - plannedSlPrice);
    const slPriceDeviation = (slPriceDiff / plannedSlPrice) * 100;
    
    if (slPriceDeviation > 0.1) { // More than 0.1% deviation
      deviations.push({
        type: 'sl_price_deviation',
        planned: plannedSlPrice,
        actual: actualSlPrice,
        difference: slPriceDiff,
        deviation_percent: slPriceDeviation.toFixed(2)
      });
      console.log(`📊 SL price deviation: Planned ${plannedSlPrice}, Actual ${actualSlPrice} (${slPriceDeviation.toFixed(2)}%)`);
    }
  }
  
  // Check TP order levels deviation
  if (tpOrders.length > 0) {
    tpOrders.forEach((tpOrder: any, index: number) => {
      const actualTpPrice = Number(tpOrder.triggerPrice || tpOrder.stopSurplusTriggerPrice);
      let plannedTpPrice = null;
      let tpLabel = '';
      
      // Match TP order to planned TP level
      if (position.tp1_price && Math.abs(actualTpPrice - Number(position.tp1_price)) < Math.abs(actualTpPrice - Number(position.tp2_price || 99999999))) {
        plannedTpPrice = Number(position.tp1_price);
        tpLabel = 'TP1';
      } else if (position.tp2_price) {
        plannedTpPrice = Number(position.tp2_price);
        tpLabel = 'TP2';
      } else if (position.tp3_price) {
        plannedTpPrice = Number(position.tp3_price);
        tpLabel = 'TP3';
      }
      
      if (plannedTpPrice) {
        const tpPriceDiff = Math.abs(actualTpPrice - plannedTpPrice);
        const tpPriceDeviation = (tpPriceDiff / plannedTpPrice) * 100;
        
        if (tpPriceDeviation > 0.1) {
          deviations.push({
            type: `${tpLabel.toLowerCase()}_price_deviation`,
            label: tpLabel,
            planned: plannedTpPrice,
            actual: actualTpPrice,
            difference: tpPriceDiff,
            deviation_percent: tpPriceDeviation.toFixed(2)
          });
          console.log(`📊 ${tpLabel} price deviation: Planned ${plannedTpPrice}, Actual ${actualTpPrice} (${tpPriceDeviation.toFixed(2)}%)`);
        }
      }
      
      // Check TP quantity deviation
      const actualTpSize = Number(tpOrder.size || 0);
      if (actualTpSize > 0) {
        let plannedTpQty = 0;
        if (tpLabel === 'TP1') plannedTpQty = Number(position.tp1_quantity || 0);
        else if (tpLabel === 'TP2') plannedTpQty = Number(position.tp2_quantity || 0);
        else if (tpLabel === 'TP3') plannedTpQty = Number(position.tp3_quantity || 0);
        
        if (plannedTpQty > 0) {
          const qtyDiff = Math.abs(actualTpSize - plannedTpQty);
          const qtyDeviation = (qtyDiff / plannedTpQty) * 100;
          
          if (qtyDeviation > 0.1) {
            deviations.push({
              type: `${tpLabel.toLowerCase()}_quantity_deviation`,
              label: tpLabel,
              planned: plannedTpQty,
              actual: actualTpSize,
              difference: qtyDiff,
              deviation_percent: qtyDeviation.toFixed(2)
            });
            console.log(`📊 ${tpLabel} quantity deviation: Planned ${plannedTpQty}, Actual ${actualTpSize} (${qtyDeviation.toFixed(2)}%)`);
          }
        }
      }
    });
  }
  
  // Log deviations if any found
  if (deviations.length > 0) {
    await supabase
      .from('monitoring_logs')
      .insert({
        position_id: position.id,
        check_type: 'deviations',
        status: 'warning',
        issues: deviations,
        actions_taken: `Found ${deviations.length} deviation(s) between planned and actual values`,
        expected_data: {
          sl_price: position.sl_price,
          tp1_price: position.tp1_price,
          tp2_price: position.tp2_price,
          tp3_price: position.tp3_price,
          tp1_quantity: position.tp1_quantity,
          tp2_quantity: position.tp2_quantity,
          tp3_quantity: position.tp3_quantity,
          quantity: dbQuantity
        },
        actual_data: {
          sl_orders: slOrders.map((o: any) => ({ price: o.triggerPrice || o.stopLossTriggerPrice })),
          tp_orders: tpOrders.map((o: any) => ({ price: o.triggerPrice || o.stopSurplusTriggerPrice, size: o.size })),
          quantity: bitgetQuantity
        }
      });
  }

  // 8. Check if price has crossed SL or TP levels
  const isBuy = position.side === 'BUY';
  const slPrice = Number(position.sl_price);
  const tp1Price = position.tp1_price ? Number(position.tp1_price) : null;
  const tp2Price = position.tp2_price ? Number(position.tp2_price) : null;
  const tp3Price = position.tp3_price ? Number(position.tp3_price) : null;

  // Check if SL was hit
  const slHit = isBuy ? currentPrice <= slPrice : currentPrice >= slPrice;
  if (slHit) {
    console.log(`❌ CRITICAL: SL level hit for ${position.symbol}! Closing position at market`);
    issues.push({
      type: 'sl_hit',
      severity: 'critical',
      currentPrice,
      slPrice
    });
    
    // Close position immediately at market
    const closeSide = isBuy ? 'close_long' : 'close_short';
    const { data: closeResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'place_order',
        params: {
          symbol: position.symbol,
          size: bitgetQuantity.toString(),
          side: closeSide,
        }
      }
    });
    
    if (closeResult?.success) {
      await supabase
        .from('positions')
        .update({
          status: 'closed',
          close_reason: 'SL hit - closed by monitor',
          close_price: currentPrice,
          closed_at: new Date().toISOString()
        })
        .eq('id', position.id);
      actions.push(`Closed position at market due to SL hit (${currentPrice})`);
    }
    
    return; // Position closed, no further checks needed
  }

  // Check if TP1 was hit
  if (tp1Price && !position.tp1_filled) {
    const tp1Hit = isBuy ? currentPrice >= tp1Price : currentPrice <= tp1Price;
    if (tp1Hit) {
      console.log(`✅ TP1 hit for ${position.symbol}! Closing partial position`);
      issues.push({
        type: 'tp1_hit',
        severity: 'info',
        currentPrice,
        tp1Price
      });
      
      // Close partial position at market
      const tp1Qty = bitgetQuantity * (settings?.tp1_close_percent || 100) / 100;
      const closeSide = isBuy ? 'close_long' : 'close_short';
      const { data: closeResult } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'place_order',
          params: {
            symbol: position.symbol,
            size: tp1Qty.toString(),
            side: closeSide,
          }
        }
      });
      
      if (closeResult?.success) {
        await supabase
          .from('positions')
          .update({
            tp1_filled: true,
            quantity: bitgetQuantity - tp1Qty
          })
          .eq('id', position.id);
        actions.push(`Closed ${tp1Qty} at market due to TP1 hit (${currentPrice})`);
      }
    }
  }

  // Check if TP2 was hit
  if (tp2Price && !position.tp2_filled && position.tp1_filled) {
    const tp2Hit = isBuy ? currentPrice >= tp2Price : currentPrice <= tp2Price;
    if (tp2Hit) {
      console.log(`✅ TP2 hit for ${position.symbol}! Closing partial position`);
      const tp2Qty = bitgetQuantity * (settings?.tp2_close_percent || 0) / 100;
      if (tp2Qty > 0) {
        const closeSide = isBuy ? 'close_long' : 'close_short';
        const { data: closeResult } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'place_order',
            params: {
              symbol: position.symbol,
              size: tp2Qty.toString(),
              side: closeSide,
            }
          }
        });
        
        if (closeResult?.success) {
          await supabase
            .from('positions')
            .update({
              tp2_filled: true,
              quantity: bitgetQuantity - tp2Qty
            })
            .eq('id', position.id);
          actions.push(`Closed ${tp2Qty} at market due to TP2 hit (${currentPrice})`);
        }
      }
    }
  }

  // 8. Calculate unrealized PnL
  const entryPrice = Number(position.entry_price);
  const priceDiff = isBuy ? currentPrice - entryPrice : entryPrice - currentPrice;
  const unrealizedPnl = priceDiff * bitgetQuantity;

  // 9. Update position in DB
  await supabase
    .from('positions')
    .update({
      current_price: currentPrice,
      unrealized_pnl: unrealizedPnl,
      last_check_at: new Date().toISOString(),
      check_errors: 0,
      last_error: null
    })
    .eq('id', position.id);

  // 10. Log monitoring result
  const logStatus = issues.length > 0 ? (issues.some(i => i.severity === 'critical') ? 'critical' : 'warning') : 'ok';
  
  await supabase
    .from('monitoring_logs')
    .insert({
      position_id: position.id,
      check_type: 'full_verification',
      status: logStatus,
      expected_data: {
        quantity: dbQuantity,
        sl_price: slPrice,
        tp_prices: [tp1Price, tp2Price, tp3Price].filter(Boolean),
        has_sl_order: true,
        has_tp_orders: expectedTPs
      },
      actual_data: {
        quantity: bitgetQuantity,
        current_price: currentPrice,
        sl_orders_count: slOrders.length,
        tp_orders_count: tpOrders.length,
        unrealized_pnl: unrealizedPnl
      },
      issues: issues.length > 0 ? issues : null,
      actions_taken: actions.length > 0 ? actions.join('; ') : null,
    });

  await log({
    functionName: 'position-monitor',
    message: `✅ Verification complete for ${position.symbol}: ${issues.length} issues, ${actions.length} actions`,
    level: issues.length > 0 ? 'warn' : 'info',
    positionId: position.id,
    metadata: { 
      issues: issues.length,
      actions: actions.length,
      currentPrice,
      unrealizedPnl
    }
  });
}
