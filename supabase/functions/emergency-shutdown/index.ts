import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { log } from "../_shared/logger.ts";
import { getUserApiKeys } from "../_shared/userKeys.ts";
import { getUserSettings } from "../_shared/userSettings.ts";

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

    const { user_id } = await req.json();

    if (!user_id) {
      throw new Error('user_id is required');
    }

    await log({
      functionName: 'emergency-shutdown',
      message: `🚨 EMERGENCY SHUTDOWN INITIATED for user ${user_id}`,
      level: 'error'
    });

    console.log(`🚨 EMERGENCY SHUTDOWN - Starting for user ${user_id}...`);

    // Get user API keys
    const userKeys = await getUserApiKeys(user_id);
    if (!userKeys) {
      throw new Error('User API keys not found or inactive');
    }

    const apiCredentials = {
      apiKey: userKeys.apiKey,
      secretKey: userKeys.secretKey,
      passphrase: userKeys.passphrase
    };

    // 1. Disable bot for this user
    const { data: userSettingsData } = await supabase
      .from('user_settings')
      .select('id')
      .eq('user_id', user_id)
      .single();

    if (userSettingsData) {
      const { error: settingsError } = await supabase
        .from('user_settings')
        .update({ bot_active: false })
        .eq('user_id', user_id);

      if (settingsError) {
        console.error('Failed to disable bot:', settingsError);
      } else {
        console.log('✅ Bot disabled for user');
      }
    }

    // 2. Get all open positions for this user
    const { data: openPositions, error: positionsError } = await supabase
      .from('positions')
      .select('*')
      .eq('status', 'open')
      .eq('user_id', user_id);

    if (positionsError) {
      console.error('Failed to fetch open positions:', positionsError);
      throw positionsError;
    }

    if (!openPositions || openPositions.length === 0) {
      console.log('No open positions to close');
      
      await log({
        functionName: 'emergency-shutdown',
        message: '🚨 Emergency shutdown completed - no positions to close',
        level: 'error'
      });

      return new Response(JSON.stringify({ 
        success: true, 
        message: 'Emergency shutdown completed',
        positions_closed: 0
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${openPositions.length} open positions to close`);

    const closedPositions: string[] = [];
    const failedPositions: string[] = [];

    // 3. Close all open positions at market
    for (const position of openPositions) {
      try {
        console.log(`Closing position ${position.symbol}...`);

        // Get current position data from Bitget
        const { data: positionResult } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'get_position',
            params: { symbol: position.symbol },
            apiCredentials
          }
        });

        if (!positionResult?.success || !positionResult.data || !positionResult.data[0]) {
          console.log(`Position ${position.symbol} not found on exchange, determining close reason...`);
          
          // Get current price to determine close reason
          const { data: tickerResult } = await supabase.functions.invoke('bitget-api', {
            body: {
              action: 'get_ticker',
              params: { symbol: position.symbol },
              apiCredentials
            }
          });
          
          const currentPrice = tickerResult?.success ? Number(tickerResult.data[0].lastPr) : Number(position.entry_price);
          const entryPrice = Number(position.entry_price);
          const slPrice = Number(position.sl_price);
          const isBuy = position.side === 'BUY';
          
          // Determine close reason based on price
          let closeReason = 'unknown';
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
          
          const priceDiff = isBuy
            ? currentPrice - entryPrice
            : entryPrice - currentPrice;
          const realizedPnl = priceDiff * Number(position.quantity);
          
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
            .eq('user_id', user_id);
          
          closedPositions.push(position.symbol);
          console.log(`✅ Marked ${position.symbol} as closed with reason: ${closeReason}`);
          continue;
        }

        const bitgetPosition = positionResult.data[0];
        const bitgetQuantity = Number(bitgetPosition.total || 0);

        if (bitgetQuantity === 0) {
          console.log(`Position ${position.symbol} has 0 quantity, skipping...`);
          closedPositions.push(position.symbol);
          continue;
        }

        // Cancel all SL/TP orders
        if (position.sl_order_id) {
          await supabase.functions.invoke('bitget-api', {
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
        }

        if (position.tp1_order_id) {
          await supabase.functions.invoke('bitget-api', {
            body: {
              action: 'cancel_plan_order',
              params: {
                symbol: position.symbol,
                orderId: position.tp1_order_id,
                planType: 'pos_profit'
              },
              apiCredentials
            }
          });
        }

        // Close position at market
        const isBuy = position.side === 'BUY';
        const closeSide = isBuy ? 'close_long' : 'close_short';

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

        if (!closeResult?.success) {
          console.error(`Failed to close ${position.symbol}:`, closeResult);
          failedPositions.push(position.symbol);
          continue;
        }

        // Wait for fills to be recorded
        await new Promise(resolve => setTimeout(resolve, 2000));

        // Fetch fill history from Bitget
        const { data: fillsResult } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'get_fills',
            params: { symbol: position.symbol },
            apiCredentials
          }
        });

        let actualClosePrice = position.current_price || Number(position.entry_price);
        let realizedPnl = 0;
        let closeReason = 'Emergency shutdown';

        if (fillsResult?.success && fillsResult.data?.fillList?.length > 0) {
          const recentFills = fillsResult.data.fillList
            .filter((fill: any) => {
              const fillTime = Number(fill.cTime);
              const now = Date.now();
              return (now - fillTime) < 60000;
            })
            .filter((fill: any) => {
              const fillSide = fill.side?.toLowerCase() || '';
              const expectedSide = isBuy ? 'close_long' : 'close_short';
              return fillSide === expectedSide || fillSide.includes('close');
            });

          if (recentFills.length > 0) {
            const totalQty = recentFills.reduce((sum: number, fill: any) => sum + Number(fill.baseVolume || fill.size || 0), 0);
            const totalValue = recentFills.reduce((sum: number, fill: any) => {
              const qty = Number(fill.baseVolume || fill.size || 0);
              const price = Number(fill.price || fill.fillPrice || 0);
              return sum + (qty * price);
            }, 0);
            
            if (totalQty > 0) {
              actualClosePrice = totalValue / totalQty;
              const entryPrice = Number(position.entry_price);
              const priceDiff = isBuy ? actualClosePrice - entryPrice : entryPrice - actualClosePrice;
              realizedPnl = priceDiff * totalQty;
            }
          }
        }

        // Update position in DB
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
          .eq('user_id', user_id);

        closedPositions.push(position.symbol);
        console.log(`✅ Closed ${position.symbol} at ${actualClosePrice} (PnL: ${realizedPnl.toFixed(2)} USDT)`);

        await log({
          functionName: 'emergency-shutdown',
          message: `Closed position ${position.symbol}`,
          level: 'warn',
          positionId: position.id,
          metadata: {
            closePrice: actualClosePrice,
            realizedPnl,
            closeReason
          }
        });

      } catch (error) {
        console.error(`Error closing position ${position.symbol}:`, error);
        failedPositions.push(position.symbol);
        
        await log({
          functionName: 'emergency-shutdown',
          message: `Failed to close position ${position.symbol}`,
          level: 'error',
          positionId: position.id,
          metadata: {
            error: error instanceof Error ? error.message : 'Unknown error'
          }
        });
      }
    }

    const message = `Emergency shutdown completed. Closed: ${closedPositions.length}, Failed: ${failedPositions.length}`;
    console.log(`🚨 ${message}`);

    await log({
      functionName: 'emergency-shutdown',
      message: `🚨 ${message}`,
      level: 'error',
      metadata: {
        closedPositions,
        failedPositions
      }
    });

    return new Response(JSON.stringify({ 
      success: true, 
      message,
      positions_closed: closedPositions.length,
      positions_failed: failedPositions.length,
      closed: closedPositions,
      failed: failedPositions
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Emergency shutdown error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    await log({
      functionName: 'emergency-shutdown',
      message: `Emergency shutdown failed: ${errorMessage}`,
      level: 'error',
      metadata: { error: errorMessage }
    });

    return new Response(JSON.stringify({ 
      error: errorMessage,
      success: false 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
