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
      functionName: 'repair-close-reasons',
      message: 'Starting close_reason repair for TP positions',
      level: 'info'
    });

    // Get all closed positions with 'tp' in close_reason
    const { data: positions, error: posError } = await supabase
      .from('positions')
      .select('*, alerts!positions_alert_id_fkey(tp1, tp2, tp3, side)')
      .eq('status', 'closed')
      .or('close_reason.ilike.%tp%,close_reason.is.null')
      .not('close_price', 'is', null);

    if (posError) throw posError;

    if (!positions || positions.length === 0) {
      return new Response(JSON.stringify({ 
        message: 'No positions to repair',
        repaired: 0 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Found ${positions.length} positions to check for close_reason repair`);

    let repairedCount = 0;
    let skippedCount = 0;
    const repairs: any[] = [];

    for (const pos of positions) {
      // Get TP prices - first from position, then from alert
      let tp1Price = pos.tp1_price ? Number(pos.tp1_price) : null;
      let tp2Price = pos.tp2_price ? Number(pos.tp2_price) : null;
      let tp3Price = pos.tp3_price ? Number(pos.tp3_price) : null;

      // If position doesn't have TP prices, try to get from alert
      if (!tp1Price && pos.alerts) {
        tp1Price = pos.alerts.tp1 ? Number(pos.alerts.tp1) : null;
        tp2Price = pos.alerts.tp2 ? Number(pos.alerts.tp2) : null;
        tp3Price = pos.alerts.tp3 ? Number(pos.alerts.tp3) : null;
      }

      const closePrice = Number(pos.close_price);
      const side = pos.side;

      // Skip if no TP data available
      if (!tp1Price) {
        console.log(`Skipping ${pos.symbol} (${pos.id}) - no TP1 price available`);
        skippedCount++;
        continue;
      }

      // Determine correct close_reason based on close_price
      let newCloseReason = pos.close_reason;

      if (side === 'BUY') {
        // For BUY: close_price should be >= TP price (with 0.5% tolerance)
        if (tp3Price && closePrice >= tp3Price * 0.995) {
          newCloseReason = 'tp3_hit';
        } else if (tp2Price && closePrice >= tp2Price * 0.995) {
          newCloseReason = 'tp2_hit';
        } else if (tp1Price && closePrice >= tp1Price * 0.995) {
          newCloseReason = 'tp1_hit';
        }
      } else {
        // For SELL: close_price should be <= TP price (with 0.5% tolerance)
        if (tp3Price && closePrice <= tp3Price * 1.005) {
          newCloseReason = 'tp3_hit';
        } else if (tp2Price && closePrice <= tp2Price * 1.005) {
          newCloseReason = 'tp2_hit';
        } else if (tp1Price && closePrice <= tp1Price * 1.005) {
          newCloseReason = 'tp1_hit';
        }
      }

      // Check if we need to update
      if (newCloseReason !== pos.close_reason) {
        // Determine which TP levels were filled
        const tp1Filled = newCloseReason.includes('tp');
        const tp2Filled = newCloseReason === 'tp2_hit' || newCloseReason === 'tp3_hit';
        const tp3Filled = newCloseReason === 'tp3_hit';

        // Update position
        const { error: updateError } = await supabase
          .from('positions')
          .update({
            close_reason: newCloseReason,
            tp1_filled: tp1Filled,
            tp2_filled: tp2Filled,
            tp3_filled: tp3Filled,
            // Also update TP prices from alert if missing
            tp1_price: pos.tp1_price || tp1Price,
            tp2_price: pos.tp2_price || tp2Price,
            tp3_price: pos.tp3_price || tp3Price,
            metadata: {
              ...pos.metadata,
              close_reason_repaired: true,
              repair_time: new Date().toISOString(),
              old_close_reason: pos.close_reason,
              repair_details: {
                close_price: closePrice,
                tp1_price: tp1Price,
                tp2_price: tp2Price,
                tp3_price: tp3Price,
                side: side
              }
            }
          })
          .eq('id', pos.id);

        if (updateError) {
          console.error(`Error updating position ${pos.id}:`, updateError);
          continue;
        }

        repairs.push({
          id: pos.id,
          symbol: pos.symbol,
          old_reason: pos.close_reason,
          new_reason: newCloseReason,
          close_price: closePrice,
          tp1_price: tp1Price,
          tp2_price: tp2Price,
          tp3_price: tp3Price
        });

        repairedCount++;
        console.log(`✅ Repaired ${pos.symbol}: ${pos.close_reason} → ${newCloseReason} (close=${closePrice}, tp1=${tp1Price}, tp2=${tp2Price}, tp3=${tp3Price})`);
      } else {
        console.log(`✓ ${pos.symbol} already correct: ${pos.close_reason}`);
      }
    }

    await log({
      functionName: 'repair-close-reasons',
      message: `Close reason repair completed: ${repairedCount} repaired, ${skippedCount} skipped`,
      level: 'info',
      metadata: {
        total_checked: positions.length,
        repaired: repairedCount,
        skipped: skippedCount,
        repairs: repairs.slice(0, 20) // First 20 for log brevity
      }
    });

    return new Response(JSON.stringify({ 
      success: true,
      total_checked: positions.length,
      repaired: repairedCount,
      skipped: skippedCount,
      repairs
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await log({
      functionName: 'repair-close-reasons',
      message: 'Repair failed',
      level: 'error',
      metadata: { error: errorMessage }
    });
    console.error('Repair error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
