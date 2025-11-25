import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { calculatePositionSize, calculateSLTP } from "./calculators.ts";

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

    const { alert_id, alert_data, settings } = await req.json();
    console.log('Opening position for alert:', alert_id);

    // Check if we've reached max open positions
    const { data: openPositions, error: countError } = await supabase
      .from('positions')
      .select('id', { count: 'exact' })
      .eq('status', 'open');

    if (countError) throw countError;

    if (openPositions && openPositions.length >= settings.max_open_positions) {
      console.log('Max open positions reached');
      await supabase
        .from('alerts')
        .update({ 
          status: 'ignored', 
          error_message: 'Max open positions reached' 
        })
        .eq('id', alert_id);
      
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Max open positions reached' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check daily loss limit
    const today = new Date().toISOString().split('T')[0];
    const { data: todayPositions } = await supabase
      .from('positions')
      .select('realized_pnl')
      .eq('status', 'closed')
      .gte('closed_at', `${today}T00:00:00`)
      .lte('closed_at', `${today}T23:59:59`);

    const todayPnL = todayPositions?.reduce((sum, pos) => sum + (Number(pos.realized_pnl) || 0), 0) || 0;
    console.log('Today PnL:', todayPnL);

    // Check loss limit based on type
    if (settings.loss_limit_type === 'percent_drawdown') {
      // Get account balance
      const { data: accountData } = await supabase.functions.invoke('bitget-api', {
        body: { action: 'get_account' }
      });
      
      const accountBalance = accountData?.success && accountData.data?.[0]?.available 
        ? Number(accountData.data[0].available)
        : 10000; // fallback
      
      const maxLossAmount = accountBalance * ((settings.daily_loss_percent || 5) / 100);
      
      if (Math.abs(todayPnL) >= maxLossAmount) {
        console.log(`Daily drawdown limit reached: ${Math.abs(todayPnL).toFixed(2)} USDT (${settings.daily_loss_percent}% of ${accountBalance.toFixed(2)} USDT)`);
        await supabase
          .from('alerts')
          .update({ 
            status: 'ignored', 
            error_message: `Daily loss limit reached: ${Math.abs(todayPnL).toFixed(2)} USDT (${settings.daily_loss_percent}% of capital)` 
          })
          .eq('id', alert_id);
        
        return new Response(JSON.stringify({ 
          success: false, 
          message: `Daily loss limit reached: ${Math.abs(todayPnL).toFixed(2)} USDT (${settings.daily_loss_percent}% of ${accountBalance.toFixed(2)} USDT)` 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      // Fixed USDT limit
      if (Math.abs(todayPnL) >= (settings.daily_loss_limit || 500)) {
        console.log(`Daily loss limit reached: ${Math.abs(todayPnL).toFixed(2)} / ${settings.daily_loss_limit} USDT`);
        await supabase
          .from('alerts')
          .update({ 
            status: 'ignored', 
            error_message: `Daily loss limit reached: ${Math.abs(todayPnL).toFixed(2)} USDT` 
          })
          .eq('id', alert_id);
        
        return new Response(JSON.stringify({ 
          success: false, 
          message: `Daily loss limit reached: ${Math.abs(todayPnL).toFixed(2)} / ${settings.daily_loss_limit} USDT` 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Get account balance (placeholder - would call Bitget API)
    const accountBalance = 10000; // TODO: Get from Bitget

    // Calculate position size
    const quantity = calculatePositionSize(settings, alert_data, accountBalance);
    console.log('Calculated quantity:', quantity);

    // Calculate SL/TP prices
    const { sl_price, tp1_price, tp2_price, tp3_price } = calculateSLTP(
      alert_data,
      settings,
      quantity
    );
    console.log('Calculated prices:', { sl_price, tp1_price, tp2_price, tp3_price });

    // Call Bitget API to place order
    const side = alert_data.side === 'BUY' ? 'open_long' : 'open_short';
    
    const { data: orderResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'place_order',
        params: {
          symbol: alert_data.symbol,
          size: quantity.toString(),
          side: side,
        }
      }
    });

    if (!orderResult?.success) {
      throw new Error('Failed to place order on Bitget');
    }

    const orderId = orderResult.data.orderId;
    console.log('Order placed:', orderId);

    // Place Stop Loss order
    const slSide = alert_data.side === 'BUY' ? 'close_long' : 'close_short';
    const { data: slResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'place_plan_order',
        params: {
          symbol: alert_data.symbol,
          size: quantity.toString(),
          side: slSide,
          orderType: 'market',
          triggerPrice: sl_price.toString(),
          executePrice: sl_price.toString(),
          planType: 'loss_plan',
        }
      }
    });

    const slOrderId = slResult?.success ? slResult.data.orderId : null;

    // Calculate quantities for partial TP closing
    const tp1Quantity = tp1_price && settings.tp_strategy === 'partial_close' 
      ? quantity * (settings.tp1_close_percent / 100) 
      : quantity;
    const tp2Quantity = tp2_price && settings.tp_strategy === 'partial_close'
      ? quantity * (settings.tp2_close_percent / 100)
      : 0;
    const tp3Quantity = tp3_price && settings.tp_strategy === 'partial_close'
      ? quantity * (settings.tp3_close_percent / 100)
      : 0;

    // Place TP orders
    let tp1OrderId, tp2OrderId, tp3OrderId;

    if (tp1_price && tp1Quantity > 0) {
      const { data: tp1Result } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'place_plan_order',
          params: {
            symbol: alert_data.symbol,
            size: tp1Quantity.toString(),
            side: slSide,
            orderType: 'market',
            triggerPrice: tp1_price.toString(),
            executePrice: tp1_price.toString(),
            planType: 'profit_plan',
          }
        }
      });
      tp1OrderId = tp1Result?.success ? tp1Result.data.orderId : null;
    }

    if (tp2_price && tp2Quantity > 0) {
      const { data: tp2Result } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'place_plan_order',
          params: {
            symbol: alert_data.symbol,
            size: tp2Quantity.toString(),
            side: slSide,
            orderType: 'market',
            triggerPrice: tp2_price.toString(),
            executePrice: tp2_price.toString(),
            planType: 'profit_plan',
          }
        }
      });
      tp2OrderId = tp2Result?.success ? tp2Result.data.orderId : null;
    }

    if (tp3_price && tp3Quantity > 0) {
      const { data: tp3Result } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'place_plan_order',
          params: {
            symbol: alert_data.symbol,
            size: tp3Quantity.toString(),
            side: slSide,
            orderType: 'market',
            triggerPrice: tp3_price.toString(),
            executePrice: tp3_price.toString(),
            planType: 'profit_plan',
          }
        }
      });
      tp3OrderId = tp3Result?.success ? tp3Result.data.orderId : null;
    }

    // Save position to database
    const { data: position, error: positionError } = await supabase
      .from('positions')
      .insert({
        alert_id: alert_id,
        bitget_order_id: orderId,
        symbol: alert_data.symbol,
        side: alert_data.side,
        entry_price: alert_data.price,
        quantity: quantity,
        leverage: alert_data.leverage,
        sl_price: sl_price,
        sl_order_id: slOrderId,
        tp1_price: tp1_price,
        tp1_quantity: tp1Quantity,
        tp1_order_id: tp1OrderId,
        tp2_price: tp2_price,
        tp2_quantity: tp2Quantity,
        tp2_order_id: tp2OrderId,
        tp3_price: tp3_price,
        tp3_quantity: tp3Quantity,
        tp3_order_id: tp3OrderId,
        status: 'open',
        metadata: {
          settings_snapshot: settings,
          alert_data: alert_data,
        }
      })
      .select()
      .single();

    if (positionError) throw positionError;

    // Update alert status
    await supabase
      .from('alerts')
      .update({ 
        status: 'executed', 
        executed_at: new Date().toISOString(),
        position_id: position.id 
      })
      .eq('id', alert_id);

    console.log('Position opened successfully:', position.id);

    return new Response(JSON.stringify({ 
      success: true, 
      position_id: position.id,
      order_id: orderId 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Trader error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
