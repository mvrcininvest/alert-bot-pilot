import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { calculatePositionSize, calculateSLTP, calculateScalpingSLTP } from "./calculators.ts";
import { adjustPositionSizeToMinimum, getMinimumPositionSize } from "./minimums.ts";
import { log } from "../_shared/logger.ts";
import { getUserApiKeys } from "../_shared/userKeys.ts";
import { getUserSettings } from "../_shared/userSettings.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const bodyText = await req.text();
  const body = bodyText ? JSON.parse(bodyText) : {};
  
  // Handle ping request
  if (body.ping) {
    return new Response(JSON.stringify({ pong: true }), { 
      headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
    });
  }

  const startTime = Date.now();
  
  // Latency tracking
  const latencyMarkers: Record<string, number> = {
    start: startTime
  };

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );
    
    // Cache for API calls to avoid duplicates
    let cachedAccountData: any = null;
    let cachedSymbolInfo: any = null;

    const { alert_id, alert_data, user_id, webhook_received_at, tv_timestamp } = body;
    latencyMarkers.request_parsed = Date.now();
    
    if (!user_id) {
      throw new Error('user_id is required');
    }
    
    // Load user API keys
    const userKeys = await getUserApiKeys(user_id);
    if (!userKeys) {
      await log({
        functionName: 'bitget-trader',
        message: 'User API keys not found or inactive',
        level: 'error',
        alertId: alert_id,
        metadata: { userId: user_id }
      });
      
      await supabase.from('alerts').update({ 
        status: 'error', 
        error_message: 'User API keys not configured or inactive' 
      }).eq('id', alert_id);
      
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'User API keys not configured' 
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    // Remove .P suffix from TradingView symbol format (XRPUSDT.P -> XRPUSDT)
    // CRITICAL: Must be done BEFORE getUserSettings to ensure proper category detection!
    if (alert_data.symbol && alert_data.symbol.endsWith('.P')) {
      alert_data.symbol = alert_data.symbol.slice(0, -2);
      console.log(`✂️ Removed .P suffix, clean symbol: ${alert_data.symbol}`);
    }
    
    // Load user settings with copy_admin logic, passing symbol for category-specific settings
    const settings = await getUserSettings(user_id, alert_data.symbol);
    
    // Log detected symbol category for debugging
    const { getSymbolCategory } = await import('./minimums.ts');
    const detectedCategory = getSymbolCategory(alert_data.symbol);
    console.log(`🏷️ Symbol ${alert_data.symbol} detected as category: ${detectedCategory}`);
    
    const apiCredentials = {
      apiKey: userKeys.apiKey,
      secretKey: userKeys.secretKey,
      passphrase: userKeys.passphrase
    };
    
    console.log('=== BITGET TRADER STARTED ===');
    console.log('Alert ID:', alert_id);
    console.log('Alert symbol:', alert_data.symbol);
    console.log('Alert side:', alert_data.side);
    console.log('Alert tier:', alert_data.tier);
    console.log('Alert strength:', alert_data.strength);
    console.log('Alert entry price:', alert_data.price);
    console.log('Alert leverage:', alert_data.leverage);

    await log({
      functionName: 'bitget-trader',
      message: 'Trader function started',
      level: 'info',
      alertId: alert_id,
      metadata: { 
        symbol: alert_data.symbol,
        side: alert_data.side,
        tier: alert_data.tier
      }
    });

    // ✅ PHASE 2: PARALLEL DB CHECKS - Execute all initial checks simultaneously
    console.log('🔄 Starting parallel DB checks...');
    const parallelStartTime = Date.now();
    
    const [
      bannedSymbolResult,
      positionLimitResult,
      existingPositionResult
    ] = await Promise.all([
      // Check 1: Banned symbol
      supabase
        .from('banned_symbols')
        .select('*')
        .eq('symbol', alert_data.symbol)
        .maybeSingle(),
      
      // Check 2: Position limit (atomic check and reserve)
      supabase.rpc('check_and_reserve_position', {
        p_user_id: user_id,
        p_max_positions: settings.max_open_positions
      }),
      
      // Check 3: Existing position for duplicate alert handling
      settings.duplicate_alert_handling !== false
        ? supabase
            .from('positions')
            .select('*, alerts!positions_alert_id_fkey(strength)')
            .eq('user_id', user_id)
            .eq('symbol', alert_data.symbol)
            .eq('status', 'open')
            .maybeSingle()
        : Promise.resolve({ data: null, error: null })
    ]);
    
    console.log(`✅ Parallel DB checks completed in ${Date.now() - parallelStartTime}ms`);
    latencyMarkers.parallel_checks_done = Date.now();

    // Process banned symbol check
    const bannedSymbol = bannedSymbolResult.data;
    if (bannedSymbol) {
      await log({
        functionName: 'bitget-trader',
        message: 'Symbol is banned - alert rejected',
        level: 'warn',
        alertId: alert_id,
        metadata: { 
          symbol: alert_data.symbol,
          bannedReason: bannedSymbol.reason,
          bannedAt: bannedSymbol.banned_at
        }
      });
      console.log(`⛔ Symbol ${alert_data.symbol} is banned: ${bannedSymbol.reason}`);
      
      await supabase
        .from('alerts')
        .update({ 
          status: 'ignored', 
          error_message: `Symbol banned: ${bannedSymbol.reason}` 
        })
        .eq('id', alert_id);
      
      return new Response(JSON.stringify({ 
        success: false, 
        message: `Symbol ${alert_data.symbol} is banned: ${bannedSymbol.reason}` 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Process position limit check
    const canOpenPosition = positionLimitResult.data;
    const positionCheckError = positionLimitResult.error;
    
    if (positionCheckError) {
      await log({
        functionName: 'bitget-trader',
        message: 'Error checking position limit',
        level: 'error',
        alertId: alert_id,
        metadata: { error: positionCheckError }
      });
      throw positionCheckError;
    }

    if (!canOpenPosition) {
      // Get current count for logging purposes only
      const { data: openPositions } = await supabase
        .from('positions')
        .select('id', { count: 'exact' })
        .eq('user_id', user_id)
        .eq('status', 'open');
      
      await log({
        functionName: 'bitget-trader',
        message: 'Max open positions reached - alert ignored',
        level: 'warn',
        alertId: alert_id,
        metadata: { 
          currentPositions: openPositions?.length || 0,
          maxPositions: settings.max_open_positions
        }
      });
      console.log('Max open positions reached');
      await supabase
        .from('alerts')
        .update({ 
          status: 'ignored', 
          error_message: 'Max open positions reached' 
        })
        .eq('id', alert_id);
      
      return new Response(JSON.stringify({ 
        success: false, 
        message: 'Max open positions reached' 
      }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }
    
    await log({
      functionName: 'bitget-trader',
      message: 'Position limit check passed - slot reserved',
      level: 'info',
      alertId: alert_id,
      metadata: { 
        maxPositions: settings.max_open_positions
      }
    });

    // Process duplicate alert handling
    const existingPosition = existingPositionResult.data;
    if (settings.duplicate_alert_handling !== false && existingPosition) {
      const currentStrength = existingPosition.alerts?.strength || 0;
        const newStrength = alert_data.strength || 0;
        const strengthDiff = newStrength - currentStrength;
        const threshold = settings.alert_strength_threshold || 0.20;
        const pnlThresholdPercent = settings.pnl_threshold_percent || 0.5;
        
        const isSameDirection = existingPosition.side === alert_data.side;
        const currentPnL = Number(existingPosition.unrealized_pnl) || 0;
        
        // Calculate position notional value
        const positionNotional = existingPosition.quantity * existingPosition.entry_price;
        const pnlThresholdUsdt = (positionNotional * pnlThresholdPercent) / 100;
        
        // Consider position in profit/loss only if PnL exceeds threshold
        // Otherwise treat as break-even (can be closed)
        const isInProfit = currentPnL >= pnlThresholdUsdt;
        const isAtLoss = currentPnL <= -pnlThresholdUsdt;
        const isBreakEven = !isInProfit && !isAtLoss;
        const isStrongerEnough = strengthDiff >= threshold;
        
        let shouldReplace = false;
        let ignoreReason = '';
        
        if (isSameDirection) {
          // SAME DIRECTION LOGIC
          if (!isStrongerEnough) {
            ignoreReason = `Same direction - new alert not strong enough (diff: ${(strengthDiff*100).toFixed(1)} < ${(threshold*100).toFixed(0)} pts)`;
          } else if (isAtLoss || isBreakEven) {
            ignoreReason = `Same direction - new alert stronger but position ${isBreakEven ? 'at break-even' : 'at loss'} (PnL: ${currentPnL.toFixed(2)} USDT, threshold: ${pnlThresholdPercent}% = ${pnlThresholdUsdt.toFixed(2)} USDT)`;
          } else {
            shouldReplace = true; // Stronger AND in significant profit
          }
        } else {
          // OPPOSITE DIRECTION LOGIC
          if (!isStrongerEnough) {
            ignoreReason = `Reversal - new alert not strong enough (diff: ${(strengthDiff*100).toFixed(1)} < ${(threshold*100).toFixed(0)} pts)`;
          } else if (isInProfit) {
            ignoreReason = `Reversal - protecting significant profit (PnL: ${currentPnL.toFixed(2)} USDT, threshold: ${pnlThresholdPercent}% = ${pnlThresholdUsdt.toFixed(2)} USDT)`;
          } else {
            shouldReplace = true; // Stronger AND (at loss OR break-even)
          }
        }
        
        if (!shouldReplace) {
          // REJECT ALERT
          await log({
            functionName: 'bitget-trader',
            message: 'Alert rejected - duplicate alert logic',
            level: 'warn',
            alertId: alert_id,
            metadata: { 
              reason: ignoreReason,
              existingPositionId: existingPosition.id,
              currentStrength,
              newStrength,
              strengthDiff,
              isSameDirection,
              currentPnL,
              pnlThresholdPercent,
              pnlThresholdUsdt,
              positionNotional,
              isInProfit,
              isAtLoss,
              isBreakEven
            }
          });
          
          await supabase.from('alerts').update({ 
            status: 'ignored', 
            error_message: ignoreReason 
          }).eq('id', alert_id);
          
          return new Response(JSON.stringify({ 
            success: false, 
            message: ignoreReason 
          }), {
            headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          });
        }
        
        // CLOSE EXISTING POSITION
        const closeReason = isSameDirection ? 'replaced_by_stronger_signal' : 'reversed_by_signal';
        
        await log({
          functionName: 'bitget-trader',
          message: `Closing existing position for replacement: ${closeReason}`,
          level: 'info',
          alertId: alert_id,
          metadata: { 
            existingPositionId: existingPosition.id,
            closeReason,
            currentStrength,
            newStrength,
            strengthDiff,
            currentPnL
          }
        });
        
        // Cancel SL/TP orders
        const orderIds = [
          existingPosition.sl_order_id, 
          existingPosition.tp1_order_id, 
          existingPosition.tp2_order_id, 
          existingPosition.tp3_order_id
        ].filter(Boolean);
        
        for (const orderId of orderIds) {
          try {
            await supabase.functions.invoke('bitget-api', {
              body: {
                action: 'cancel_plan_order',
                apiCredentials,
                params: {
                  symbol: existingPosition.symbol,
                  orderId
                }
              }
            });
          } catch (error) {
            console.warn(`Failed to cancel order ${orderId}:`, error);
          }
        }
        
        // Flash close position on exchange
        const closeSide = existingPosition.side === 'BUY' ? 'close_long' : 'close_short';
        const { data: closeResult, error: closeError } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'close_position',
            apiCredentials,
            params: {
              symbol: existingPosition.symbol,
              size: existingPosition.quantity.toString(),
              side: closeSide,
            }
          }
        });

        if (closeError || !closeResult?.success) {
          const errorMsg = closeError?.message || closeResult?.error || 'Unknown close error';
          console.error('❌ Failed to close position on exchange:', errorMsg);
          throw new Error(`Failed to close position on exchange: ${errorMsg}`);
        }

        console.log('✅ Position closed on exchange:', closeResult);
        
        // Update position in database
        await supabase.from('positions').update({
          status: 'closed',
          close_reason: closeReason,
          closed_at: new Date().toISOString()
        }).eq('id', existingPosition.id);
        
        await log({
          functionName: 'bitget-trader',
          message: `Position closed for replacement: ${closeReason}`,
          level: 'info',
          alertId: alert_id,
          positionId: existingPosition.id,
          metadata: { 
            positionId: existingPosition.id,
            closeReason
          }
        });
        
        console.log(`✓ Existing position closed for replacement: ${closeReason}`);
    }

    // Check daily loss limit FOR THIS USER (run separately as it may need account data)
    latencyMarkers.daily_loss_check_start = Date.now();
    const today = new Date().toISOString().split('T')[0];
    const { data: todayPositions } = await supabase
      .from('positions')
      .select('realized_pnl')
      .eq('user_id', user_id)
      .eq('status', 'closed')
      .gte('closed_at', `${today}T00:00:00`)
      .lte('closed_at', `${today}T23:59:59`);

    const todayPnL = todayPositions?.reduce((sum, pos) => sum + (Number(pos.realized_pnl) || 0), 0) || 0;
    
    await log({
      functionName: 'bitget-trader',
      message: 'Checking daily loss limit',
      level: 'info',
      alertId: alert_id,
      metadata: { todayPnL, lossLimitType: settings.loss_limit_type }
    });
    console.log('Today PnL:', todayPnL);

    // Check loss limit based on type - only check actual losses (negative PnL)
    if (settings.loss_limit_type === 'percent_drawdown') {
      // Get account balance using user's API credentials (CACHE THIS)
      const t1 = Date.now();
      const { data: accountData } = await supabase.functions.invoke('bitget-api', {
        body: { action: 'get_account', apiCredentials }
      });
      cachedAccountData = accountData; // Cache for later reuse
      console.log(`⏱️ get_account (percent_drawdown): ${Date.now() - t1}ms`);
      
      const accountBalance = accountData?.success && accountData.data?.[0]?.available 
        ? Number(accountData.data[0].available)
        : 10000; // fallback
      
      const maxLossAmount = accountBalance * ((settings.daily_loss_percent || 5) / 100);
      
      // Only check if today's PnL is negative (actual loss)
      if (todayPnL < 0 && Math.abs(todayPnL) >= maxLossAmount) {
        await log({
          functionName: 'bitget-trader',
          message: 'Daily drawdown limit reached - alert ignored',
          level: 'warn',
          alertId: alert_id,
          metadata: { 
            todayPnL,
            todayLoss: Math.abs(todayPnL),
            maxLossAmount,
            dailyLossPercent: settings.daily_loss_percent,
            accountBalance
          }
        });
        console.log(`Daily drawdown limit reached: ${Math.abs(todayPnL).toFixed(2)} USDT loss (${settings.daily_loss_percent}% of ${accountBalance.toFixed(2)} USDT)`);
        await supabase
          .from('alerts')
          .update({ 
            status: 'ignored', 
            error_message: `Daily loss limit reached: ${Math.abs(todayPnL).toFixed(2)} USDT loss (${settings.daily_loss_percent}% of capital)` 
          })
          .eq('id', alert_id);
        
        return new Response(JSON.stringify({ 
          success: false, 
          message: `Daily loss limit reached: ${Math.abs(todayPnL).toFixed(2)} USDT loss (${settings.daily_loss_percent}% of ${accountBalance.toFixed(2)} USDT)` 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      // Fixed USDT limit - only check actual losses (negative PnL)
      if (todayPnL < 0 && Math.abs(todayPnL) >= (settings.daily_loss_limit || 500)) {
        await log({
          functionName: 'bitget-trader',
          message: 'Daily loss limit reached - alert ignored',
          level: 'warn',
          alertId: alert_id,
          metadata: { 
            todayPnL,
            todayLoss: Math.abs(todayPnL),
            dailyLossLimit: settings.daily_loss_limit
          }
        });
        console.log(`Daily loss limit reached: ${Math.abs(todayPnL).toFixed(2)} USDT loss / ${settings.daily_loss_limit} USDT limit`);
        await supabase
          .from('alerts')
          .update({ 
            status: 'ignored', 
            error_message: `Daily loss limit reached: ${Math.abs(todayPnL).toFixed(2)} USDT loss` 
          })
          .eq('id', alert_id);
        
        return new Response(JSON.stringify({ 
          success: false, 
          message: `Daily loss limit reached: ${Math.abs(todayPnL).toFixed(2)} USDT loss / ${settings.daily_loss_limit} USDT limit` 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // ⚡ OPTIMIZATION: Fetch account balance + symbol info in PARALLEL
    latencyMarkers.parallel_api_start = Date.now();
    await log({
      functionName: 'bitget-trader',
      message: 'Fetching account balance and symbol info in parallel',
      level: 'info',
      alertId: alert_id
    });
    
    let accountData;
    if (cachedAccountData) {
      console.log('✓ Using cached account data (saved ~200-400ms)');
      accountData = cachedAccountData;
    } else {
      const t1 = Date.now();
      console.log('⚡ Parallel API calls: account balance + symbol info...');
      const [accountResult, symbolInfoResult] = await Promise.all([
        supabase.functions.invoke('bitget-api', {
          body: { action: 'get_account', apiCredentials }
        }),
        supabase.functions.invoke('bitget-api', {
          body: {
            action: 'get_symbol_info',
            apiCredentials,
            params: { symbol: alert_data.symbol }
          }
        })
      ]);
      accountData = accountResult.data;
      cachedSymbolInfo = symbolInfoResult.data; // Cache symbol info for later reuse
      console.log(`⚡ Parallel API calls completed: ${Date.now() - t1}ms (saved ~300-600ms)`);
    }
    latencyMarkers.account_balance_end = Date.now();
    
    let accountBalance = 10000; // fallback if API fails
    if (accountData?.success && accountData.data?.[0]) {
      // v2 API returns both 'available' and 'accountEquity' fields
      // Use accountEquity for more accurate total balance including unrealized PnL
      const accountInfo = accountData.data[0];
      accountBalance = Number(accountInfo.accountEquity || accountInfo.available) || 10000;
      await log({
        functionName: 'bitget-trader',
        message: 'Account balance fetched from Bitget',
        level: 'info',
        alertId: alert_id,
        metadata: { 
          accountBalance,
          availableMargin: Number(accountInfo.available || 0)
        }
      });
      console.log(`✓ Real account balance from Bitget: ${accountBalance} USDT (equity)`);
      console.log(`  Available margin: ${Number(accountInfo.available || 0).toFixed(2)} USDT`);
    } else {
      await log({
        functionName: 'bitget-trader',
        message: 'Failed to fetch account balance, using fallback',
        level: 'warn',
        alertId: alert_id,
        metadata: { fallbackBalance: accountBalance }
      });
      console.warn('⚠ Failed to get account balance from Bitget, using fallback:', accountBalance);
      console.warn('Account API response:', JSON.stringify(accountData));
    }

    // Determine leverage to use for this position
    let effectiveLeverage: number;
    let leverageSource: string;
    
    // Check if we should use alert leverage or settings leverage
    if (settings.use_alert_leverage !== false && alert_data.leverage) {
      // Use leverage from alert BUT apply category limit
      const symbolLeverageOverrides = settings.symbol_leverage_overrides || {};
      const defaultLeverage = settings.default_leverage || 10;
      
      // Apply category limit even for alert leverage
      effectiveLeverage = Math.min(alert_data.leverage, defaultLeverage);
      leverageSource = 'alert_with_category_cap';
      
      if (alert_data.leverage > defaultLeverage) {
        console.log(`⚠️ Alert leverage ${alert_data.leverage}x capped to ${effectiveLeverage}x by category limit for ${alert_data.symbol}`);
        await log({
          functionName: 'bitget-trader',
          message: `Alert leverage capped by category limit`,
          level: 'warn',
          alertId: alert_id,
          metadata: { 
            symbol: alert_data.symbol,
            requestedLeverage: alert_data.leverage,
            categoryLimit: defaultLeverage,
            appliedLeverage: effectiveLeverage
          }
        });
      } else {
        console.log(`Using leverage from alert: ${effectiveLeverage}x (within category limit)`);
      }
    } else {
      // Use leverage from settings
      const symbolLeverageOverrides = settings.symbol_leverage_overrides || {};
      const defaultLeverage = settings.default_leverage || 10;
      
      // Priority: symbol-specific numeric override > global MAX > default
      if (symbolLeverageOverrides[alert_data.symbol] && typeof symbolLeverageOverrides[alert_data.symbol] === 'number') {
        // Use custom numeric leverage override for this symbol
        effectiveLeverage = symbolLeverageOverrides[alert_data.symbol];
        leverageSource = 'symbol_override';
        console.log(`Using symbol-specific leverage for ${alert_data.symbol}: ${effectiveLeverage}x`);
      } else if (settings.use_max_leverage_global) {
        // Global MAX enabled - fetch max leverage from API (CACHE THIS)
        latencyMarkers.leverage_check_start = Date.now();
        console.log(`Global MAX leverage enabled, fetching from API for ${alert_data.symbol}...`);
        
        try {
          const t1 = Date.now();
          const { data: symbolInfoResult } = await supabase.functions.invoke('bitget-api', {
            body: {
              action: 'get_symbol_info',
              apiCredentials,
              params: { symbol: alert_data.symbol }
            }
          });
          cachedSymbolInfo = symbolInfoResult; // Cache for later reuse
          console.log(`⏱️ get_symbol_info (leverage): ${Date.now() - t1}ms`);
          latencyMarkers.leverage_check_end = Date.now();
          
          if (symbolInfoResult?.success && symbolInfoResult.data?.[0]?.maxLever) {
            const apiMaxLeverage = parseInt(symbolInfoResult.data[0].maxLever);
            
            // ✅ FIX: Use the MINIMUM of API max and category-limited default_leverage
            // settings.default_leverage already has category cap applied from getUserSettings()
            effectiveLeverage = Math.min(apiMaxLeverage, defaultLeverage);
            leverageSource = 'global_max_with_category_cap';
            
            console.log(`📊 Leverage decision for ${alert_data.symbol}: API_max=${apiMaxLeverage}x, category_cap=${defaultLeverage}x → Using ${effectiveLeverage}x`);
            
            await log({
              functionName: 'bitget-trader',
              message: `Using global MAX leverage with category cap: ${effectiveLeverage}x`,
              level: 'info',
              alertId: alert_id,
              metadata: { 
                symbol: alert_data.symbol, 
                apiMaxLever: apiMaxLeverage,
                categoryCap: defaultLeverage,
                effectiveLeverage 
              }
            });
          } else {
            // Fallback to default if API fails
            effectiveLeverage = defaultLeverage;
            leverageSource = 'default_fallback';
            console.warn(`⚠ Could not get MAX leverage for ${alert_data.symbol}, using default: ${effectiveLeverage}x`);
            
            await log({
              functionName: 'bitget-trader',
              message: `Failed to fetch global MAX leverage, using default: ${effectiveLeverage}x`,
              level: 'warn',
              alertId: alert_id,
              metadata: { symbol: alert_data.symbol, defaultLeverage: effectiveLeverage }
            });
          }
        } catch (error) {
          // Fallback to default on error
          effectiveLeverage = defaultLeverage;
          leverageSource = 'default_fallback_error';
          const errorMessage = error instanceof Error ? error.message : 'Unknown error';
          console.error(`✗ Error fetching global MAX leverage for ${alert_data.symbol}:`, error);
          
          await log({
            functionName: 'bitget-trader',
            message: `Error fetching global MAX leverage: ${errorMessage}`,
            level: 'error',
            alertId: alert_id,
            metadata: { symbol: alert_data.symbol, error: errorMessage }
          });
        }
      } else {
        // Use default leverage
        effectiveLeverage = defaultLeverage;
        leverageSource = 'default';
      }
      
      console.log(`Using leverage ${effectiveLeverage}x for ${alert_data.symbol} (source: ${leverageSource})`);
    }
    
    await log({
      functionName: 'bitget-trader',
      message: `Leverage determined: ${effectiveLeverage}x`,
      level: 'info',
      alertId: alert_id,
      metadata: { 
        leverage: effectiveLeverage,
        leverageSource,
        symbol: alert_data.symbol
      }
    });
    
    // Determine holdSide based on order side (hedge mode)
    const leverageHoldSide = alert_data.side === 'BUY' ? 'long' : 'short';
    
    await log({
      functionName: 'bitget-trader',
      message: 'Preparing leverage and position size calculation',
      level: 'info',
      alertId: alert_id,
      metadata: { 
        symbol: alert_data.symbol, 
        leverage: effectiveLeverage,
        holdSide: leverageHoldSide,
        side: alert_data.side
      }
    });
    
    // Calculate scalpingResult synchronously if needed (before parallel calls)
    let scalpingResult;
    if (settings.position_sizing_type === 'scalping_mode') {
      scalpingResult = calculateScalpingSLTP(alert_data, settings as any, effectiveLeverage);
      
      await log({
        functionName: 'bitget-trader',
        message: 'Scalping mode SL/TP calculated',
        level: scalpingResult.adjustment === 'none' ? 'info' : 'warn',
        alertId: alert_id,
        metadata: {
          symbol: alert_data.symbol,
          slPercent: scalpingResult.slPercent,
          actualMargin: scalpingResult.actualMargin,
          actualLoss: scalpingResult.actualLoss,
          adjustment: scalpingResult.adjustment,
          adjustmentReason: scalpingResult.adjustmentReason
        }
      });
      
      if (scalpingResult.adjustment !== 'none') {
        console.log(`⚠️ SCALPING MODE ADJUSTMENT: ${scalpingResult.adjustment}`);
        console.log(`   ${scalpingResult.adjustmentReason}`);
      } else {
        console.log(`✓ Scalping mode: SL=${scalpingResult.slPercent.toFixed(3)}%, Margin=${scalpingResult.actualMargin} USDT, Loss=${scalpingResult.actualLoss} USDT`);
      }
    }
    
    // ✅ PHASE 3 OPTIMIZATION: Parallel execution of set_leverage and get_symbol_info
    console.log('🔄 Starting parallel leverage + minimums check...');
    const parallelLeverageStartTime = Date.now();
    latencyMarkers.minimums_check_start = Date.now();
    
    const [setLeverageResponse, symbolInfoData] = await Promise.all([
      // 1. Set leverage on Bitget
      supabase.functions.invoke('bitget-api', {
        body: {
          action: 'set_leverage',
          apiCredentials,
          params: {
            symbol: alert_data.symbol,
            leverage: effectiveLeverage,
            holdSide: leverageHoldSide
          }
        }
      }),
      
      // 2. Get symbol info (use cache if available)
      cachedSymbolInfo 
        ? Promise.resolve({ success: true, data: cachedSymbolInfo })
        : supabase.functions.invoke('bitget-api', {
            body: {
              action: 'get_symbol_info',
              apiCredentials,
              params: { symbol: alert_data.symbol }
            }
          }).then(result => {
            cachedSymbolInfo = result.data; // Cache for later reuse
            return result.data;
          })
    ]);
    
    console.log(`✅ Parallel leverage + minimums completed in ${Date.now() - parallelLeverageStartTime}ms`);
    latencyMarkers.minimums_check_end = Date.now();
    
    // Log the response from set_leverage
    if (setLeverageResponse?.data) {
      console.log(`✅ Set leverage response:`, JSON.stringify(setLeverageResponse.data));
      await log({
        functionName: 'bitget-trader',
        message: 'Leverage set successfully',
        level: 'info',
        alertId: alert_id,
        metadata: { 
          symbol: alert_data.symbol,
          requestedLeverage: effectiveLeverage,
          holdSide: leverageHoldSide,
          response: setLeverageResponse.data
        }
      });
    } else if (setLeverageResponse?.error) {
      console.error(`❌ Set leverage failed:`, setLeverageResponse.error);
      await log({
        functionName: 'bitget-trader',
        message: 'Failed to set leverage',
        level: 'error',
        alertId: alert_id,
        metadata: { 
          symbol: alert_data.symbol,
          requestedLeverage: effectiveLeverage,
          holdSide: leverageHoldSide,
          error: setLeverageResponse.error
        }
      });
    }

    // Calculate position size
    let quantity = calculatePositionSize(settings, alert_data, accountBalance, effectiveLeverage, scalpingResult);
    await log({
      functionName: 'bitget-trader',
      message: 'Position size calculated',
      level: 'info',
      alertId: alert_id,
      metadata: { 
        initialQuantity: quantity, 
        symbol: alert_data.symbol,
        positionSizingType: settings.position_sizing_type,
        ...(scalpingResult && { scalpingMargin: scalpingResult.actualMargin })
      }
    });
    console.log('Initial calculated quantity:', quantity);
    
    // Extract minimum requirements from symbol info
    let minQuantity = 0.001; // Default fallback
    let minNotionalValue = 5; // Default fallback
    let volumePlace = 4; // Default precision (4 decimal places)
    
    if (symbolInfoData?.success && symbolInfoData.data?.length > 0) {
      const contractInfo = symbolInfoData.data[0];
      minQuantity = parseFloat(contractInfo.minTradeNum || '0.001');
      minNotionalValue = parseFloat(contractInfo.minTradeUSDT || '5');
      volumePlace = parseInt(contractInfo.volumePlace || '4', 10);
      
      await log({
        functionName: 'bitget-trader',
        message: `Retrieved real minimums from Bitget API for ${alert_data.symbol}`,
        level: 'info',
        alertId: alert_id,
        metadata: {
          symbol: alert_data.symbol,
          minTradeNum: minQuantity,
          minTradeUSDT: minNotionalValue,
          volumePlace: volumePlace
        }
      });
      
      console.log(`✅ ${alert_data.symbol} minimums from Bitget API:`, {
        minTradeNum: minQuantity,
        minTradeUSDT: minNotionalValue,
        volumePlace: volumePlace
      });
    } else {
      console.warn('⚠️ Could not fetch symbol info from API, using defaults');
      await log({
        functionName: 'bitget-trader',
        message: 'Failed to fetch symbol info, using default minimums',
        level: 'warn',
        alertId: alert_id,
        metadata: { symbol: alert_data.symbol }
      });
    }
    
    // Helper function to round quantity to required precision with buffer
    const roundUpToVolumePlace = (qty: number, volumePlacePrecision: number, minNotional: number, price: number): number => {
      const precision = Math.pow(10, volumePlacePrecision);
      
      // CRITICAL FIX: Add buffer BEFORE rounding (1% instead of 3% to avoid doubling)
      const withBuffer = qty * 1.01;
      
      // Round up to required precision (only ONCE!)
      let rounded = Math.ceil(withBuffer * precision) / precision;
      
      // Ensure it meets minimum notional value
      while (rounded * price < minNotional) {
        rounded += 1 / precision;
      }
      
      return rounded;
    };
    
    // Calculate notional value of our position
    const notionalValue = quantity * alert_data.price;
    
    // Check BOTH quantity and notional minimums and use whichever is HIGHER
    if (quantity < minQuantity || notionalValue < minNotionalValue) {
      const quantityFromMinNotional = minNotionalValue / alert_data.price;
      let adjustedQuantity = Math.max(minQuantity, quantityFromMinNotional);
      
      // Apply volumePlace rounding with buffer
      adjustedQuantity = roundUpToVolumePlace(adjustedQuantity, volumePlace, minNotionalValue, alert_data.price);
      
      const adjustedNotional = adjustedQuantity * alert_data.price;
      const adjustedMargin = adjustedNotional / effectiveLeverage;
      
      await log({
        functionName: 'bitget-trader',
        message: 'Position size adjusted to meet Bitget minimums and precision',
        level: 'info',
        alertId: alert_id,
        metadata: {
          symbol: alert_data.symbol,
          originalQuantity: quantity,
          originalNotional: notionalValue,
          adjustedQuantity: adjustedQuantity,
          adjustedNotional: adjustedNotional,
          adjustedMargin: adjustedMargin,
          minQuantity: minQuantity,
          minNotional: minNotionalValue,
          volumePlace: volumePlace
        }
      });
      
      console.log(`⚠️ Position size adjusted to meet Bitget requirements:`);
      console.log(`   Original: quantity=${quantity}, notional=${notionalValue.toFixed(2)} USDT, margin=${(notionalValue/effectiveLeverage).toFixed(2)} USDT`);
      console.log(`   Minimums: quantity=${minQuantity}, notional=${minNotionalValue} USDT, volumePlace=${volumePlace}`);
      console.log(`   Adjusted: quantity=${adjustedQuantity}, notional=${adjustedNotional.toFixed(2)} USDT, margin=${adjustedMargin.toFixed(2)} USDT`);
      
      quantity = adjustedQuantity;
    } else {
      // Still apply volumePlace rounding even if we meet minimums
      const originalQuantity = quantity;
      quantity = roundUpToVolumePlace(quantity, volumePlace, minNotionalValue, alert_data.price);
      
      if (quantity !== originalQuantity) {
        console.log(`✓ Quantity rounded for precision: ${originalQuantity} → ${quantity} (volumePlace=${volumePlace})`);
      } else {
        console.log(`✅ Position size meets Bitget requirements: quantity=${quantity}, notional=${notionalValue.toFixed(2)} USDT, margin=${(notionalValue/effectiveLeverage).toFixed(2)} USDT`);
      }
    }

    // Calculate SL/TP prices
    console.log('Calculating SL/TP prices...');
    let sl_price, tp1_price, tp2_price, tp3_price;
    
    if (settings.position_sizing_type === 'scalping_mode' && scalpingResult) {
      // Use pre-calculated scalping results
      ({ sl_price, tp1_price, tp2_price, tp3_price } = scalpingResult);
      console.log('✓ Using scalping mode SL/TP prices:', {
        entry: alert_data.price,
        sl_price,
        slPercent: scalpingResult.slPercent,
        tp1_price,
        tp2_price,
        tp3_price,
        quantity
      });
    } else {
      // Use normal calculation
      ({ sl_price, tp1_price, tp2_price, tp3_price } = calculateSLTP(
        alert_data,
        settings,
        quantity,
        effectiveLeverage  // CRITICAL FIX: Pass effective leverage for correct SL calculation
      ));
      console.log('✓ Calculated prices:', { 
        entry: alert_data.price,
        sl_price, 
        tp1_price, 
        tp2_price, 
        tp3_price,
        quantity 
      });
    }

    // FEE-AWARE VALIDATION: Check if TP1 is too close (fees will eat profit)
    if (tp1_price && settings.include_fees_in_calculations) {
      const notional = quantity * alert_data.price;
      const feeRate = settings.taker_fee_rate || 0.06;
      const roundTripFees = notional * (feeRate * 2) / 100;
      const expectedTP1Profit = Math.abs(tp1_price - alert_data.price) * quantity;

      if (expectedTP1Profit < roundTripFees * 1.5) {
        await log({
          functionName: 'bitget-trader',
          message: `⚠️ TP1 too close! Expected profit ${expectedTP1Profit.toFixed(4)} USDT < fees ${roundTripFees.toFixed(4)} USDT × 1.5`,
          level: 'warn',
          alertId: alert_id,
          metadata: {
            expectedTP1Profit,
            roundTripFees,
            ratio: expectedTP1Profit / roundTripFees,
            tp1_price,
            entry_price: alert_data.price,
            notional
          }
        });
        console.warn(`⚠️ TP1 too close! Profit: ${expectedTP1Profit.toFixed(4)}, Fees: ${roundTripFees.toFixed(4)}`);
      }
    }

    // Call Bitget API to place order
    const side = alert_data.side === 'BUY' ? 'open_long' : 'open_short';
    await log({
      functionName: 'bitget-trader',
      message: `Placing ${side} order on Bitget`,
      level: 'info',
      alertId: alert_id,
      metadata: { 
        symbol: alert_data.symbol,
        size: quantity,
        side,
        leverage: effectiveLeverage,
        entryPrice: alert_data.price
      }
    });
    console.log(`Placing ${side} order on Bitget for ${alert_data.symbol}...`);
    console.log('Order params:', {
      symbol: alert_data.symbol,
      size: quantity.toString(),
      side: side,
      leverage: effectiveLeverage
    });
    
    let orderResult;
    let orderQuantity = quantity;
    
    try {
      const { data } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'place_order',
          apiCredentials,
          params: {
            symbol: alert_data.symbol,
            size: orderQuantity.toString(),
            side: side,
          }
        }
      });
      orderResult = data;
    } catch (error: any) {
      // Check if error is "less than minimum" (code 45110)
      const errorMsg = error?.message || error?.context?.error || '';
      if (errorMsg.includes('45110') || errorMsg.includes('less than the minimum')) {
        await log({
          functionName: 'bitget-trader',
          message: 'Position size below minimum, retrying with minimum size',
          level: 'info',
          alertId: alert_id,
          metadata: { 
            originalSize: orderQuantity,
            symbol: alert_data.symbol 
          }
        });
        console.log(`Position below minimum, using minimum size for ${alert_data.symbol}`);
        
        // Calculate minimum quantity for this symbol
        const minNotional = getMinimumPositionSize(alert_data.symbol);
        orderQuantity = minNotional / alert_data.price;
        
        console.log(`Retrying with minimum quantity: ${orderQuantity} (${minNotional} USDT)`);
        
        // Retry with minimum quantity using user's API credentials
        const { data } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'place_order',
            apiCredentials,
            params: {
              symbol: alert_data.symbol,
              size: orderQuantity.toString(),
              side: side,
            }
          }
        });
        orderResult = data;
        
        // Update quantity for SL/TP orders
        quantity = orderQuantity;
      } else {
        throw error;
      }
    }

    if (!orderResult?.success) {
      await log({
        functionName: 'bitget-trader',
        message: 'Failed to place order on Bitget',
        level: 'error',
        alertId: alert_id,
        metadata: { error: 'Order placement failed' }
      });
      throw new Error('Failed to place order on Bitget');
    }

    const orderId = orderResult.data.orderId;
    await log({
      functionName: 'bitget-trader',
      message: 'Order placed successfully',
      level: 'info',
      alertId: alert_id,
      metadata: { orderId, symbol: alert_data.symbol }
    });
    console.log('Order placed:', orderId);
    latencyMarkers.order_placed = Date.now();

    // ⚡ DIAGNOSTIC: Test fill price availability
    const fillPriceTestStart = Date.now();
    let fillPrice = null;
    let fillPriceSlippage = null;

    try {
      // Small delay for Bitget propagation
      await new Promise(resolve => setTimeout(resolve, 50));
      
      const { data: positionData } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'get_position',
          apiCredentials,
          params: { symbol: alert_data.symbol }
        }
      });
      
      const fillPriceTestDuration = Date.now() - fillPriceTestStart;
      
      // Extract fill price from position
      const positionInfo = positionData?.data?.[0];
      if (positionInfo?.openPriceAvg) {
        fillPrice = parseFloat(positionInfo.openPriceAvg);
        fillPriceSlippage = ((fillPrice - alert_data.price) / alert_data.price * 100).toFixed(4);
        
        await log({
          functionName: 'bitget-trader',
          message: '📊 FILL PRICE DIAGNOSTIC',
          level: 'info',
          alertId: alert_id,
          metadata: {
            alertPrice: alert_data.price,
            fillPrice: fillPrice,
            slippagePercent: fillPriceSlippage,
            fetchTimeMs: fillPriceTestDuration,
            side: alert_data.side,
            symbol: alert_data.symbol
          }
        });
        
        console.log(`📊 Fill price: ${fillPrice} (alert: ${alert_data.price}, slippage: ${fillPriceSlippage}%, fetch: ${fillPriceTestDuration}ms)`);
      } else {
        console.warn(`⚠️ Fill price not available yet after ${fillPriceTestDuration}ms`);
        await log({
          functionName: 'bitget-trader',
          message: 'Fill price not available in diagnostic test',
          level: 'warn',
          alertId: alert_id,
          metadata: { fetchTimeMs: fillPriceTestDuration }
        });
      }
    } catch (error) {
      console.error('Fill price diagnostic failed:', error);
      await log({
        functionName: 'bitget-trader',
        message: 'Fill price diagnostic error',
        level: 'error',
        alertId: alert_id,
        metadata: { error: String(error) }
      });
    }

    // Get symbol info to determine price precision (RE-USE CACHED)
    latencyMarkers.precision_check_start = Date.now();
    let priceInfoResult;
    if (cachedSymbolInfo) {
      console.log('✓ Using cached symbol info for precision (saved ~200-400ms)');
      priceInfoResult = cachedSymbolInfo;
    } else {
      const t1 = Date.now();
      const result = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'get_symbol_info',
          apiCredentials,
          params: { symbol: alert_data.symbol }
        }
      });
      priceInfoResult = result.data;
      console.log(`⏱️ get_symbol_info (precision): ${Date.now() - t1}ms`);
    }
    latencyMarkers.precision_check_end = Date.now();
    
    let pricePlace = 2; // Default to 2 decimal places
    if (priceInfoResult?.success && priceInfoResult.data?.[0]) {
      pricePlace = parseInt(priceInfoResult.data[0].pricePlace || '2');
    }
    
    await log({
      functionName: 'bitget-trader',
      message: 'Symbol precision fetched',
      level: 'info',
      alertId: alert_id,
      metadata: { symbol: alert_data.symbol, pricePlace }
    });
    
    // Round prices to correct precision
    const roundToPlaces = (price: number, places: number): string => {
      return price.toFixed(places);
    };
    
    // 1. First round the SL price
    const roundedSlPrice = roundToPlaces(sl_price, pricePlace);
    
    // 2. Calculate ACTUAL SL distance from rounded SL (to maintain exact R:R)
    const actualSlDistance = Math.abs(alert_data.price - parseFloat(roundedSlPrice));
    
    // 3. Get R:R ratios from settings
    const tp1RR = settings.tp1_rr_ratio || 1.2;
    const tp2RR = settings.tp2_rr_ratio || 2.4;
    const tp3RR = settings.tp3_rr_ratio || 3.5;
    
    // 4. Recalculate TP prices from actual SL distance to preserve exact R:R
    let correctedTp1Price = tp1_price;
    let correctedTp2Price = tp2_price;
    let correctedTp3Price = tp3_price;
    
    if (actualSlDistance > 0 && settings.position_sizing_type === 'scalping_mode') {
      const direction = alert_data.side === 'BUY' ? 1 : -1;
      
      if (tp1_price) {
        correctedTp1Price = alert_data.price + (direction * actualSlDistance * tp1RR);
      }
      if (tp2_price) {
        correctedTp2Price = alert_data.price + (direction * actualSlDistance * tp2RR);
      }
      if (tp3_price) {
        correctedTp3Price = alert_data.price + (direction * actualSlDistance * tp3RR);
      }
      
      console.log(`🔧 TP prices recalculated from rounded SL (actual SL distance: ${actualSlDistance.toFixed(6)}):`);
      console.log(`   Original TP1: ${tp1_price?.toFixed(pricePlace)} → Corrected: ${correctedTp1Price?.toFixed(pricePlace)}`);
      console.log(`   Original TP2: ${tp2_price?.toFixed(pricePlace)} → Corrected: ${correctedTp2Price?.toFixed(pricePlace)}`);
      console.log(`   Original TP3: ${tp3_price?.toFixed(pricePlace)} → Corrected: ${correctedTp3Price?.toFixed(pricePlace)}`);
    }
    
    // 5. Round corrected TP prices
    const roundedTp1Price = correctedTp1Price ? roundToPlaces(correctedTp1Price, pricePlace) : null;
    const roundedTp2Price = correctedTp2Price ? roundToPlaces(correctedTp2Price, pricePlace) : null;
    const roundedTp3Price = correctedTp3Price ? roundToPlaces(correctedTp3Price, pricePlace) : null;
    
    // 6. Log effective R:R for verification
    console.log(`Prices rounded to ${pricePlace} decimals:`);
    console.log(`SL: ${sl_price} -> ${roundedSlPrice}`);
    if (roundedTp1Price) {
      const effectiveTP1RR = actualSlDistance > 0 ? Math.abs(parseFloat(roundedTp1Price) - alert_data.price) / actualSlDistance : 0;
      console.log(`TP1: ${tp1_price} -> ${roundedTp1Price} (effective R:R: ${effectiveTP1RR.toFixed(2)}, target: ${tp1RR})`);
    }
    if (roundedTp2Price) {
      const effectiveTP2RR = actualSlDistance > 0 ? Math.abs(parseFloat(roundedTp2Price) - alert_data.price) / actualSlDistance : 0;
      console.log(`TP2: ${tp2_price} -> ${roundedTp2Price} (effective R:R: ${effectiveTP2RR.toFixed(2)}, target: ${tp2RR})`);
    }
    if (roundedTp3Price) {
      const effectiveTP3RR = actualSlDistance > 0 ? Math.abs(parseFloat(roundedTp3Price) - alert_data.price) / actualSlDistance : 0;
      console.log(`TP3: ${tp3_price} -> ${roundedTp3Price} (effective R:R: ${effectiveTP3RR.toFixed(2)}, target: ${tp3RR})`);
    }

    // ⚡ OPTIMIZATION: Place SL order first, then TPs in parallel
    await log({
      functionName: 'bitget-trader',
      message: 'Placing SL order',
      level: 'info',
      alertId: alert_id,
      metadata: { slPrice: roundedSlPrice, symbol: alert_data.symbol }
    });
    const holdSide = alert_data.side === 'BUY' ? 'long' : 'short';
    
    latencyMarkers.sl_order_start = Date.now();
    const { data: slResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'place_tpsl_order',
        apiCredentials,
        params: {
          symbol: alert_data.symbol,
          planType: 'pos_loss',
          triggerPrice: roundedSlPrice,
          triggerType: 'mark_price',
          holdSide: holdSide,
          executePrice: 0,
        }
      }
    });
    latencyMarkers.sl_order_end = Date.now();

    const slOrderId = slResult?.success ? slResult.data.orderId : null;
    await log({
      functionName: 'bitget-trader',
      message: slOrderId ? 'Stop Loss order placed' : 'Stop Loss order failed',
      level: slOrderId ? 'info' : 'error',
      alertId: alert_id,
      metadata: { slOrderId, slPrice: sl_price, error: slResult?.error }
    });
    if (!slOrderId) {
      console.error('Failed to place SL order:', slResult);
    }

    // Helper function: Determine how many TP levels can be set based on quantity
    function determineActualTPLevels(
      quantity: number,
      minQuantity: number,
      requestedLevels: number,
      percentages: { tp1: number; tp2: number; tp3: number }
    ): number {
      // Check if we can split into 3 TP levels
      if (requestedLevels >= 3) {
        const tp1Qty = quantity * (percentages.tp1 / 100);
        const tp2Qty = quantity * (percentages.tp2 / 100);
        const tp3Qty = quantity * (percentages.tp3 / 100);
        
        if (tp1Qty >= minQuantity && tp2Qty >= minQuantity && tp3Qty >= minQuantity) {
          return 3;
        }
      }
      
      // Check if we can split into 2 TP levels (with redistributed TP3 %)
      if (requestedLevels >= 2) {
        const redistributed = percentages.tp3 / 2;
        const adjustedTp1Percent = percentages.tp1 + redistributed;
        const adjustedTp2Percent = percentages.tp2 + redistributed;
        
        const tp1Qty = quantity * (adjustedTp1Percent / 100);
        const tp2Qty = quantity * (adjustedTp2Percent / 100);
        
        // Original check - user percentages work directly
        if (tp1Qty >= minQuantity && tp2Qty >= minQuantity) {
          return 2;
        }
        
        // 🆕 NEW: Check if we can split at all (even with different percentages)
        // If position can be split into 2 parts where each >= minQuantity
        const canSplitAtAll = (quantity / 2) >= minQuantity;
        if (canSplitAtAll) {
          // Return 2 with a flag that smart redistribution is needed
          // The main logic will handle adjusting percentages
          return 2; // Signal: "2 TP possible with redistribution"
        }
      }
      
      // Fallback: only 1 TP level
      return 1;
    }

    // Helper function: Round TP quantities and ensure sum equals total quantity
    function roundTPQuantitiesWithBalance(
      quantities: { tp1: number; tp2: number; tp3: number },
      totalQuantity: number,
      volumePlace: number
    ): { tp1: number; tp2: number; tp3: number } {
      const precision = Math.pow(10, volumePlace);
      
      // Round each quantity to volumePlace precision using Math.round to avoid truncation
      let rounded = {
        tp1: Math.round(quantities.tp1 * precision) / precision,
        tp2: Math.round(quantities.tp2 * precision) / precision,
        tp3: Math.round(quantities.tp3 * precision) / precision
      };
      
      // Calculate remainder (what was lost/gained in rounding)
      const sumRounded = rounded.tp1 + rounded.tp2 + rounded.tp3;
      const remainder = Math.round((totalQuantity - sumRounded) * precision) / precision;
      
      // Handle both positive AND negative remainder by adjusting the largest TP
      // Positive remainder: sum too small, need to add
      // Negative remainder: sum too large, need to subtract
      if (Math.abs(remainder) > 0.0000001) {
        // Prefer tp2 (usually largest with 75% in 2-TP setup)
        if (rounded.tp2 > 0 && rounded.tp2 >= rounded.tp1 && rounded.tp2 >= rounded.tp3) {
          rounded.tp2 = Math.round((rounded.tp2 + remainder) * precision) / precision;
        } else if (rounded.tp1 >= rounded.tp3) {
          rounded.tp1 = Math.round((rounded.tp1 + remainder) * precision) / precision;
        } else if (rounded.tp3 > 0) {
          rounded.tp3 = Math.round((rounded.tp3 + remainder) * precision) / precision;
        } else {
          // Fallback to tp1
          rounded.tp1 = Math.round((rounded.tp1 + remainder) * precision) / precision;
        }
      }
      
      // Final validation - ensure sum equals total
      const finalSum = rounded.tp1 + rounded.tp2 + rounded.tp3;
      const finalDiff = Math.round((totalQuantity - finalSum) * precision) / precision;
      if (Math.abs(finalDiff) > 0.0000001) {
        console.warn(`⚠️ TP quantity mismatch after rounding! Forcing correction. Total=${totalQuantity}, Sum=${finalSum}, Diff=${finalDiff}`);
        // Force correction on tp2 (usually largest)
        if (rounded.tp2 > 0) {
          rounded.tp2 = Math.round((rounded.tp2 + finalDiff) * precision) / precision;
        } else {
          rounded.tp1 = Math.round((rounded.tp1 + finalDiff) * precision) / precision;
        }
      }
      
      return rounded;
    }

    // Calculate quantities for partial TP closing with intelligent allocation
    let tp1Quantity = quantity;
    let tp2Quantity = 0;
    let tp3Quantity = 0;
    let effectiveTp1Price = roundedTp1Price;
    let effectiveTp2Price = roundedTp2Price;
    let effectiveTp3Price = roundedTp3Price;
    
    if (settings.tp_strategy === 'partial_close' && settings.tp_levels >= 2) {
      const requestedLevels = settings.tp_levels;
      const originalPercentages = {
        tp1: settings.tp1_close_percent,
        tp2: settings.tp2_close_percent,
        tp3: settings.tp3_close_percent
      };

      // Determine how many TP levels we can actually set
      const actualLevels = determineActualTPLevels(
        quantity,
        minQuantity,
        requestedLevels,
        originalPercentages
      );

      console.log(`📊 TP Levels: requested=${requestedLevels}, actual=${actualLevels} (minQty=${minQuantity})`);

      // Calculate new percentages based on actual levels
      let tp1Percent, tp2Percent, tp3Percent;

      if (actualLevels === 3) {
        // Can set 3 TP - use original settings
        tp1Percent = originalPercentages.tp1;
        tp2Percent = originalPercentages.tp2;
        tp3Percent = originalPercentages.tp3;
        effectiveTp1Price = roundedTp1Price;
        effectiveTp2Price = roundedTp2Price;
        effectiveTp3Price = roundedTp3Price;
        
        console.log(`✅ Using all 3 TP as configured`);
        console.log(`   TP1: ${tp1Percent}%, TP2: ${tp2Percent}%, TP3: ${tp3Percent}%`);
        
      } else if (actualLevels === 2) {
        // Redistribute TP3 quantity to TP1 and TP2
        const redistributed = originalPercentages.tp3 / 2;
        let adjustedTp1 = originalPercentages.tp1 + redistributed;
        let adjustedTp2 = originalPercentages.tp2 + redistributed;
        
        const tp1QtyRaw = quantity * (adjustedTp1 / 100);
        const tp2QtyRaw = quantity * (adjustedTp2 / 100);
        
        // 🆕 Smart redistribution: if any TP < minQuantity, adjust to minimum
        if (tp1QtyRaw < minQuantity && tp2QtyRaw >= minQuantity) {
          // TP1 is too small - give it minQuantity, rest goes to TP2
          const minPercent = (minQuantity / quantity) * 100;
          tp1Percent = minPercent;
          tp2Percent = 100 - minPercent;
          
          console.log(`⚠️ Smart redistribution: TP1 was ${adjustedTp1.toFixed(1)}% (${tp1QtyRaw.toFixed(4)} < ${minQuantity})`);
          console.log(`   Adjusted to: TP1=${tp1Percent.toFixed(1)}% (${minQuantity}), TP2=${tp2Percent.toFixed(1)}%`);
        } else if (tp2QtyRaw < minQuantity && tp1QtyRaw >= minQuantity) {
          // TP2 is too small - give it minQuantity, rest goes to TP1
          const minPercent = (minQuantity / quantity) * 100;
          tp2Percent = minPercent;
          tp1Percent = 100 - minPercent;
          
          console.log(`⚠️ Smart redistribution: TP2 was ${adjustedTp2.toFixed(1)}% (${tp2QtyRaw.toFixed(4)} < ${minQuantity})`);
          console.log(`   Adjusted to: TP1=${tp1Percent.toFixed(1)}%, TP2=${tp2Percent.toFixed(1)}% (${minQuantity})`);
        } else {
          // Both quantities are valid OR both too small (will fallback to 1 TP)
          tp1Percent = adjustedTp1;
          tp2Percent = adjustedTp2;
        }
        tp3Percent = 0;
        
        // Keep original R:R for TP1 and TP2 (not TP3)
        effectiveTp1Price = roundedTp1Price;  // Maintains TP1 R:R
        effectiveTp2Price = roundedTp2Price;  // Maintains TP2 R:R
        effectiveTp3Price = null;             // No TP3
        
        if (requestedLevels === 3) {
          // Użytkownik chciał 3 TP, ale quantity pozwala tylko na 2
          console.log(`⚠️ Cannot split into 3 TP (quantity too small), using 2 TP with redistributed quantity`);
          console.log(`   TP1: ${originalPercentages.tp1}% → ${tp1Percent}% (absorbed ${redistributed}% from TP3)`);
          console.log(`   TP2: ${originalPercentages.tp2}% → ${tp2Percent}% (absorbed ${redistributed}% from TP3)`);
          console.log(`   TP3: ${originalPercentages.tp3}% → 0% (skipped)`);
        } else {
          // Użytkownik ustawił 2 TP i system może je ustawić
          console.log(`✅ Using 2 TP as configured (after redistribution if needed)`);
          console.log(`   TP1: ${tp1Percent.toFixed(1)}%, TP2: ${tp2Percent.toFixed(1)}%`);
        }
        
      } else {
        // Only 1 TP - 100% of position at TP1
        tp1Percent = 100;
        tp2Percent = 0;
        tp3Percent = 0;
        
        effectiveTp1Price = roundedTp1Price;  // Maintains TP1 R:R
        effectiveTp2Price = null;
        effectiveTp3Price = null;
        
        if (requestedLevels === 3) {
          console.log(`⚠️ Cannot split into ${requestedLevels} TP (quantity too small for minQty=${minQuantity}), using single TP`);
          console.log(`   TP1: 100% (originally ${originalPercentages.tp1}%)`);
          console.log(`   TP2: 0% (originally ${originalPercentages.tp2}%, skipped)`);
          console.log(`   TP3: 0% (originally ${originalPercentages.tp3}%, skipped)`);
        } else if (requestedLevels === 2) {
          console.log(`⚠️ Cannot split into 2 TP (quantity too small for minQty=${minQuantity}), using single TP`);
          console.log(`   TP1: 100% (originally ${originalPercentages.tp1}%)`);
          console.log(`   TP2: 0% (originally ${originalPercentages.tp2}%, skipped)`);
        } else {
          console.log(`✅ Using single TP as configured`);
        }
      }

      // Calculate raw quantities
      const rawQuantities = {
        tp1: quantity * (tp1Percent / 100),
        tp2: quantity * (tp2Percent / 100),
        tp3: quantity * (tp3Percent / 100)
      };

      // Round quantities with balance to ensure sum = quantity
      const roundedQuantities = roundTPQuantitiesWithBalance(
        rawQuantities,
        quantity,
        volumePlace
      );

      tp1Quantity = roundedQuantities.tp1;
      tp2Quantity = roundedQuantities.tp2;
      tp3Quantity = roundedQuantities.tp3;

      // Log detailed TP calculation
      await log({
        functionName: 'bitget-trader',
        message: 'TP quantities calculated with intelligent allocation',
        level: 'info',
        alertId: alert_id,
        metadata: {
          requestedLevels,
          actualLevels,
          originalPercentages,
          adjustedPercentages: { tp1: tp1Percent, tp2: tp2Percent, tp3: tp3Percent },
          rawQuantities,
          roundedQuantities,
          totalQuantity: quantity,
          minQuantity,
          volumePlace,
          sumCheck: tp1Quantity + tp2Quantity + tp3Quantity
        }
      });

      console.log(`✓ Final TP quantities: TP1=${tp1Quantity}, TP2=${tp2Quantity}, TP3=${tp3Quantity}`);
      console.log(`✓ Sum verification: ${tp1Quantity + tp2Quantity + tp3Quantity} = ${quantity}`);
      
    } else if (settings.tp_strategy === 'main_tp_only') {
      // Only one TP with full quantity
      tp1Quantity = quantity;
      tp2Quantity = 0;
      tp3Quantity = 0;
      effectiveTp1Price = roundedTp1Price;
      effectiveTp2Price = null;
      effectiveTp3Price = null;
    }

    // Place TP orders using place_plan_order for multiple independent TPs (PARALLEL with Promise.allSettled)
    latencyMarkers.tp_orders_start = Date.now();
    let tp1OrderId, tp2OrderId, tp3OrderId;
    
    // Build array of TP orders to place in parallel
    const tpOrderPromises: Array<{ label: string; promise: Promise<any>; price: string; quantity: number }> = [];
    
    if (effectiveTp1Price && tp1Quantity > 0) {
      tpOrderPromises.push({
        label: 'TP1',
        price: effectiveTp1Price,
        quantity: tp1Quantity,
        promise: supabase.functions.invoke('bitget-api', {
          body: {
            action: 'place_plan_order',
            apiCredentials,
            params: {
              symbol: alert_data.symbol,
              planType: 'normal_plan',
              triggerPrice: effectiveTp1Price,
              triggerType: 'mark_price',
              side: holdSide === 'long' ? 'sell' : 'buy',
              tradeSide: 'close',
              size: tp1Quantity.toString(),
              orderType: 'market',
            }
          }
        })
      });
    }
    
    if (effectiveTp2Price && tp2Quantity > 0) {
      tpOrderPromises.push({
        label: 'TP2',
        price: effectiveTp2Price,
        quantity: tp2Quantity,
        promise: supabase.functions.invoke('bitget-api', {
          body: {
            action: 'place_plan_order',
            apiCredentials,
            params: {
              symbol: alert_data.symbol,
              planType: 'normal_plan',
              triggerPrice: effectiveTp2Price,
              triggerType: 'mark_price',
              side: holdSide === 'long' ? 'sell' : 'buy',
              tradeSide: 'close',
              size: tp2Quantity.toString(),
              orderType: 'market',
            }
          }
        })
      });
    }
    
    if (effectiveTp3Price && tp3Quantity > 0) {
      tpOrderPromises.push({
        label: 'TP3',
        price: effectiveTp3Price,
        quantity: tp3Quantity,
        promise: supabase.functions.invoke('bitget-api', {
          body: {
            action: 'place_plan_order',
            apiCredentials,
            params: {
              symbol: alert_data.symbol,
              planType: 'normal_plan',
              triggerPrice: effectiveTp3Price,
              triggerType: 'mark_price',
              side: holdSide === 'long' ? 'sell' : 'buy',
              tradeSide: 'close',
              size: tp3Quantity.toString(),
              orderType: 'market',
            }
          }
        })
      });
    }
    
    // Execute all TP orders in parallel with Promise.allSettled (failure of one doesn't block others)
    const tpStartTime = Date.now();
    console.log(`🚀 Placing ${tpOrderPromises.length} TP orders in parallel...`);
    const tpResults = await Promise.allSettled(tpOrderPromises.map(tp => tp.promise));
    const tpElapsed = Date.now() - tpStartTime;
    console.log(`⏱️ All TP orders completed in ${tpElapsed}ms (parallel execution)`);
    latencyMarkers.tp_orders_end = Date.now();
    
    // Process results individually - failure of one doesn't block others
    tpResults.forEach((result, index) => {
      const tpOrder = tpOrderPromises[index];
      
      if (result.status === 'fulfilled') {
        const tpResult = result.value?.data;
        if (tpResult?.success && tpResult.data?.orderId) {
          const orderId = tpResult.data.orderId;
          
          if (tpOrder.label === 'TP1') tp1OrderId = orderId;
          else if (tpOrder.label === 'TP2') tp2OrderId = orderId;
          else if (tpOrder.label === 'TP3') tp3OrderId = orderId;
          
          console.log(`✅ ${tpOrder.label} order placed: ${orderId} at ${tpOrder.price}`);
          log({
            functionName: 'bitget-trader',
            message: `${tpOrder.label} order placed successfully`,
            level: 'info',
            alertId: alert_id,
            metadata: { orderId, price: tpOrder.price, quantity: tpOrder.quantity }
          });
        } else {
          console.error(`❌ Failed to place ${tpOrder.label} order:`, JSON.stringify(tpResult, null, 2));
          log({
            functionName: 'bitget-trader',
            message: `Failed to place ${tpOrder.label} order`,
            level: 'error',
            alertId: alert_id,
            metadata: { 
              response: tpResult,
              price: tpOrder.price,
              quantity: tpOrder.quantity
            }
          });
        }
      } else {
        console.error(`❌ ${tpOrder.label} order promise rejected:`, result.reason);
        log({
          functionName: 'bitget-trader',
          message: `${tpOrder.label} order promise rejected`,
          level: 'error',
          alertId: alert_id,
          metadata: { 
            error: result.reason,
            price: tpOrder.price,
            quantity: tpOrder.quantity
          }
        });
      }
    });

    // Save position to database
    await log({
      functionName: 'bitget-trader',
      message: 'Saving position to database',
      level: 'info',
      alertId: alert_id,
      metadata: { 
        symbol: alert_data.symbol,
        side: alert_data.side,
        quantity,
        leverage: effectiveLeverage
      }
    });
    
    // 🐛 DEBUG: Log exact quantities before INSERT
    console.log(`🐛 PRE-INSERT DEBUG - Quantities to save:`, {
      symbol: alert_data.symbol,
      total_quantity: quantity,
      tp1_quantity: tp1Quantity,
      tp2_quantity: tp2Quantity,
      tp3_quantity: tp3Quantity,
      sum_check: tp1Quantity + tp2Quantity + tp3Quantity,
      sum_matches: Math.abs((tp1Quantity + tp2Quantity + tp3Quantity) - quantity) < 0.0001
    });
    
    const { data: position, error: positionError } = await supabase
      .from('positions')
      .insert({
        user_id: user_id, // CRITICAL: Link position to user
        alert_id: alert_id,
        bitget_order_id: orderId,
        symbol: alert_data.symbol,
        side: alert_data.side,
        entry_price: alert_data.price,
        quantity: quantity,
        leverage: effectiveLeverage,
        sl_price: parseFloat(roundedSlPrice),
        sl_order_id: slOrderId,
        tp1_price: roundedTp1Price ? parseFloat(roundedTp1Price) : null,
        tp1_quantity: tp1Quantity,
        tp1_order_id: tp1OrderId,
        tp2_price: roundedTp2Price ? parseFloat(roundedTp2Price) : null,
        tp2_quantity: tp2Quantity,
        tp2_order_id: tp2OrderId,
        tp3_price: roundedTp3Price ? parseFloat(roundedTp3Price) : null,
        tp3_quantity: tp3Quantity,
        tp3_order_id: tp3OrderId,
        status: 'open',
        metadata: {
          settings_snapshot: settings,
          alert_data: alert_data,
          effective_leverage: effectiveLeverage,
          leverage_source: settings.use_alert_leverage !== false && alert_data.leverage ? 'alert' : 
                          ((settings.symbol_leverage_overrides || {})[alert_data.symbol] ? 'custom' : 'default'),
          original_quantity: quantity,  // Preserve original calculated quantity
          original_margin: (quantity * alert_data.price) / effectiveLeverage,  // Preserve original margin
        }
      })
      .select()
      .single();

    if (positionError) {
      await log({
        functionName: 'bitget-trader',
        message: 'Failed to save position to database',
        level: 'error',
        alertId: alert_id,
        metadata: { error: positionError.message }
      });
      throw positionError;
    }

    await log({
      functionName: 'bitget-trader',
      message: 'Position saved to database successfully',
      level: 'info',
      alertId: alert_id,
      positionId: position.id,
      metadata: { positionId: position.id, symbol: alert_data.symbol }
    });
    console.log('Position saved to database:', position.id);
    console.log('=== TRADE EXECUTION SUMMARY ===');
    console.log('Symbol:', alert_data.symbol);
    console.log('Side:', alert_data.side);
    console.log('Tier:', alert_data.tier);
    console.log('Strength:', alert_data.strength);
    console.log('Entry Price:', alert_data.price);
    console.log('Quantity:', quantity);
    console.log('Notional Value:', (quantity * alert_data.price).toFixed(2), 'USDT');
    console.log('Leverage:', effectiveLeverage + 'x', `(source: ${leverageSource})`);
    console.log('Margin Used:', ((quantity * alert_data.price) / effectiveLeverage).toFixed(2), 'USDT');
    console.log('SL Price:', roundedSlPrice);
    console.log('TP1 Price:', roundedTp1Price || 'N/A');
    if (roundedTp2Price) console.log('TP2 Price:', roundedTp2Price);
    if (roundedTp3Price) console.log('TP3 Price:', roundedTp3Price);
    console.log('Order ID:', orderId);
    console.log('SL Order ID:', slOrderId);
    console.log('TP1 Order ID:', tp1OrderId);
    console.log('============================');

    // Extract exchange execution timestamp from Bitget API response
    // orderResult contains the initial order response
    const exchangeTimestamp = orderResult?.data?.cTime 
      ? Number(orderResult.data.cTime) 
      : Date.now();

    // Calculate latencies
    const latencyExecution = Date.now() - (webhook_received_at || startTime); // Processing time
    const latencyTotal = tv_timestamp ? (exchangeTimestamp - tv_timestamp) : null; // End-to-end

    // Update alert status with latency tracking
    await supabase
      .from('alerts')
      .update({ 
        status: 'executed', 
        executed_at: new Date().toISOString(),
        position_id: position.id,
        exchange_executed_at: exchangeTimestamp,
        latency_execution_ms: latencyExecution,
        latency_ms: latencyTotal // Total: TV → Exchange
      })
      .eq('id', alert_id);
    
    // Calculate detailed latency breakdown
    latencyMarkers.end = Date.now();
    const latencyBreakdown = {
      total_execution: latencyExecution,
      request_parse: latencyMarkers.request_parsed ? latencyMarkers.request_parsed - latencyMarkers.start : 0,
      daily_loss_check: latencyMarkers.daily_loss_check_start && latencyMarkers.account_balance_start ? latencyMarkers.account_balance_start - latencyMarkers.daily_loss_check_start : 0,
      account_balance: latencyMarkers.account_balance_end && latencyMarkers.account_balance_start ? latencyMarkers.account_balance_end - latencyMarkers.account_balance_start : 0,
      leverage_check: latencyMarkers.leverage_check_end && latencyMarkers.leverage_check_start ? latencyMarkers.leverage_check_end - latencyMarkers.leverage_check_start : 0,
      minimums_check: latencyMarkers.minimums_check_end && latencyMarkers.minimums_check_start ? latencyMarkers.minimums_check_end - latencyMarkers.minimums_check_start : 0,
      order_placement: latencyMarkers.order_placed && latencyMarkers.minimums_check_end ? latencyMarkers.order_placed - latencyMarkers.minimums_check_end : 0,
      precision_check: latencyMarkers.precision_check_end && latencyMarkers.precision_check_start ? latencyMarkers.precision_check_end - latencyMarkers.precision_check_start : 0,
      tp_orders: latencyMarkers.tp_orders_end && latencyMarkers.tp_orders_start ? latencyMarkers.tp_orders_end - latencyMarkers.tp_orders_start : 0
    };

    await log({
      functionName: 'bitget-trader',
      message: 'Trade execution completed successfully',
      level: 'info',
      alertId: alert_id,
      positionId: position.id,
      metadata: { 
        positionId: position.id,
        latency_execution_ms: latencyExecution,
        latency_total_ms: latencyTotal,
        latency_breakdown: latencyBreakdown,
        orderId,
        symbol: alert_data.symbol,
        side: alert_data.side,
        quantity,
        leverage: effectiveLeverage,
        entryPrice: alert_data.price
      }
    });
    
    // Log detailed breakdown to console
    console.log('\n📊 LATENCY BREAKDOWN:');
    console.log(`   Total execution: ${latencyExecution}ms`);
    console.log(`   - Request parse: ${latencyBreakdown.request_parse}ms`);
    console.log(`   - Daily loss check: ${latencyBreakdown.daily_loss_check}ms`);
    console.log(`   - Account balance: ${latencyBreakdown.account_balance}ms`);
    console.log(`   - Leverage check: ${latencyBreakdown.leverage_check}ms`);
    console.log(`   - Minimums check: ${latencyBreakdown.minimums_check}ms`);
    console.log(`   - Order placement: ${latencyBreakdown.order_placement}ms`);
    console.log(`   - Precision check: ${latencyBreakdown.precision_check}ms`);
    console.log(`   - TP orders (parallel): ${latencyBreakdown.tp_orders}ms`);
    
    console.log('Position opened successfully:', position.id);

    return new Response(JSON.stringify({ 
      success: true, 
      position_id: position.id,
      order_id: orderId 
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await log({
      functionName: 'bitget-trader',
      message: 'Trade execution failed',
      level: 'error',
      metadata: { error: errorMessage, stack: error instanceof Error ? error.stack : undefined }
    });
    console.error('Trader error:', error);
    return new Response(JSON.stringify({ error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
