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
      functionName: 'sync-positions-history',
      message: 'Starting position history synchronization',
      level: 'info'
    });

    // Get all closed positions from database that might need sync
    const { data: dbPositions, error: dbError } = await supabase
      .from('positions')
      .select('*')
      .eq('status', 'closed')
      .order('closed_at', { ascending: false })
      .limit(50);

    if (dbError) throw dbError;

    if (!dbPositions || dbPositions.length === 0) {
      return new Response(JSON.stringify({ 
        message: 'No positions to sync',
        synced: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let syncedCount = 0;
    let updatedCount = 0;
    const errors: any[] = [];

    // Normalize symbols (add USDT if not present)
    const normalizeSymbol = (symbol: string) => {
      if (symbol.endsWith('USDT')) return symbol;
      return symbol + 'USDT';
    };

    // Get unique symbols to fetch history
    const symbols = [...new Set(dbPositions.map(p => normalizeSymbol(p.symbol)))];

    for (const symbol of symbols) {
      try {
        // Get fill history from Bitget (last 7 days)
        const endTime = Date.now();
        const startTime = endTime - (7 * 24 * 60 * 60 * 1000); // 7 days ago

        const { data: historyResult } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'get_history_positions',
            params: {
              symbol: symbol,
              startTime: startTime.toString(),
              endTime: endTime.toString(),
              limit: '100'
            }
          }
        });

        if (!historyResult?.success || !historyResult.data?.fillList) {
          console.log(`No history data for ${symbol}`);
          continue;
        }

        const fills = historyResult.data.fillList;
        console.log(`Got ${fills.length} fills for ${symbol}`);

        // Group fills by order ID to reconstruct position closes
        const orderGroups = new Map<string, any[]>();
        for (const fill of fills) {
          const orderId = fill.orderId;
          if (!orderGroups.has(orderId)) {
            orderGroups.set(orderId, []);
          }
          orderGroups.get(orderId)!.push(fill);
        }

        // Process each order (position close)
        for (const [orderId, orderFills] of orderGroups) {
          // Skip if not a close order
          const firstFill = orderFills[0];
          if (firstFill.tradeSide !== 'close_long' && firstFill.tradeSide !== 'close_short') {
            continue;
          }

          // Calculate total from fills
          const totalSize = orderFills.reduce((sum, f) => sum + Number(f.sizeQty), 0);
          const avgPrice = orderFills.reduce((sum, f) => sum + (Number(f.price) * Number(f.sizeQty)), 0) / totalSize;
          const totalFee = orderFills.reduce((sum, f) => sum + Number(f.fee), 0);
          const closeTime = Number(orderFills[0].cTime);

          // Try to match with database position by order ID or by symbol + time window
          let dbPos = dbPositions.find(p => p.bitget_order_id === orderId);
          
          // If no match by order ID, try to match by symbol and approximate time (within 1 hour)
          if (!dbPos) {
            dbPos = dbPositions.find(p => {
              const normalizedPosSymbol = normalizeSymbol(p.symbol);
              if (normalizedPosSymbol !== symbol) return false;
              if (!p.closed_at) return false;
              
              const posCloseTime = new Date(p.closed_at).getTime();
              const timeDiff = Math.abs(posCloseTime - closeTime);
              // Match if within 1 hour
              return timeDiff < (60 * 60 * 1000);
            });
          }

          if (dbPos) {
            // Calculate correct PnL from Bitget data
            const entryPrice = Number(dbPos.entry_price);
            const quantity = Number(dbPos.quantity);
            const isBuy = dbPos.side === 'BUY';
            
            // Calculate PnL: (close_price - entry_price) * quantity for LONG
            // or (entry_price - close_price) * quantity for SHORT
            const priceDiff = isBuy 
              ? avgPrice - entryPrice 
              : entryPrice - avgPrice;
            const realizedPnl = priceDiff * quantity;

            // Determine close reason from fill data
            let closeReason = 'unknown';
            
            // Check if it was TP or SL based on price
            const slPrice = Number(dbPos.sl_price);
            const tp1Price = dbPos.tp1_price ? Number(dbPos.tp1_price) : null;
            const tp2Price = dbPos.tp2_price ? Number(dbPos.tp2_price) : null;
            const tp3Price = dbPos.tp3_price ? Number(dbPos.tp3_price) : null;

            if (isBuy) {
              if (avgPrice <= slPrice * 1.005) {
                closeReason = 'sl_hit';
              } else if (tp3Price && avgPrice >= tp3Price * 0.995) {
                closeReason = 'tp3_hit';
              } else if (tp2Price && avgPrice >= tp2Price * 0.995) {
                closeReason = 'tp2_hit';
              } else if (tp1Price && avgPrice >= tp1Price * 0.995) {
                closeReason = 'tp1_hit';
              } else if (avgPrice > entryPrice) {
                closeReason = 'tp_hit';
              } else {
                closeReason = 'sl_hit';
              }
            } else {
              if (avgPrice >= slPrice * 0.995) {
                closeReason = 'sl_hit';
              } else if (tp3Price && avgPrice <= tp3Price * 1.005) {
                closeReason = 'tp3_hit';
              } else if (tp2Price && avgPrice <= tp2Price * 1.005) {
                closeReason = 'tp2_hit';
              } else if (tp1Price && avgPrice <= tp1Price * 1.005) {
                closeReason = 'tp1_hit';
              } else if (avgPrice < entryPrice) {
                closeReason = 'tp_hit';
              } else {
                closeReason = 'sl_hit';
              }
            }

            // Check if data needs updating (always update if current data is null/missing)
            const needsUpdate = 
              !dbPos.realized_pnl || 
              !dbPos.close_price ||
              dbPos.close_reason === 'Position not found on exchange' ||
              dbPos.close_reason === 'unknown' ||
              Math.abs(Number(dbPos.realized_pnl) - realizedPnl) > 0.01 ||
              Math.abs(Number(dbPos.close_price) - avgPrice) > 0.01 ||
              dbPos.close_reason !== closeReason;

            console.log(`Position ${dbPos.symbol} - needsUpdate: ${needsUpdate}, current close_price: ${dbPos.close_price}, calculated: ${avgPrice}, current pnl: ${dbPos.realized_pnl}, calculated: ${realizedPnl}`);

            if (needsUpdate) {
              await supabase
                .from('positions')
                .update({
                  close_price: avgPrice,
                  realized_pnl: realizedPnl,
                  close_reason: closeReason,
                  closed_at: new Date(closeTime).toISOString(),
                  metadata: {
                    ...dbPos.metadata,
                    synced_from_bitget: true,
                    sync_time: new Date().toISOString(),
                    total_fee: totalFee
                  }
                })
                .eq('id', dbPos.id);

              updatedCount++;
              console.log(`✅ Updated ${symbol}: PnL ${realizedPnl.toFixed(2)}, Reason: ${closeReason}`);

              await log({
                functionName: 'sync-positions-history',
                message: `Synced position ${symbol}`,
                level: 'info',
                positionId: dbPos.id,
                metadata: {
                  old_pnl: dbPos.realized_pnl,
                  new_pnl: realizedPnl,
                  old_reason: dbPos.close_reason,
                  new_reason: closeReason
                }
              });
            }

            syncedCount++;
          }
        }

      } catch (error) {
        console.error(`Error syncing ${symbol}:`, error);
        errors.push({
          symbol,
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    }

    await log({
      functionName: 'sync-positions-history',
      message: 'Position sync completed',
      level: 'info',
      metadata: {
        total_checked: dbPositions.length,
        synced: syncedCount,
        updated: updatedCount,
        errors: errors.length
      }
    });

    return new Response(JSON.stringify({ 
      success: true,
      total_checked: dbPositions.length,
      synced: syncedCount,
      updated: updatedCount,
      errors: errors.length > 0 ? errors : undefined
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await log({
      functionName: 'sync-positions-history',
      message: 'Sync failed',
      level: 'error',
      metadata: { error: errorMessage }
    });
    console.error('Sync error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
