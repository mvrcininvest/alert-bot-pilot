import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { log } from "../_shared/logger.ts";
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
    await log({
      functionName: 'tradingview-webhook',
      message: 'Webhook received',
      level: 'info'
    });
    
    console.log('=== Webhook received ===');
    console.log('Method:', req.method);
    console.log('Headers:', Object.fromEntries(req.headers.entries()));

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const bodyText = await req.text();
    console.log('Request body:', bodyText);
    
    // Secret authorization disabled - accepting all webhook requests
    const alertData = JSON.parse(bodyText);
    console.log('Received alert data:', JSON.stringify(alertData, null, 2));
    
    // Extract user_id from alert payload
    const userId = alertData.user_id;
    if (!userId) {
      await log({
        functionName: 'tradingview-webhook',
        message: 'Missing user_id in alert payload',
        level: 'error'
      });
      return new Response(JSON.stringify({ error: 'user_id is required in alert payload' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    console.log('Processing alert for user:', userId);
    
    await log({
      functionName: 'tradingview-webhook',
      message: 'Alert data parsed',
      level: 'info',
      metadata: { symbol: alertData.symbol, side: alertData.side, tier: alertData.tier }
    });

    // Save alert to database with user_id
    const { data: alert, error: alertError } = await supabase
      .from('alerts')
      .insert({
        user_id: userId,
        symbol: alertData.symbol,
        side: alertData.side,
        entry_price: alertData.entryPrice || alertData.price,
        sl: alertData.sl,
        tp1: alertData.tp1,
        tp2: alertData.tp2,
        tp3: alertData.tp3,
        main_tp: alertData.mainTp || alertData.main_tp,
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
      await log({
        functionName: 'tradingview-webhook',
        message: 'Failed to save alert to database',
        level: 'error',
        metadata: { error: alertError.message }
      });
      console.error('Error saving alert:', alertError);
      throw alertError;
    }
    
    await log({
      functionName: 'tradingview-webhook',
      message: 'Alert saved to database',
      level: 'info',
      alertId: alert.id,
      metadata: { alertId: alert.id }
    });

    console.log('Alert saved with ID:', alert.id);

    // Get user settings (handles copy_admin logic internally)
    let userSettings;
    try {
      userSettings = await getUserSettings(userId);
      console.log('User settings loaded, bot_active:', userSettings.bot_active);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';
      await log({
        functionName: 'tradingview-webhook',
        message: 'Failed to fetch user settings',
        level: 'error',
        alertId: alert.id,
        metadata: { error: errorMessage, userId }
      });
      console.error('Error fetching user settings:', error);
      await supabase
        .from('alerts')
        .update({ status: 'error', error_message: 'User settings not configured' })
        .eq('id', alert.id);
      
      return new Response(JSON.stringify({ error: 'User settings not configured', alert_id: alert.id }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (!userSettings.bot_active) {
      await log({
        functionName: 'tradingview-webhook',
        message: 'User bot is not active - alert ignored',
        level: 'warn',
        alertId: alert.id,
        metadata: { userId }
      });
      await supabase
        .from('alerts')
        .update({ status: 'ignored', error_message: 'Bot not active' })
        .eq('id', alert.id);
      
      return new Response(JSON.stringify({ message: 'Bot not active', alert_id: alert.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log('Bot is active, checking filters...');

    // Apply filters (Note: tier filtering will be handled by bitget-trader using full settings with copy_admin logic)
    if (userSettings.filter_by_tier && userSettings.excluded_tiers && userSettings.excluded_tiers.includes(alertData.tier)) {
      await log({
        functionName: 'tradingview-webhook',
        message: `Tier ${alertData.tier} excluded - alert ignored`,
        level: 'info',
        alertId: alert.id,
        metadata: { tier: alertData.tier, excludedTiers: userSettings.excluded_tiers, userId }
      });
      console.log(`Alert tier ${alertData.tier} is in excluded list`);
      await supabase
        .from('alerts')
        .update({ status: 'ignored', error_message: 'Tier excluded from trading' })
        .eq('id', alert.id);
      
      return new Response(JSON.stringify({ message: 'Tier excluded', alert_id: alert.id }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    await log({
      functionName: 'tradingview-webhook',
      message: 'All filters passed, invoking trader',
      level: 'info',
      alertId: alert.id
    });
    console.log('All filters passed, calling bitget-trader...');

    // Call trader function with user_id
    const { data: tradeResult, error: tradeError } = await supabase.functions.invoke('bitget-trader', {
      body: { alert_id: alert.id, alert_data: alertData, user_id: userId },
    });

    if (tradeError) {
      await log({
        functionName: 'tradingview-webhook',
        message: 'Trader function failed',
        level: 'error',
        alertId: alert.id,
        metadata: { error: tradeError.message }
      });
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

    await log({
      functionName: 'tradingview-webhook',
      message: 'Trade executed successfully',
      level: 'info',
      alertId: alert.id,
      metadata: { tradeResult }
    });
    console.log('Trade executed successfully:', tradeResult);

    return new Response(JSON.stringify({ success: true, alert_id: alert.id, trade_result: tradeResult }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await log({
      functionName: 'tradingview-webhook',
      message: 'Webhook processing failed',
      level: 'error',
      metadata: { error: errorMessage, stack: error instanceof Error ? error.stack : undefined }
    });
    console.error('Webhook error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
