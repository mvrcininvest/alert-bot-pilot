import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { log } from "../_shared/logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Determine symbol category
function getSymbolCategory(symbol: string): string {
  if (symbol.includes('BTC') || symbol.includes('ETH')) {
    return 'BTC_ETH';
  }
  
  // Major coins
  const majors = ['SOL', 'BNB', 'XRP', 'ADA', 'DOGE', 'MATIC', 'DOT', 'AVAX', 'LINK'];
  if (majors.some(major => symbol.includes(major))) {
    return 'MAJOR';
  }
  
  return 'ALTCOIN';
}

// Get margin bucket
function getMarginBucket(margin: number): string {
  if (margin < 1) return '<1';
  if (margin < 2) return '1-2';
  if (margin < 5) return '2-5';
  return '>5';
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    // Verify user authentication
    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    await log({
      functionName: 'repair-mm-data',
      message: 'Starting MM data repair',
      level: 'info',
      metadata: { userId: user.id }
    });

    // Fetch all positions without settings_snapshot
    const { data: positions, error: fetchError } = await supabase
      .from('positions')
      .select('*')
      .eq('user_id', user.id)
      .eq('status', 'closed');

    if (fetchError) throw fetchError;

    if (!positions || positions.length === 0) {
      return new Response(JSON.stringify({ 
        success: true, 
        updated: 0,
        message: 'No positions to repair'
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    let updated = 0;
    let skipped = 0;

    for (const position of positions) {
      const metadata = position.metadata as any || {};
      
      // Skip if already has settings_snapshot or mm_data
      if (metadata.settings_snapshot || metadata.mm_data) {
        skipped++;
        continue;
      }

      // Calculate MM data
      const margin = (position.entry_price * position.quantity) / position.leverage;
      const symbolCategory = getSymbolCategory(position.symbol);
      const marginBucket = getMarginBucket(margin);

      // Update metadata
      const updatedMetadata = {
        ...metadata,
        mm_data: {
          calculated_margin: Number(margin.toFixed(2)),
          symbol_category: symbolCategory,
          margin_bucket: marginBucket,
          leverage: position.leverage,
          position_sizing_type: 'legacy_unknown',
          reconstructed_at: new Date().toISOString()
        }
      };

      const { error: updateError } = await supabase
        .from('positions')
        .update({ metadata: updatedMetadata })
        .eq('id', position.id);

      if (updateError) {
        console.error(`Failed to update position ${position.id}:`, updateError);
        await log({
          functionName: 'repair-mm-data',
          message: 'Failed to update position',
          level: 'error',
          positionId: position.id,
          metadata: { error: updateError.message }
        });
      } else {
        updated++;
      }
    }

    await log({
      functionName: 'repair-mm-data',
      message: 'MM data repair completed',
      level: 'info',
      metadata: { 
        userId: user.id,
        updated,
        skipped,
        total: positions.length
      }
    });

    return new Response(JSON.stringify({ 
      success: true, 
      updated,
      skipped,
      total: positions.length
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await log({
      functionName: 'repair-mm-data',
      message: 'MM data repair failed',
      level: 'error',
      metadata: { error: errorMessage }
    });
    
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
