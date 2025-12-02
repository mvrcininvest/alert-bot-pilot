import { createClient } from 'npm:@supabase/supabase-js@2';
import { corsHeaders } from '../_shared/cors.ts';

const BATCH_SIZE = 50;

// Helper: Get session from UTC time
function getSessionFromTime(dateStr: string): string {
  const hour = new Date(dateStr).getUTCHours();
  if (hour >= 21 || hour < 6) return 'Sydney';
  if (hour >= 0 && hour < 9) return 'Asia';
  if (hour >= 7 && hour < 16) return 'London';
  if (hour >= 12 && hour < 21) return 'NY';
  return 'Off-Hours';
}

// Helper: Determine close reason from prices
function determineCloseReason(position: any): string {
  const { close_price, entry_price, sl_price, tp1_price, tp2_price, tp3_price, 
          side, tp1_filled, tp2_filled, tp3_filled, close_reason } = position;
  
  // If already valid reason
  if (['tp1_hit', 'tp2_hit', 'tp3_hit', 'sl_hit', 'manual'].includes(close_reason)) {
    return close_reason;
  }
  
  // If filled flags are set
  if (tp3_filled) return 'tp3_hit';
  if (tp2_filled) return 'tp2_hit';
  if (tp1_filled) return 'tp1_hit';
  
  // Determine from price comparison
  const cp = Number(close_price);
  const ep = Number(entry_price);
  const sl = Number(sl_price);
  const tp1 = tp1_price ? Number(tp1_price) : null;
  const tp2 = tp2_price ? Number(tp2_price) : null;
  const tp3 = tp3_price ? Number(tp3_price) : null;
  const isBuy = side === 'BUY';
  
  const tolerance = 0.005; // 0.5% tolerance
  
  if (isBuy) {
    if (sl && cp <= sl * (1 + tolerance)) return 'sl_hit';
    if (tp3 && cp >= tp3 * (1 - tolerance)) return 'tp3_hit';
    if (tp2 && cp >= tp2 * (1 - tolerance)) return 'tp2_hit';
    if (tp1 && cp >= tp1 * (1 - tolerance)) return 'tp1_hit';
    return cp > ep ? 'tp_hit' : 'sl_hit';
  } else {
    if (sl && cp >= sl * (1 - tolerance)) return 'sl_hit';
    if (tp3 && cp <= tp3 * (1 + tolerance)) return 'tp3_hit';
    if (tp2 && cp <= tp2 * (1 + tolerance)) return 'tp2_hit';
    if (tp1 && cp <= tp1 * (1 + tolerance)) return 'tp1_hit';
    return cp < ep ? 'tp_hit' : 'sl_hit';
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    console.log('Starting historical data repair...');

    // Fetch all closed positions with alerts
    const { data: positions, error: fetchError } = await supabaseClient
      .from('positions')
      .select(`
        *,
        alerts (
          raw_data,
          tier,
          strength,
          mode
        )
      `)
      .eq('status', 'closed')
      .order('created_at', { ascending: true });

    if (fetchError) {
      throw new Error(`Error fetching positions: ${fetchError.message}`);
    }

    if (!positions || positions.length === 0) {
      return new Response(
        JSON.stringify({ updated: 0, message: 'No positions to repair' }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${positions.length} closed positions to process`);

    let updatedCount = 0;
    const updates: any[] = [];

    // Process each position
    for (const position of positions) {
      const positionUpdates: any = { id: position.id };
      let needsUpdate = false;

      // 1. Fix close_reason if incorrect
      if (
        !position.close_reason ||
        ['not_found_on_exchange', 'imported_from_bybit', 'unknown'].includes(position.close_reason)
      ) {
        const correctReason = determineCloseReason(position);
        positionUpdates.close_reason = correctReason;
        needsUpdate = true;
      }

      // 2. Calculate and fix PnL if missing or zero
      if (!position.realized_pnl || Number(position.realized_pnl) === 0) {
        if (position.close_price && position.entry_price && position.quantity) {
          const closePrice = Number(position.close_price);
          const entryPrice = Number(position.entry_price);
          const quantity = Number(position.quantity);
          const isBuy = position.side === 'BUY';
          
          const priceDiff = isBuy 
            ? closePrice - entryPrice 
            : entryPrice - closePrice;
          const calculatedPnl = priceDiff * quantity;
          
          positionUpdates.realized_pnl = calculatedPnl;
          needsUpdate = true;
        }
      }

      // 3. Enrich metadata with computed fields
      const metadata = position.metadata || {};
      const computed = metadata.computed || {};
      
      // Get alert data
      const alert = Array.isArray(position.alerts) ? position.alerts[0] : position.alerts;
      const rawData = alert?.raw_data;

      // Compute session
      const session = rawData?.timing?.session || getSessionFromTime(position.created_at);
      if (session !== computed.session) {
        computed.session = session;
        needsUpdate = true;
      }

      // Copy BTC correlation if available
      if (rawData?.smc_context?.btc_correlation !== undefined) {
        const btcCorr = rawData.smc_context.btc_correlation;
        if (btcCorr !== computed.btc_correlation) {
          computed.btc_correlation = btcCorr;
          needsUpdate = true;
        }
      }

      // Copy zone type if available
      if (rawData?.zone_details?.zone_type) {
        const zoneType = rawData.zone_details.zone_type;
        if (zoneType !== computed.zone_type) {
          computed.zone_type = zoneType;
          needsUpdate = true;
        }
      }

      // Copy regime if available
      if (rawData?.diagnostics?.regime) {
        const regime = rawData.diagnostics.regime;
        if (regime !== computed.regime) {
          computed.regime = regime;
          needsUpdate = true;
        }
      }

      if (needsUpdate) {
        metadata.computed = computed;
        positionUpdates.metadata = metadata;
        updates.push(positionUpdates);
        updatedCount++;
      }
    }

    console.log(`Prepared ${updatedCount} updates`);

    // Batch update positions
    if (updates.length > 0) {
      for (let i = 0; i < updates.length; i += BATCH_SIZE) {
        const batch = updates.slice(i, i + BATCH_SIZE);
        console.log(`Updating batch ${i / BATCH_SIZE + 1} (${batch.length} positions)`);

        for (const update of batch) {
          const { error: updateError } = await supabaseClient
            .from('positions')
            .update({
              close_reason: update.close_reason,
              metadata: update.metadata,
            })
            .eq('id', update.id);

          if (updateError) {
            console.error(`Error updating position ${update.id}:`, updateError);
          }
        }
      }
    }

    console.log(`Successfully repaired ${updatedCount} positions`);

    return new Response(
      JSON.stringify({
        updated: updatedCount,
        total: positions.length,
        message: `Successfully repaired ${updatedCount} of ${positions.length} positions`,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in repair-history-data:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({
        error: errorMessage,
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      }
    );
  }
});
