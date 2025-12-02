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
      Deno.env.get('SUPABASE_ANON_KEY') ?? ''
    );

    console.log('🔥 Keep-warm function triggered - pinging critical functions...');

    const functions = [
      'tradingview-webhook',
      'bybit-trader',
      'bybit-api',
      'position-monitor'
    ];

    const results = await Promise.all(
      functions.map(async (functionName) => {
        try {
          const startTime = Date.now();
          const { data, error } = await supabase.functions.invoke(functionName, {
            body: { ping: true }
          });

          const latency = Date.now() - startTime;

          if (error) {
            console.error(`❌ ${functionName}: ${error.message} (${latency}ms)`);
            return { function: functionName, status: 'error', error: error.message, latency };
          }

          if (data?.pong) {
            console.log(`✅ ${functionName}: pong received (${latency}ms)`);
            return { function: functionName, status: 'success', latency };
          }

          console.warn(`⚠️ ${functionName}: unexpected response (${latency}ms)`);
          return { function: functionName, status: 'unexpected', latency };
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`❌ ${functionName}: ${errorMessage}`);
          return { function: functionName, status: 'error', error: errorMessage };
        }
      })
    );

    const successCount = results.filter(r => r.status === 'success').length;
    const totalLatency = results.reduce((sum, r) => sum + (r.latency || 0), 0);
    const avgLatency = totalLatency / results.length;

    console.log(`🔥 Keep-warm complete: ${successCount}/${functions.length} functions warmed (avg: ${avgLatency.toFixed(0)}ms)`);

    return new Response(JSON.stringify({ 
      success: true,
      warmed: successCount,
      total: functions.length,
      avgLatency: Math.round(avgLatency),
      results 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Keep-warm error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
