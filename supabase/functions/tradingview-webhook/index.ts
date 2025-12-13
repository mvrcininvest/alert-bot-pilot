import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { log } from "../_shared/logger.ts";
import { getUserSettings } from "../_shared/userSettings.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Check if current time is within active trading hours
function isWithinActiveHours(
  timezone: string,
  activeRanges: Array<{start: string, end: string}>
): boolean {
  // Get current time in user's timezone
  const now = new Date();
  const userTime = new Intl.DateTimeFormat('en-GB', {
    timeZone: timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(now);

  // Convert to minutes from midnight
  const [hours, minutes] = userTime.split(':').map(Number);
  const currentMinutes = hours * 60 + minutes;

  // Check each time range
  for (const range of activeRanges) {
    const [startH, startM] = range.start.split(':').map(Number);
    const [endH, endM] = range.end.split(':').map(Number);
    const startMinutes = startH * 60 + startM;
    const endMinutes = endH * 60 + endM;

    if (endMinutes < startMinutes) {
      // Range spans midnight (e.g., 22:00-01:00)
      if (currentMinutes >= startMinutes || currentMinutes < endMinutes) {
        return true;
      }
    } else {
      // Normal range (e.g., 01:00-12:00)
      if (currentMinutes >= startMinutes && currentMinutes < endMinutes) {
        return true;
      }
    }
  }
  return false;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const bodyText = await req.text();
    const body = bodyText ? JSON.parse(bodyText) : {};
    
    // Handle ping request
    if (body.ping) {
      return new Response(JSON.stringify({ pong: true }), { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      });
    }
    
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

    // Capture webhook received timestamp
    const webhookReceivedAt = Date.now();
    
    console.log('Request body:', bodyText);
    
    // Secret authorization disabled - accepting all webhook requests
    const alertData = body;
    
    // Clean symbol: remove exchange prefix (BITGET:, BYBIT:, etc.) and .P suffix
    // Example: BITGET:AVAXUSDT.P -> AVAXUSDT
    if (alertData.symbol && alertData.symbol.includes(':')) {
      const parts = alertData.symbol.split(':');
      alertData.symbol = parts[parts.length - 1];
      console.log(`✂️ Removed exchange prefix, symbol now: ${alertData.symbol}`);
    }
    if (alertData.symbol && alertData.symbol.endsWith('.P')) {
      alertData.symbol = alertData.symbol.slice(0, -2);
      console.log(`✂️ Removed .P suffix, clean symbol: ${alertData.symbol}`);
    }
    
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

    // ✅ PHASE 3 OPTIMIZATION: Parallel user processing with concurrency limit
    const CONCURRENT_LIMIT = 10;
    const results = [];
    
    const processUser = async (userRow: any) => {
      const userId = userRow.user_id;
      console.log(`\n=== Processing for user: ${userId} ===`);

      try {
        // Extract TradingView timestamp and calculate latency
        const tvTimestamp = alertData.tv_ts ? Number(alertData.tv_ts) : null;
        let latencyWebhook = null;
        
        if (tvTimestamp && tvTimestamp > 0) {
          latencyWebhook = webhookReceivedAt - tvTimestamp;
          // Validation: should be 0-60000ms (max 1 minute, otherwise invalid timestamp)
          if (latencyWebhook < 0 || latencyWebhook > 60000) {
            latencyWebhook = null;
          }
        }

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
            tv_timestamp: tvTimestamp,
            webhook_received_at: new Date(webhookReceivedAt).toISOString(),
            latency_webhook_ms: latencyWebhook,
            indicator_version: alertData.version || alertData._indicator_version || null,
          })
          .select()
          .single();

        if (alertError) {
          console.error(`Failed to save alert for user ${userId}:`, alertError);
          return { userId, status: 'error', reason: 'Failed to save alert' };
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
          return { userId, alertId: alert.id, status: 'error', reason: 'Settings not configured' };
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
          return { userId, alertId: alert.id, status: 'ignored', reason: 'Bot not active' };
        }

        // Check indicator version filtering
        if (userSettings.indicator_version_filter && userSettings.indicator_version_filter.length > 0) {
          const alertVersion = alertData.version || alertData._indicator_version || '9.1';
          
          if (!userSettings.indicator_version_filter.includes(alertVersion)) {
            await log({
              functionName: 'tradingview-webhook',
              message: `Indicator version ${alertVersion} not in allowed versions - alert ignored`,
              level: 'info',
              alertId: alert.id,
              metadata: { 
                alertVersion, 
                allowedVersions: userSettings.indicator_version_filter, 
                userId 
              }
            });
            await supabase
              .from('alerts')
              .update({ 
                status: 'ignored', 
                error_message: `Indicator v${alertVersion} not in allowed versions [${userSettings.indicator_version_filter.join(', ')}]` 
              })
              .eq('id', alert.id);
            return { userId, alertId: alert.id, status: 'ignored', reason: `Version ${alertVersion} not allowed` };
          }
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
          return { userId, alertId: alert.id, status: 'ignored', reason: `Tier ${alertData.tier} excluded` };
        }

        // Check minimum signal strength filtering (admin setting)
        if (userSettings.min_signal_strength_enabled) {
          const alertStrength = alertData.strength ?? 0;
          const minStrength = userSettings.min_signal_strength_threshold ?? 0.50;
          
          if (alertStrength < minStrength) {
            await log({
              functionName: 'tradingview-webhook',
              message: `Signal strength ${(alertStrength * 100).toFixed(0)}% below minimum ${(minStrength * 100).toFixed(0)}% - alert ignored`,
              level: 'info',
              alertId: alert.id,
              metadata: { alertStrength, minStrength, userId }
            });
            await supabase
              .from('alerts')
              .update({ 
                status: 'ignored', 
                error_message: `Signal strength ${(alertStrength * 100).toFixed(0)}% below minimum ${(minStrength * 100).toFixed(0)}%` 
              })
              .eq('id', alert.id);
            return { userId, alertId: alert.id, status: 'ignored', reason: `Signal too weak (${(alertStrength * 100).toFixed(0)}%)` };
          }
        }

        // Check session filtering
        if (userSettings.session_filtering_enabled) {
          const alertSession = alertData.timing?.session || alertData.session;
          
          // Check if session is in excluded list
          if (alertSession && userSettings.excluded_sessions?.includes(alertSession)) {
            await log({
              functionName: 'tradingview-webhook',
              message: `Session ${alertSession} excluded - alert ignored`,
              level: 'info',
              alertId: alert.id,
              metadata: { session: alertSession, excludedSessions: userSettings.excluded_sessions, userId }
            });
            await supabase
              .from('alerts')
              .update({ status: 'ignored', error_message: `Session ${alertSession} excluded from trading` })
              .eq('id', alert.id);
            return { userId, alertId: alert.id, status: 'ignored', reason: `Session ${alertSession} excluded` };
          }
          
          // Check if session is in allowed list (if allowed list has items)
          if (alertSession && userSettings.allowed_sessions?.length > 0 && !userSettings.allowed_sessions.includes(alertSession)) {
            await log({
              functionName: 'tradingview-webhook',
              message: `Session ${alertSession} not in allowed sessions - alert ignored`,
              level: 'info',
              alertId: alert.id,
              metadata: { session: alertSession, allowedSessions: userSettings.allowed_sessions, userId }
            });
            await supabase
              .from('alerts')
              .update({ status: 'ignored', error_message: `Session ${alertSession} not in allowed sessions` })
              .eq('id', alert.id);
            return { userId, alertId: alert.id, status: 'ignored', reason: `Session ${alertSession} not allowed` };
          }
        }

        // Check time-based filtering
        if (userSettings.time_filtering_enabled && userSettings.active_time_ranges) {
          const isActive = isWithinActiveHours(
            userSettings.user_timezone || 'Europe/Amsterdam',
            userSettings.active_time_ranges
          );
          
          if (!isActive) {
            // Get current time in user timezone for logging
            const userTime = new Intl.DateTimeFormat('en-GB', {
              timeZone: userSettings.user_timezone || 'Europe/Amsterdam',
              hour: '2-digit',
              minute: '2-digit',
              hour12: false
            }).format(new Date());

            await log({
              functionName: 'tradingview-webhook',
              message: `Outside active hours (${userTime} ${userSettings.user_timezone}) - alert ignored`,
              level: 'info',
              alertId: alert.id,
              metadata: { 
                currentTime: userTime, 
                timezone: userSettings.user_timezone,
                activeRanges: userSettings.active_time_ranges,
                userId 
              }
            });
            await supabase
              .from('alerts')
              .update({ status: 'ignored', error_message: `Outside active hours (${userTime})` })
              .eq('id', alert.id);
            return { userId, alertId: alert.id, status: 'ignored', reason: `Outside active hours (${userTime})` };
          }
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
          body: { 
            alert_id: alert.id, 
            alert_data: alertData, 
            user_id: userId,
            webhook_received_at: webhookReceivedAt,
            tv_timestamp: tvTimestamp
          },
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
          return { userId, alertId: alert.id, status: 'error', reason: tradeError.message };
        } else {
          await log({
            functionName: 'tradingview-webhook',
            message: 'Trade executed successfully',
            level: 'info',
            alertId: alert.id,
            metadata: { tradeResult, userId }
          });
          return { userId, alertId: alert.id, status: 'executed', tradeResult };
        }

      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        console.error(`Error processing user ${userId}:`, error);
        return { userId, status: 'error', reason: errorMessage };
      }
    };

    // Process users in batches with concurrency limit
    for (let i = 0; i < allUsers.length; i += CONCURRENT_LIMIT) {
      const batch = allUsers.slice(i, i + CONCURRENT_LIMIT);
      const batchResults = await Promise.all(batch.map(processUser));
      results.push(...batchResults);
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
