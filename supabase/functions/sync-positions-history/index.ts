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

    await log({
      functionName: 'sync-positions-history',
      message: 'Starting position history synchronization with Bitget data',
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

    // Group positions by user_id
    const positionsByUser = new Map<string, typeof dbPositions>();
    for (const pos of dbPositions) {
      if (!pos.user_id) continue;
      if (!positionsByUser.has(pos.user_id)) {
        positionsByUser.set(pos.user_id, []);
      }
      positionsByUser.get(pos.user_id)!.push(pos);
    }

    // Process each user's positions
    for (const [userId, userPositions] of positionsByUser) {
      // Fetch user API keys
      const userKeys = await getUserApiKeys(userId);
      if (!userKeys) {
        console.log(`No API keys for user ${userId}, skipping ${userPositions.length} positions`);
        errors.push({
          user_id: userId,
          error: 'No API keys configured'
        });
        continue;
      }

      const apiCredentials = {
        apiKey: userKeys.apiKey,
        secretKey: userKeys.secretKey,
        passphrase: userKeys.passphrase
      };

      try {
        // Get position history from Bitget (last 7 days)
        const endTime = Date.now();
        const startTime = endTime - (7 * 24 * 60 * 60 * 1000); // 7 days ago

        console.log(`Fetching position history for user ${userId} from ${new Date(startTime).toISOString()}`);

        const { data: historyResult } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'get_position_history',
            params: {
              startTime: startTime.toString(),
              endTime: endTime.toString(),
              pageSize: '100'
            },
            apiCredentials
          }
        });

        if (!historyResult?.success || !historyResult.data?.list) {
          console.log(`No position history data for user ${userId}`);
          continue;
        }

        const bitgetPositions = historyResult.data.list;
        console.log(`Got ${bitgetPositions.length} positions from Bitget for user ${userId}`);

        // Process each DB position and find matching Bitget data
        for (const dbPos of userPositions) {
          const symbol = normalizeSymbol(dbPos.symbol);
          const dbCloseTime = new Date(dbPos.closed_at).getTime();
          
          console.log(`Processing DB position: ${dbPos.id}, symbol=${symbol}, closed_at=${dbPos.closed_at}`);

          // Find matching Bitget position by symbol and approximate time
          const bitgetPos = bitgetPositions.find((bp: any) => {
            const bpSymbol = normalizeSymbol(bp.symbol);
            if (bpSymbol !== symbol) return false;
            
            // Use uTime (update time) as close time, fallback to cTime if needed
            const bitgetCloseTime = Number(bp.uTime || bp.cTime);
            if (isNaN(bitgetCloseTime)) return false;
            
            const timeDiff = Math.abs(dbCloseTime - bitgetCloseTime);
            const withinWindow = timeDiff < (5 * 60 * 1000); // 5 minutes tolerance
            
            if (withinWindow) {
              console.log(`✅ Time match for ${symbol}: DB=${new Date(dbCloseTime).toISOString()}, Bitget=${new Date(bitgetCloseTime).toISOString()}, diff=${Math.round(timeDiff/1000)}s`);
            }
            
            return withinWindow;
          });

          if (!bitgetPos) {
            console.log(`❌ No matching Bitget position found for ${symbol}`);
            continue;
          }

          console.log(`Found matching Bitget position for ${dbPos.id}`);

          // Extract real data from Bitget using CORRECT field names
          const bitgetEntryPrice = Number(bitgetPos.openAvgPrice);
          const bitgetClosePrice = Number(bitgetPos.closeAvgPrice);
          const bitgetRealizedPnl = Number(bitgetPos.netProfit); // netProfit includes fees
          const bitgetSide = bitgetPos.holdSide === 'long' ? 'BUY' : 'SELL';

          // Determine close reason
          let closeReason = 'manual_close';
          
          if (bitgetPos.closeType === 'sl') {
            closeReason = 'sl_hit';
          } else if (bitgetPos.closeType === 'tp') {
            // Check which TP was hit
            const tp1Price = dbPos.tp1_price ? Number(dbPos.tp1_price) : null;
            const tp2Price = dbPos.tp2_price ? Number(dbPos.tp2_price) : null;
            const tp3Price = dbPos.tp3_price ? Number(dbPos.tp3_price) : null;

            if (bitgetSide === 'BUY') {
              if (tp3Price && bitgetClosePrice >= tp3Price * 0.995) {
                closeReason = 'tp3_hit';
              } else if (tp2Price && bitgetClosePrice >= tp2Price * 0.995) {
                closeReason = 'tp2_hit';
              } else if (tp1Price && bitgetClosePrice >= tp1Price * 0.995) {
                closeReason = 'tp1_hit';
              } else {
                closeReason = 'tp_hit';
              }
            } else {
              if (tp3Price && bitgetClosePrice <= tp3Price * 1.005) {
                closeReason = 'tp3_hit';
              } else if (tp2Price && bitgetClosePrice <= tp2Price * 1.005) {
                closeReason = 'tp2_hit';
              } else if (tp1Price && bitgetClosePrice <= tp1Price * 1.005) {
                closeReason = 'tp1_hit';
              } else {
                closeReason = 'tp_hit';
              }
            }
          } else if (bitgetPos.closeType === 'liquidation') {
            closeReason = 'liquidated';
          }

          // Check if data needs updating
          const needsUpdate = 
            Math.abs(Number(dbPos.entry_price) - bitgetEntryPrice) > 0.01 ||
            Math.abs(Number(dbPos.close_price || 0) - bitgetClosePrice) > 0.01 ||
            Math.abs(Number(dbPos.realized_pnl || 0) - bitgetRealizedPnl) > 0.01 ||
            !dbPos.close_price ||
            !dbPos.realized_pnl;

          console.log(`Position ${symbol} - needsUpdate: ${needsUpdate}`);
          console.log(`  Entry: DB=${dbPos.entry_price} vs Bitget=${bitgetEntryPrice}`);
          console.log(`  Close: DB=${dbPos.close_price} vs Bitget=${bitgetClosePrice}`);
          console.log(`  PnL: DB=${dbPos.realized_pnl} vs Bitget=${bitgetRealizedPnl}`);
          console.log(`  Reason: DB=${dbPos.close_reason} vs Bitget=${closeReason}`);

          if (needsUpdate) {
            await supabase
              .from('positions')
              .update({
                entry_price: bitgetEntryPrice,
                close_price: bitgetClosePrice,
                realized_pnl: bitgetRealizedPnl,
                metadata: {
                  ...dbPos.metadata,
                  synced_from_bitget: true,
                  sync_time: new Date().toISOString(),
                  bitget_close_type: bitgetPos.closeType
                }
              })
              .eq('id', dbPos.id);

            updatedCount++;
            console.log(`✅ Updated ${symbol}: Entry=${bitgetEntryPrice}, Close=${bitgetClosePrice}, PnL=${bitgetRealizedPnl.toFixed(2)}, Reason=${closeReason}`);

            await log({
              functionName: 'sync-positions-history',
              message: `Synced position ${symbol} with Bitget data`,
              level: 'info',
              positionId: dbPos.id,
              metadata: {
                old_entry: dbPos.entry_price,
                new_entry: bitgetEntryPrice,
                old_close: dbPos.close_price,
                new_close: bitgetClosePrice,
                old_pnl: dbPos.realized_pnl,
                new_pnl: bitgetRealizedPnl,
                old_reason: dbPos.close_reason,
                new_reason: closeReason
              }
            });
          }

          syncedCount++;
        }

      } catch (error) {
        console.error(`Error syncing positions for user ${userId}:`, error);
        errors.push({
          user_id: userId,
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
