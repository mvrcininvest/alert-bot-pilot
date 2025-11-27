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
    
    await log({
      functionName: 'tradingview-webhook',
      message: 'Alert data parsed - broadcasting to all users',
      level: 'info',
      metadata: { symbol: alertData.symbol, side: alertData.side, tier: alertData.tier }
    });

    // Get all users from user_settings
    const { data: allUsers, error: usersError } = await supabase
      .from('user_settings')
      .select('user_id');

    if (usersError || !allUsers || allUsers.length === 0) {
      await log({
        functionName: 'tradingview-webhook',
        message: 'No users configured in system',
        level: 'error',
        metadata: { error: usersError?.message }
      });
      return new Response(JSON.stringify({ error: 'No users configured' }), {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    console.log(`Broadcasting alert to ${allUsers.length} users`);

    const results = [];

    // Process alert for each user
    for (const userRow of allUsers) {
      const userId = userRow.user_id;
      console.log(`\n=== Processing for user: ${userId} ===`);

      try {
        // Save alert for this user
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
          console.error(`Failed to save alert for user ${userId}:`, alertError);
          results.push({ userId, status: 'error', reason: 'Failed to save alert' });
          continue;
        }

        console.log(`Alert saved for user ${userId}, ID: ${alert.id}`);

        // Get user settings with copy_admin logic
        let userSettings;
        try {
          userSettings = await getUserSettings(userId);
        } catch (error) {
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          await log({
            functionName: 'tradingview-webhook',
            message: 'Failed to fetch user settings',
            level: 'error',
            alertId: alert.id,
            metadata: { error: errorMessage, userId }
          });
          await supabase
            .from('alerts')
            .update({ status: 'error', error_message: 'User settings not configured' })
            .eq('id', alert.id);
          results.push({ userId, alertId: alert.id, status: 'error', reason: 'Settings not configured' });
          continue;
        }

        // Check if bot is active
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
          results.push({ userId, alertId: alert.id, status: 'ignored', reason: 'Bot not active' });
          continue;
        }

        // Check tier filtering
        if (userSettings.filter_by_tier && userSettings.excluded_tiers && userSettings.excluded_tiers.includes(alertData.tier)) {
          await log({
            functionName: 'tradingview-webhook',
            message: `Tier ${alertData.tier} excluded - alert ignored`,
            level: 'info',
            alertId: alert.id,
            metadata: { tier: alertData.tier, excludedTiers: userSettings.excluded_tiers, userId }
          });
          await supabase
            .from('alerts')
            .update({ status: 'ignored', error_message: 'Tier excluded from trading' })
            .eq('id', alert.id);
          results.push({ userId, alertId: alert.id, status: 'ignored', reason: `Tier ${alertData.tier} excluded` });
          continue;
        }

        // All validation passed, invoke trader
        await log({
          functionName: 'tradingview-webhook',
          message: 'All filters passed, invoking trader',
          level: 'info',
          alertId: alert.id,
          metadata: { userId }
        });

        const { data: tradeResult, error: tradeError } = await supabase.functions.invoke('bitget-trader', {
          body: { alert_id: alert.id, alert_data: alertData, user_id: userId },
        });

        if (tradeError) {
          await log({
            functionName: 'tradingview-webhook',
            message: 'Trader function failed',
            level: 'error',
            alertId: alert.id,
            metadata: { error: tradeError.message, userId }
          });
          await supabase
            .from('alerts')
            .update({ status: 'error', error_message: tradeError.message })
            .eq('id', alert.id);
          results.push({ userId, alertId: alert.id, status: 'error', reason: tradeError.message });
        } else {
          await log({
            functionName: 'tradingview-webhook',
            message: 'Trade executed successfully',
            level: 'info',
            alertId: alert.id,
            metadata: { tradeResult, userId }
          });
          results.push({ userId, alertId: alert.id, status: 'executed', tradeResult });
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error processing user ${userId}:`, error);
        results.push({ userId, status: 'error', reason: errorMessage });
      }
    }

    await log({
      functionName: 'tradingview-webhook',
      message: `Broadcast complete - processed ${results.length} users`,
      level: 'info',
      metadata: { 
        totalUsers: results.length,
        executed: results.filter(r => r.status === 'executed').length,
        ignored: results.filter(r => r.status === 'ignored').length,
        errors: results.filter(r => r.status === 'error').length
      }
    });

    return new Response(JSON.stringify({ 
      success: true, 
      broadcast: true,
      totalUsers: results.length,
      results 
    }), {
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
