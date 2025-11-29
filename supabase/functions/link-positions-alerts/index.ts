import { serve } from 'https://deno.land/std@0.168.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.84.0';
import { corsHeaders } from '../_shared/cors.ts';

interface Position {
  id: string;
  symbol: string;
  side: string;
  entry_price: number;
  created_at: string;
  alert_id: string | null;
  metadata: any;
}

interface Alert {
  id: string;
  symbol: string;
  side: string;
  entry_price: number;
  created_at: string;
  position_id: string | null;
  tier: string | null;
  mode: string | null;
  status: string;
}

interface Match {
  position: Position;
  alert: Alert;
  timeDiff: number;
  priceDiff: number;
}

function normalizeSymbol(symbol: string): string {
  return symbol.replace('.P', '').replace('PERP', '').toUpperCase();
}

function calculatePriceDifference(price1: number, price2: number): number {
  return Math.abs((price1 - price2) / price1) * 100;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    console.log('Link positions to alerts started');
    
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL');
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
    
    if (!supabaseUrl || !supabaseKey) {
      throw new Error('Missing Supabase configuration');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    // Fetch positions without alert_id
    console.log('Fetching positions without alert_id...');
    const { data: positions, error: posError } = await supabase
      .from('positions')
      .select('id, symbol, side, entry_price, created_at, alert_id, metadata')
      .eq('status', 'closed')
      .is('alert_id', null);

    if (posError) {
      throw new Error(`Error fetching positions: ${posError.message}`);
    }

    console.log(`Found ${positions?.length || 0} positions without alert_id`);

    if (!positions || positions.length === 0) {
      return new Response(
        JSON.stringify({ 
          success: true, 
          message: 'No positions to link',
          matched: 0,
          unmatched: 0
        }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // Fetch all alerts
    console.log('Fetching all alerts...');
    const { data: alerts, error: alertError } = await supabase
      .from('alerts')
      .select('id, symbol, side, entry_price, created_at, position_id, tier, mode, status');

    if (alertError) {
      throw new Error(`Error fetching alerts: ${alertError.message}`);
    }

    console.log(`Found ${alerts?.length || 0} alerts`);

    const matches: Match[] = [];
    const unmatched: Position[] = [];

    // Match each position to an alert
    for (const position of positions as Position[]) {
      const normalizedPosSymbol = normalizeSymbol(position.symbol);
      
      const candidates = (alerts as Alert[]).filter(alert => {
        const normalizedAlertSymbol = normalizeSymbol(alert.symbol);
        
        // Must match symbol and side
        if (normalizedAlertSymbol !== normalizedPosSymbol || alert.side !== position.side) {
          return false;
        }

        // Time difference < 10 minutes
        const posTime = new Date(position.created_at).getTime();
        const alertTime = new Date(alert.created_at).getTime();
        const timeDiff = Math.abs(posTime - alertTime) / 1000 / 60; // minutes
        
        if (timeDiff > 10) {
          return false;
        }

        // Price difference < 2%
        const priceDiff = calculatePriceDifference(position.entry_price, alert.entry_price);
        if (priceDiff > 2) {
          return false;
        }

        return true;
      });

      if (candidates.length > 0) {
        // Select the alert with the smallest time difference
        const bestMatch = candidates.reduce((best, current) => {
          const posTime = new Date(position.created_at).getTime();
          const currentTimeDiff = Math.abs(new Date(current.created_at).getTime() - posTime);
          const bestTimeDiff = Math.abs(new Date(best.created_at).getTime() - posTime);
          
          return currentTimeDiff < bestTimeDiff ? current : best;
        });

        const timeDiff = Math.abs(
          new Date(position.created_at).getTime() - new Date(bestMatch.created_at).getTime()
        ) / 1000 / 60;
        const priceDiff = calculatePriceDifference(position.entry_price, bestMatch.entry_price);

        matches.push({
          position,
          alert: bestMatch,
          timeDiff,
          priceDiff
        });
      } else {
        unmatched.push(position);
      }
    }

    console.log(`Matched: ${matches.length}, Unmatched: ${unmatched.length}`);

    // Update database with matches
    const updateResults = [];
    for (const match of matches) {
      // Update position with alert_id and metadata
      const updatedMetadata = {
        ...(match.position.metadata || {}),
        tier: match.alert.tier,
        mode: match.alert.mode,
        linked_at: new Date().toISOString(),
        match_quality: {
          time_diff_minutes: match.timeDiff,
          price_diff_percent: match.priceDiff
        }
      };

      const { error: posUpdateError } = await supabase
        .from('positions')
        .update({ 
          alert_id: match.alert.id,
          metadata: updatedMetadata
        })
        .eq('id', match.position.id);

      if (posUpdateError) {
        console.error(`Error updating position ${match.position.id}:`, posUpdateError);
        updateResults.push({
          position_id: match.position.id,
          alert_id: match.alert.id,
          success: false,
          error: posUpdateError.message
        });
        continue;
      }

      // Update alert with position_id
      const { error: alertUpdateError } = await supabase
        .from('alerts')
        .update({ position_id: match.position.id })
        .eq('id', match.alert.id);

      if (alertUpdateError) {
        console.error(`Error updating alert ${match.alert.id}:`, alertUpdateError);
        updateResults.push({
          position_id: match.position.id,
          alert_id: match.alert.id,
          success: false,
          error: alertUpdateError.message
        });
        continue;
      }

      updateResults.push({
        position_id: match.position.id,
        alert_id: match.alert.id,
        symbol: match.position.symbol,
        side: match.position.side,
        alert_status: match.alert.status,
        tier: match.alert.tier,
        mode: match.alert.mode,
        time_diff_minutes: match.timeDiff.toFixed(2),
        price_diff_percent: match.priceDiff.toFixed(2),
        success: true
      });
    }

    const successCount = updateResults.filter(r => r.success).length;
    const failCount = updateResults.filter(r => !r.success).length;

    const response = {
      success: true,
      message: `Successfully linked ${successCount} positions to alerts`,
      matched: successCount,
      failed: failCount,
      unmatched: unmatched.length,
      details: {
        successful_links: updateResults.filter(r => r.success),
        failed_links: updateResults.filter(r => !r.success),
        unmatched_positions: unmatched.map(p => ({
          id: p.id,
          symbol: p.symbol,
          side: p.side,
          created_at: p.created_at,
          reason: 'No matching alert found within criteria'
        }))
      }
    };

    console.log('Link positions to alerts completed:', response);

    return new Response(JSON.stringify(response), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' }
    });

  } catch (error) {
    console.error('Error in link-positions-alerts:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error occurred',
        success: false 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
