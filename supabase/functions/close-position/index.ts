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

    const { position_id, reason } = await req.json();
    console.log('Closing position:', position_id, 'Reason:', reason);

    // Get position
    const { data: position, error: positionError } = await supabase
      .from('positions')
      .select('*')
      .eq('id', position_id)
      .single();

    if (positionError) throw positionError;
    if (!position) throw new Error('Position not found');
    if (position.status !== 'open') throw new Error('Position is not open');

    // Get current market price
    const { data: tickerResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_ticker',
        params: { symbol: position.symbol }
      }
    });

    const closePrice = tickerResult?.success 
      ? Number(tickerResult.data.last) 
      : Number(position.entry_price);

    // Close position on Bitget
    const closeSide = position.side === 'BUY' ? 'close_long' : 'close_short';
    
    const { data: closeResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'close_position',
        params: {
          symbol: position.symbol,
          size: position.quantity.toString(),
          side: closeSide,
        }
      }
    });

    if (!closeResult?.success) {
      throw new Error('Failed to close position on Bitget');
    }

    // Cancel all pending orders (SL/TP)
    const orderIds = [
      position.sl_order_id,
      position.tp1_order_id,
      position.tp2_order_id,
      position.tp3_order_id,
    ].filter(Boolean);

    for (const orderId of orderIds) {
      try {
        await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'cancel_plan_order',
            params: {
              symbol: position.symbol,
              orderId: orderId,
            }
          }
        });
      } catch (error) {
        console.error('Failed to cancel order:', orderId, error);
      }
    }

    // Calculate realized PnL
    const priceDiff = position.side === 'BUY'
      ? closePrice - Number(position.entry_price)
      : Number(position.entry_price) - closePrice;
    const realizedPnl = priceDiff * Number(position.quantity) * position.leverage;

    // Update position in database
    const { error: updateError } = await supabase
      .from('positions')
      .update({
        status: 'closed',
        close_price: closePrice,
        close_reason: reason || 'manual',
        closed_at: new Date().toISOString(),
        realized_pnl: realizedPnl,
      })
      .eq('id', position_id);

    if (updateError) throw updateError;

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

    console.log('Position closed successfully:', position_id, 'PnL:', realizedPnl);

    return new Response(JSON.stringify({ 
      success: true, 
      realized_pnl: realizedPnl,
      close_price: closePrice 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Close position error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
