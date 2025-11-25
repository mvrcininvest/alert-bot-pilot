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
    console.log('=== Webhook received ===');
    console.log('Method:', req.method);
    console.log('Headers:', Object.fromEntries(req.headers.entries()));

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const webhookSecret = Deno.env.get('TRADINGVIEW_WEBHOOK_SECRET');
    const authHeader = req.headers.get('authorization');
    
    console.log('Webhook secret configured:', !!webhookSecret);
    console.log('Auth header present:', !!authHeader);
    
    if (webhookSecret && authHeader !== `Bearer ${webhookSecret}`) {
      console.error('Authorization failed - secret mismatch');
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const alertData = await req.json();
    console.log('Received alert data:', JSON.stringify(alertData, null, 2));

    // Save alert to database
    const { data: alert, error: alertError } = await supabase
      .from('alerts')
      .insert({
        symbol: alertData.symbol,
        side: alertData.side,
        entry_price: alertData.price,
        sl: alertData.sl,
        tp1: alertData.tp1,
        tp2: alertData.tp2,
        tp3: alertData.tp3,
        main_tp: alertData.main_tp,
        atr: alertData.atr,
        leverage: alertData.leverage,
        strength: alertData.strength,
        tier: alertData.tier,
        mode: alertData.mode,
        status: 'pending',
        raw_data: alertData,
      })
      .select()
      .single();

    if (alertError) {
      console.error('Error saving alert:', alertError);
      throw alertError;
    }

    console.log('Alert saved with ID:', alert.id);

    // Get settings
    const { data: settings, error: settingsError } = await supabase
      .from('settings')
      .select('*')
      .maybeSingle();

    if (settingsError) {
      console.error('Error fetching settings:', settingsError);
      throw settingsError;
    }

    if (!settings) {
      console.error('No settings found in database');
      await supabase
        .from('alerts')
        .update({ status: 'error', error_message: 'No settings configured' })
        .eq('id', alert.id);
      
      return new Response(JSON.stringify({ error: 'No settings configured', alert_id: alert.id }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Settings loaded, bot_active:', settings.bot_active);

    if (!settings.bot_active) {
      await supabase
        .from('alerts')
        .update({ status: 'ignored', error_message: 'Bot not active' })
        .eq('id', alert.id);
      
      return new Response(JSON.stringify({ message: 'Bot not active', alert_id: alert.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Bot is active, checking filters...');

    // Apply filters
    if (settings.filter_by_tier && !settings.allowed_tiers?.includes(alertData.tier)) {
      await supabase
        .from('alerts')
        .update({ status: 'ignored', error_message: 'Tier not allowed' })
        .eq('id', alert.id);
      
      return new Response(JSON.stringify({ message: 'Tier filtered', alert_id: alert.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (alertData.strength && alertData.strength < (settings.min_strength || 0)) {
      await supabase
        .from('alerts')
        .update({ status: 'ignored', error_message: 'Strength too low' })
        .eq('id', alert.id);
      
      return new Response(JSON.stringify({ message: 'Strength filtered', alert_id: alert.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('All filters passed, calling bitget-trader...');

    // Call trader function
    const { data: tradeResult, error: tradeError } = await supabase.functions.invoke('bitget-trader', {
      body: { alert_id: alert.id, alert_data: alertData, settings },
    });

    if (tradeError) {
      console.error('Trade error:', tradeError);
      await supabase
        .from('alerts')
        .update({ status: 'error', error_message: tradeError.message })
        .eq('id', alert.id);
      
      return new Response(JSON.stringify({ error: 'Trade execution failed', details: tradeError.message, alert_id: alert.id }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Trade executed successfully:', tradeResult);

    return new Response(JSON.stringify({ success: true, alert_id: alert.id, trade_result: tradeResult }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Webhook error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
