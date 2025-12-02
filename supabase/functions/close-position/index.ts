import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { log } from "../_shared/logger.ts";
import { getUserApiKeys } from "../_shared/userKeys.ts";

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
    
    await log({
      functionName: 'close-position',
      message: `Closing position: ${reason || 'manual'}`,
      level: 'info',
      positionId: position_id
    });
    console.log('Closing position:', position_id, 'Reason:', reason);

    // Get position
    const { data: position, error: positionError } = await supabase
      .from('positions')
      .select('*')
      .eq('id', position_id)
      .single();

    if (positionError) {
      await log({
        functionName: 'close-position',
        message: 'Failed to fetch position',
        level: 'error',
        positionId: position_id,
        metadata: { error: positionError.message }
      });
      throw positionError;
    }
    if (!position) {
      await log({
        functionName: 'close-position',
        message: 'Position not found',
        level: 'error',
        positionId: position_id
      });
      throw new Error('Position not found');
    }
    if (position.status !== 'open') {
      await log({
        functionName: 'close-position',
        message: 'Position is not open',
        level: 'error',
        positionId: position_id,
        metadata: { status: position.status }
      });
      throw new Error('Position is not open');
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

    // Get current market price
    await log({
      functionName: 'close-position',
      message: 'Fetching market price',
      level: 'info',
      positionId: position_id,
      metadata: { symbol: position.symbol }
    });
    
    const { data: tickerResult } = await supabase.functions.invoke('bybit-api', {
      body: {
        action: 'get_ticker',
        params: { symbol: position.symbol },
        apiCredentials
      }
    });

    const closePrice = tickerResult?.success 
      ? Number(tickerResult.data.last) 
      : Number(position.entry_price);

    // Close position on Bybit
    await log({
      functionName: 'close-position',
      message: 'Closing position on Bybit',
      level: 'info',
      positionId: position_id,
      metadata: { symbol: position.symbol, closePrice }
    });
    
    const closeSide = position.side === 'BUY' ? 'close_long' : 'close_short';
    
    const { data: closeResult, error: closeError } = await supabase.functions.invoke('bybit-api', {
      body: {
        action: 'close_position',
        params: {
          symbol: position.symbol,
          size: position.quantity.toString(),
          side: closeSide,
        },
        apiCredentials
      }
    });

    // Detailed logging for close result
    console.log('Close result from bybit-api:', JSON.stringify(closeResult));
    if (closeError) {
      console.error('Close error:', closeError);
    }

    // Check if close was actually executed
    if (!closeResult?.success || !closeResult?.data?.wasExecuted) {
      await log({
        functionName: 'close-position',
        message: 'Market close failed or not executed, trying flash_close as fallback',
        level: 'warn',
        positionId: position_id,
        metadata: { closeResult, closeError }
      });
      
      // Try flash_close as fallback
      const { data: flashResult, error: flashError } = await supabase.functions.invoke('bybit-api', {
        body: {
          action: 'flash_close_position',
          params: {
            symbol: position.symbol,
            holdSide: position.side === 'BUY' ? 'long' : 'short',
          },
          apiCredentials
        }
      });
      
      console.log('Flash close result:', JSON.stringify(flashResult));
      
      if (!flashResult?.success || !flashResult?.data?.wasExecuted) {
        await log({
          functionName: 'close-position',
          message: 'Both market close and flash_close failed',
          level: 'error',
          positionId: position_id,
          metadata: { closeResult, flashResult, closeError, flashError }
        });
        throw new Error('Failed to close position on Bybit (both market and flash close failed)');
      }
      
      await log({
        functionName: 'close-position',
        message: 'Position closed successfully using flash_close fallback',
        level: 'info',
        positionId: position_id
      });
    }

    // Cancel all pending orders (SL/TP)
    await log({
      functionName: 'close-position',
      message: 'Cancelling pending orders',
      level: 'info',
      positionId: position_id
    });
    
    const orderIds = [
      position.sl_order_id,
      position.tp1_order_id,
      position.tp2_order_id,
      position.tp3_order_id,
    ].filter(Boolean);

    for (const orderId of orderIds) {
      try {
        await supabase.functions.invoke('bybit-api', {
          body: {
            action: 'cancel_plan_order',
            params: {
              symbol: position.symbol,
              orderId: orderId,
            },
            apiCredentials
          }
        });
      } catch (error) {
        await log({
          functionName: 'close-position',
          message: `Failed to cancel order ${orderId}`,
          level: 'warn',
          positionId: position_id,
          metadata: { orderId, error: error instanceof Error ? error.message : 'Unknown' }
        });
        console.error('Failed to cancel order:', orderId, error);
      }
    }

    // Wait a moment for fills to be recorded
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Fetch fill history from Bybit to get accurate close data
    await log({
      functionName: 'close-position',
      message: 'Fetching fill history from Bybit',
      level: 'info',
      positionId: position_id
    });

    const { data: fillsResult } = await supabase.functions.invoke('bybit-api', {
      body: {
        action: 'get_fills',
        params: { symbol: position.symbol },
        apiCredentials
      }
    });

    let actualClosePrice = closePrice;
    let realizedPnl = 0;
    let closeReasonFromFills = reason || 'manual';

    if (fillsResult?.success && fillsResult.data?.fillList?.length > 0) {
      const recentFills = fillsResult.data.fillList
        .filter((fill: any) => {
          const fillTime = Number(fill.cTime);
          const now = Date.now();
          return (now - fillTime) < 60000; // Last minute
        })
        .filter((fill: any) => {
          const fillSide = fill.side?.toLowerCase() || '';
          const expectedSide = position.side === 'BUY' ? 'close_long' : 'close_short';
          return fillSide === expectedSide || fillSide.includes('close');
        });

      if (recentFills.length > 0) {
        // Calculate average close price from fills
        const totalQty = recentFills.reduce((sum: number, fill: any) => sum + Number(fill.baseVolume || fill.size || 0), 0);
        const totalValue = recentFills.reduce((sum: number, fill: any) => {
          const qty = Number(fill.baseVolume || fill.size || 0);
          const price = Number(fill.price || fill.fillPrice || 0);
          return sum + (qty * price);
        }, 0);
        
        if (totalQty > 0) {
          actualClosePrice = totalValue / totalQty;
          
          // Calculate PnL from fills
          const priceDiff = position.side === 'BUY'
            ? actualClosePrice - Number(position.entry_price)
            : Number(position.entry_price) - actualClosePrice;
          realizedPnl = priceDiff * totalQty;

          // Determine close reason from price
          const slPrice = Number(position.sl_price);
          const isBuy = position.side === 'BUY';
          
          if (isBuy) {
            if (actualClosePrice <= slPrice * 1.005) {
              closeReasonFromFills = 'sl_hit';
            } else if (position.tp3_price && actualClosePrice >= Number(position.tp3_price) * 0.995) {
              closeReasonFromFills = 'tp3_hit';
            } else if (position.tp2_price && actualClosePrice >= Number(position.tp2_price) * 0.995) {
              closeReasonFromFills = 'tp2_hit';
            } else if (position.tp1_price && actualClosePrice >= Number(position.tp1_price) * 0.995) {
              closeReasonFromFills = 'tp1_hit';
            }
          } else {
            if (actualClosePrice >= slPrice * 0.995) {
              closeReasonFromFills = 'sl_hit';
            } else if (position.tp3_price && actualClosePrice <= Number(position.tp3_price) * 1.005) {
              closeReasonFromFills = 'tp3_hit';
            } else if (position.tp2_price && actualClosePrice <= Number(position.tp2_price) * 1.005) {
              closeReasonFromFills = 'tp2_hit';
            } else if (position.tp1_price && actualClosePrice <= Number(position.tp1_price) * 1.005) {
              closeReasonFromFills = 'tp1_hit';
            }
          }

          await log({
            functionName: 'close-position',
            message: 'Calculated from fills',
            level: 'info',
            positionId: position_id,
            metadata: { 
              actualClosePrice,
              realizedPnl,
              closeReason: closeReasonFromFills,
              fillsCount: recentFills.length
            }
          });
        }
      }
    } else {
      // Fallback to simple calculation
      const priceDiff = position.side === 'BUY'
        ? closePrice - Number(position.entry_price)
        : Number(position.entry_price) - closePrice;
      realizedPnl = priceDiff * Number(position.quantity);
    }

    await log({
      functionName: 'close-position',
      message: 'Position closed, updating database',
      level: 'info',
      positionId: position_id,
      metadata: { 
        closePrice: actualClosePrice, 
        realizedPnl,
        closeReason: closeReasonFromFills,
        entryPrice: position.entry_price
      }
    });

    // Update position in database
    const { error: updateError } = await supabase
      .from('positions')
      .update({
        status: 'closed',
        close_price: actualClosePrice,
        close_reason: closeReasonFromFills,
        closed_at: new Date().toISOString(),
        realized_pnl: realizedPnl,
      })
      .eq('id', position_id)
      .eq('user_id', position.user_id);

    if (updateError) {
      await log({
        functionName: 'close-position',
        message: 'Failed to update position in database',
        level: 'error',
        positionId: position_id,
        metadata: { error: updateError.message }
      });
      throw updateError;
    }

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

    await log({
      functionName: 'close-position',
      message: 'Position closed successfully',
      level: 'info',
      positionId: position_id,
      metadata: { 
        symbol: position.symbol,
        realizedPnl,
        closePrice 
      }
    });
    console.log('Position closed successfully:', position_id, 'PnL:', realizedPnl);

    // Wait for Bybit to process the position into history
    await new Promise(resolve => setTimeout(resolve, 3000));

    // Fetch accurate data from Bybit history
    await log({
      functionName: 'close-position',
      message: 'Syncing with Bybit position history',
      level: 'info',
      positionId: position_id
    });

    try {
      const { data: historyResult } = await supabase.functions.invoke('bybit-api', {
        body: {
          action: 'get_position_history',
          params: { 
            startTime: (Date.now() - 120000).toString(), // Last 2 minutes
            endTime: Date.now().toString(),
            pageSize: '20'
          },
          apiCredentials
        }
      });

      if (historyResult?.success && historyResult.data?.list?.length > 0) {
        // Find the matching position
        const bybitPosition = historyResult.data.list.find((p: any) => 
          p.symbol === position.symbol && 
          p.holdSide === (position.side === 'BUY' ? 'long' : 'short') &&
          Math.abs(Number(p.utime) - Date.now()) < 120000 // Within last 2 minutes
        );
        
        if (bybitPosition) {
          // Update with accurate Bybit data
          await supabase.from('positions').update({
            entry_price: Number(bybitPosition.openAvgPrice),
            close_price: Number(bybitPosition.closeAvgPrice),
            quantity: Number(bybitPosition.total),
            realized_pnl: Number(bybitPosition.netProfit),
            closed_at: new Date(Number(bybitPosition.utime)).toISOString(),
            metadata: {
              ...position.metadata,
              synced_from_bybit: true,
              sync_time: new Date().toISOString()
            }
          }).eq('id', position_id);

          await log({
            functionName: 'close-position',
            message: 'Position synced with Bybit history',
            level: 'info',
            positionId: position_id,
            metadata: { 
              bybitEntryPrice: bybitPosition.openAvgPrice,
              bybitClosePrice: bybitPosition.closeAvgPrice,
              bybitPnl: bybitPosition.netProfit
            }
          });
        }
      }
    } catch (syncError) {
      await log({
        functionName: 'close-position',
        message: 'Failed to sync with Bybit history (non-critical)',
        level: 'warn',
        positionId: position_id,
        metadata: { error: syncError instanceof Error ? syncError.message : 'Unknown' }
      });
    }

    return new Response(JSON.stringify({ 
      success: true, 
      realized_pnl: realizedPnl,
      close_price: actualClosePrice,
      close_reason: closeReasonFromFills
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await log({
      functionName: 'close-position',
      message: 'Failed to close position',
      level: 'error',
      metadata: { error: errorMessage }
    });
    console.error('Close position error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
