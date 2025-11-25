import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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

    console.log('Starting position monitoring cycle');

    // Get all open positions
    const { data: positions, error: positionsError } = await supabase
      .from('positions')
      .select('*')
      .eq('status', 'open');

    if (positionsError) throw positionsError;

    if (!positions || positions.length === 0) {
      console.log('No open positions to monitor');
      return new Response(JSON.stringify({ message: 'No open positions' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Monitoring ${positions.length} positions`);

    // Get settings for auto-repair
    const { data: settings } = await supabase
      .from('settings')
      .select('*')
      .single();

    const autoRepair = settings?.auto_repair || false;

    // Check each position
    for (const position of positions) {
      try {
        await checkPosition(supabase, position, autoRepair);
      } catch (error) {
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

    // Handle breakeven and trailing stop
    for (const position of positions) {
      try {
        await handleBreakevenAndTrailing(supabase, position, settings);
      } catch (error) {
        console.error(`Error handling breakeven/trailing for ${position.id}:`, error);
      }
    }

    return new Response(JSON.stringify({ 
      success: true, 
      positions_checked: positions.length 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Monitor error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

async function checkPosition(supabase: any, position: any, autoRepair: boolean) {
  console.log(`Checking position ${position.id} - ${position.symbol}`);

  // Get current position from Bitget
  const { data: bitgetResult } = await supabase.functions.invoke('bitget-api', {
    body: {
      action: 'get_position',
      params: { symbol: position.symbol }
    }
  });

  if (!bitgetResult?.success || !bitgetResult.data) {
    throw new Error('Failed to get position from Bitget');
  }

  const bitgetPosition = bitgetResult.data;
  const issues: any[] = [];
  const expectedData: any = {
    quantity: position.quantity,
    sl_price: position.sl_price,
    tp_prices: [position.tp1_price, position.tp2_price, position.tp3_price].filter(Boolean),
  };

  const actualData: any = {
    quantity: bitgetPosition.total,
    available: bitgetPosition.available,
    current_price: bitgetPosition.marketPrice,
  };

  // Check quantity
  if (Math.abs(Number(bitgetPosition.total) - Number(position.quantity)) > 0.0001) {
    issues.push({
      type: 'quantity_mismatch',
      expected: position.quantity,
      actual: bitgetPosition.total,
    });
  }

  // Get current price for PnL calculation
  const { data: tickerResult } = await supabase.functions.invoke('bitget-api', {
    body: {
      action: 'get_ticker',
      params: { symbol: position.symbol }
    }
  });

  if (tickerResult?.success) {
    const currentPrice = Number(tickerResult.data.last);
    actualData.current_price = currentPrice;

    // Calculate unrealized PnL
    const priceDiff = position.side === 'BUY'
      ? currentPrice - Number(position.entry_price)
      : Number(position.entry_price) - currentPrice;
    const unrealizedPnl = priceDiff * Number(position.quantity) * position.leverage;

    // Update position with current price and PnL
    await supabase
      .from('positions')
      .update({
        current_price: currentPrice,
        unrealized_pnl: unrealizedPnl,
        last_check_at: new Date().toISOString(),
      })
      .eq('id', position.id);
  }

  // Log monitoring result
  const logStatus = issues.length > 0 ? 'mismatch' : 'ok';
  
  await supabase
    .from('monitoring_logs')
    .insert({
      position_id: position.id,
      check_type: 'routine',
      status: logStatus,
      expected_data: expectedData,
      actual_data: actualData,
      issues: issues.length > 0 ? issues : null,
      actions_taken: autoRepair && issues.length > 0 ? 'Auto-repair attempted' : null,
    });

  // Auto-repair if enabled
  if (autoRepair && issues.length > 0) {
    console.log(`Auto-repairing position ${position.id}`);
    // TODO: Implement auto-repair logic based on issue types
  }
}

async function handleBreakevenAndTrailing(supabase: any, position: any, settings: any) {
  if (!settings) return;

  const currentPrice = Number(position.current_price);
  if (!currentPrice) return;

  const entryPrice = Number(position.entry_price);
  const slPrice = Number(position.sl_price);
  const isBuy = position.side === 'BUY';

  // Check if TP1 hit for breakeven
  if (settings.sl_to_breakeven && position.tp1_price && !position.tp1_filled) {
    const tp1Price = Number(position.tp1_price);
    const tp1Hit = isBuy ? currentPrice >= tp1Price : currentPrice <= tp1Price;

    if (tp1Hit && settings.breakeven_trigger_tp === 1) {
      console.log(`Moving SL to breakeven for position ${position.id}`);
      
      // Update SL to entry price
      if (position.sl_order_id) {
        const { data: modifyResult } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'modify_plan_order',
            params: {
              symbol: position.symbol,
              orderId: position.sl_order_id,
              triggerPrice: entryPrice.toString(),
              executePrice: entryPrice.toString(),
            }
          }
        });

        if (modifyResult?.success) {
          await supabase
            .from('positions')
            .update({ sl_price: entryPrice })
            .eq('id', position.id);

          await supabase
            .from('monitoring_logs')
            .insert({
              position_id: position.id,
              check_type: 'breakeven',
              status: 'ok',
              actions_taken: 'Moved SL to breakeven after TP1',
            });
        }
      }
    }
  }

  // Check trailing stop
  if (settings.trailing_stop && position.tp1_price && !position.tp1_filled) {
    const tp1Price = Number(position.tp1_price);
    const tp1Hit = isBuy ? currentPrice >= tp1Price : currentPrice <= tp1Price;

    if (tp1Hit && settings.trailing_stop_trigger_tp === 1) {
      const trailingDistance = settings.trailing_stop_distance / 100;
      const newSlPrice = isBuy
        ? currentPrice * (1 - trailingDistance)
        : currentPrice * (1 + trailingDistance);

      // Only update if new SL is better than current
      const shouldUpdate = isBuy 
        ? newSlPrice > slPrice 
        : newSlPrice < slPrice;

      if (shouldUpdate && position.sl_order_id) {
        console.log(`Updating trailing stop for position ${position.id}`);
        
        const { data: modifyResult } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'modify_plan_order',
            params: {
              symbol: position.symbol,
              orderId: position.sl_order_id,
              triggerPrice: newSlPrice.toString(),
              executePrice: newSlPrice.toString(),
            }
          }
        });

        if (modifyResult?.success) {
          await supabase
            .from('positions')
            .update({ sl_price: newSlPrice })
            .eq('id', position.id);

          await supabase
            .from('monitoring_logs')
            .insert({
              position_id: position.id,
              check_type: 'trailing_stop',
              status: 'ok',
              actions_taken: `Updated trailing stop to ${newSlPrice}`,
            });
        }
      }
    }
  }
}
