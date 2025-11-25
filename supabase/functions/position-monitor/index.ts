import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { log } from "../_shared/logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

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
    
    // Auto-repair: Place SL order
    if (autoRepair) {
      console.log(`🔧 Auto-repairing: Placing SL order`);
      const slSide = position.side === 'BUY' ? 'close_long' : 'close_short';
      const { data: slResult } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'place_plan_order',
          params: {
            symbol: position.symbol,
            size: bitgetQuantity.toString(),
            side: slSide,
            orderType: 'market',
            triggerPrice: position.sl_price.toString(),
            executePrice: position.sl_price.toString(),
            planType: 'pos_loss',
          }
        }
      });
      
      if (slResult?.success) {
        await supabase
          .from('positions')
          .update({ sl_order_id: slResult.data.orderId })
          .eq('id', position.id);
        actions.push('Placed missing SL order');
        console.log(`✅ SL order placed: ${slResult.data.orderId}`);
      } else {
        console.error(`❌ Failed to place SL order:`, JSON.stringify(slResult));
        await log({
          functionName: 'position-monitor',
          message: 'Failed to place SL order during auto-repair',
          level: 'error',
          positionId: position.id,
          metadata: { error: slResult?.error || 'Unknown error', result: slResult }
        });
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
    
    // Auto-repair: Place TP orders
    if (autoRepair) {
      console.log(`🔧 Auto-repairing: Placing TP orders`);
      const tpSide = position.side === 'BUY' ? 'close_long' : 'close_short';
      
      if (position.tp1_price) {
        const tp1Qty = bitgetQuantity * (settings?.tp1_close_percent || 100) / 100;
        const { data: tp1Result } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'place_plan_order',
            params: {
              symbol: position.symbol,
              size: tp1Qty.toString(),
              side: tpSide,
              orderType: 'market',
              triggerPrice: position.tp1_price.toString(),
              executePrice: position.tp1_price.toString(),
              planType: 'pos_profit',
            }
          }
        });
        
        if (tp1Result?.success) {
          await supabase
            .from('positions')
            .update({ 
              tp1_order_id: tp1Result.data.orderId,
              tp1_quantity: tp1Qty
            })
            .eq('id', position.id);
          actions.push('Placed missing TP1 order');
          console.log(`✅ TP1 order placed: ${tp1Result.data.orderId}`);
        } else {
          console.error(`❌ Failed to place TP1 order:`, JSON.stringify(tp1Result));
          await log({
            functionName: 'position-monitor',
            message: 'Failed to place TP1 order during auto-repair',
            level: 'error',
            positionId: position.id,
            metadata: { error: tp1Result?.error || 'Unknown error', result: tp1Result }
          });
        }
      }
      
      if (position.tp2_price) {
        const tp2Qty = bitgetQuantity * (settings?.tp2_close_percent || 0) / 100;
        if (tp2Qty > 0) {
          const { data: tp2Result } = await supabase.functions.invoke('bitget-api', {
            body: {
              action: 'place_plan_order',
              params: {
                symbol: position.symbol,
                size: tp2Qty.toString(),
                side: tpSide,
                orderType: 'market',
                triggerPrice: position.tp2_price.toString(),
                executePrice: position.tp2_price.toString(),
                planType: 'pos_profit',
              }
            }
          });
          
          if (tp2Result?.success) {
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
    }
  }

  // 7. Check if price has crossed SL or TP levels
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
