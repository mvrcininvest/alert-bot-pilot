import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { calculatePositionSize, calculateSLTP } from "./calculators.ts";
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

  const startTime = Date.now();

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { alert_id, alert_data, user_id } = await req.json();
    
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
    
    // Load user settings with copy_admin logic
    const settings = await getUserSettings(user_id);
    
    const apiCredentials = {
      apiKey: userKeys.apiKey,
      secretKey: userKeys.secretKey,
      passphrase: userKeys.passphrase
    };
    
    // Remove .P suffix from TradingView symbol format (XRPUSDT.P -> XRPUSDT)
    if (alert_data.symbol && alert_data.symbol.endsWith('.P')) {
      alert_data.symbol = alert_data.symbol.slice(0, -2);
    }
    
    // Check if symbol is banned
    const { data: bannedSymbol } = await supabase
      .from('banned_symbols')
      .select('*')
      .eq('symbol', alert_data.symbol)
      .maybeSingle();
    
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
    
    console.log('=== BITGET TRADER STARTED ===');
    console.log('Alert ID:', alert_id);
    console.log('Alert symbol:', alert_data.symbol);
    console.log('Alert side:', alert_data.side);
    console.log('Alert tier:', alert_data.tier);
    console.log('Alert strength:', alert_data.strength);
    console.log('Alert entry price:', alert_data.price);
    console.log('Alert leverage:', alert_data.leverage);

    // Check if we've reached max open positions FOR THIS USER
    const { data: openPositions, error: countError } = await supabase
      .from('positions')
      .select('id', { count: 'exact' })
      .eq('user_id', user_id)
      .eq('status', 'open');

    if (countError) throw countError;

    if (openPositions && openPositions.length >= settings.max_open_positions) {
      await log({
        functionName: 'bitget-trader',
        message: 'Max open positions reached - alert ignored',
        level: 'warn',
        alertId: alert_id,
        metadata: { 
          currentPositions: openPositions.length,
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
      message: 'Position limit check passed',
      level: 'info',
      alertId: alert_id,
      metadata: { 
        currentPositions: openPositions?.length || 0,
        maxPositions: settings.max_open_positions
      }
    });

    // Check if duplicate alert handling is enabled and if there's an existing position FOR THIS USER
    if (settings.duplicate_alert_handling !== false) {
      const symbol = alert_data.symbol;
      const { data: existingPosition } = await supabase
        .from('positions')
        .select('*, alerts!positions_alert_id_fkey(strength)')
        .eq('user_id', user_id)
        .eq('symbol', symbol)
        .eq('status', 'open')
        .maybeSingle();

      if (existingPosition) {
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
        const holdSide = existingPosition.side === 'BUY' ? 'long' : 'short';
        try {
          await supabase.functions.invoke('bitget-api', {
            body: {
              action: 'close_position',
              apiCredentials,
              params: {
                symbol: existingPosition.symbol,
                holdSide
              }
            }
          });
        } catch (error) {
          console.error('Failed to close position on exchange:', error);
          throw new Error('Failed to close existing position on exchange');
        }
        
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
    }

    // Check daily loss limit FOR THIS USER
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

    // Check loss limit based on type
    if (settings.loss_limit_type === 'percent_drawdown') {
      // Get account balance using user's API credentials
      const { data: accountData } = await supabase.functions.invoke('bitget-api', {
        body: { action: 'get_account', apiCredentials }
      });
      
      const accountBalance = accountData?.success && accountData.data?.[0]?.available 
        ? Number(accountData.data[0].available)
        : 10000; // fallback
      
      const maxLossAmount = accountBalance * ((settings.daily_loss_percent || 5) / 100);
      
      if (Math.abs(todayPnL) >= maxLossAmount) {
        await log({
          functionName: 'bitget-trader',
          message: 'Daily drawdown limit reached - alert ignored',
          level: 'warn',
          alertId: alert_id,
          metadata: { 
            todayPnL: Math.abs(todayPnL),
            maxLossAmount,
            dailyLossPercent: settings.daily_loss_percent,
            accountBalance
          }
        });
        console.log(`Daily drawdown limit reached: ${Math.abs(todayPnL).toFixed(2)} USDT (${settings.daily_loss_percent}% of ${accountBalance.toFixed(2)} USDT)`);
        await supabase
          .from('alerts')
          .update({ 
            status: 'ignored', 
            error_message: `Daily loss limit reached: ${Math.abs(todayPnL).toFixed(2)} USDT (${settings.daily_loss_percent}% of capital)` 
          })
          .eq('id', alert_id);
        
        return new Response(JSON.stringify({ 
          success: false, 
          message: `Daily loss limit reached: ${Math.abs(todayPnL).toFixed(2)} USDT (${settings.daily_loss_percent}% of ${accountBalance.toFixed(2)} USDT)` 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    } else {
      // Fixed USDT limit
      if (Math.abs(todayPnL) >= (settings.daily_loss_limit || 500)) {
        await log({
          functionName: 'bitget-trader',
          message: 'Daily loss limit reached - alert ignored',
          level: 'warn',
          alertId: alert_id,
          metadata: { 
            todayPnL: Math.abs(todayPnL),
            dailyLossLimit: settings.daily_loss_limit
          }
        });
        console.log(`Daily loss limit reached: ${Math.abs(todayPnL).toFixed(2)} / ${settings.daily_loss_limit} USDT`);
        await supabase
          .from('alerts')
          .update({ 
            status: 'ignored', 
            error_message: `Daily loss limit reached: ${Math.abs(todayPnL).toFixed(2)} USDT` 
          })
          .eq('id', alert_id);
        
        return new Response(JSON.stringify({ 
          success: false, 
          message: `Daily loss limit reached: ${Math.abs(todayPnL).toFixed(2)} / ${settings.daily_loss_limit} USDT` 
        }), {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Get account balance from Bitget
    await log({
      functionName: 'bitget-trader',
      message: 'Fetching account balance from Bitget',
      level: 'info',
      alertId: alert_id
    });
    console.log('Fetching account balance from Bitget API...');
    const { data: accountData } = await supabase.functions.invoke('bitget-api', {
      body: { action: 'get_account', apiCredentials }
    });
    
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
      // Use leverage from alert
      effectiveLeverage = alert_data.leverage;
      leverageSource = 'alert';
      console.log(`Using leverage from alert: ${effectiveLeverage}x`);
    } else {
      // Use leverage from settings
      const symbolLeverageOverrides = settings.symbol_leverage_overrides || {};
      const defaultLeverage = settings.default_leverage || 10;
      
      // Check if symbol has override set to "MAX"
      if (symbolLeverageOverrides[alert_data.symbol] === "MAX") {
        console.log(`Symbol ${alert_data.symbol} configured for MAX leverage, fetching from API...`);
        
        try {
          const { data: symbolInfoResult } = await supabase.functions.invoke('bitget-api', {
            body: {
              action: 'get_symbol_info',
              apiCredentials,
              params: { symbol: alert_data.symbol }
            }
          });
          
          if (symbolInfoResult?.success && symbolInfoResult.data?.[0]?.maxLever) {
            effectiveLeverage = parseInt(symbolInfoResult.data[0].maxLever);
            leverageSource = 'symbol_override_max';
            console.log(`✓ Using MAX leverage for ${alert_data.symbol}: ${effectiveLeverage}x`);
            
            await log({
              functionName: 'bitget-trader',
              message: `Fetched MAX leverage from API: ${effectiveLeverage}x`,
              level: 'info',
              alertId: alert_id,
              metadata: { symbol: alert_data.symbol, maxLever: effectiveLeverage }
            });
          } else {
            // Fallback to default if API fails
            effectiveLeverage = defaultLeverage;
            leverageSource = 'default_fallback';
            console.warn(`⚠ Could not get MAX leverage for ${alert_data.symbol}, using default: ${effectiveLeverage}x`);
            
            await log({
              functionName: 'bitget-trader',
              message: `Failed to fetch MAX leverage, using default: ${effectiveLeverage}x`,
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
          console.error(`✗ Error fetching MAX leverage for ${alert_data.symbol}:`, error);
          
          await log({
            functionName: 'bitget-trader',
            message: `Error fetching MAX leverage: ${errorMessage}`,
            level: 'error',
            alertId: alert_id,
            metadata: { symbol: alert_data.symbol, error: errorMessage }
          });
        }
      } else if (symbolLeverageOverrides[alert_data.symbol]) {
        // Use custom numeric leverage override
        effectiveLeverage = symbolLeverageOverrides[alert_data.symbol];
        leverageSource = 'symbol_override';
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
    
    await log({
      functionName: 'bitget-trader',
      message: 'Setting leverage on Bitget',
      level: 'info',
      alertId: alert_id,
      metadata: { symbol: alert_data.symbol, leverage: effectiveLeverage }
    });
    console.log(`Setting leverage on Bitget: ${effectiveLeverage}x for ${alert_data.symbol}`);
    // Set leverage on Bitget before placing order using user's API credentials
    await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'set_leverage',
        apiCredentials,
        params: {
          symbol: alert_data.symbol,
          leverage: effectiveLeverage,
        }
      }
    });

    // Calculate position size (pass effective leverage for correct margin calculation)
    let quantity = calculatePositionSize(settings, alert_data, accountBalance, effectiveLeverage);
    await log({
      functionName: 'bitget-trader',
      message: 'Position size calculated',
      level: 'info',
      alertId: alert_id,
      metadata: { initialQuantity: quantity, symbol: alert_data.symbol }
    });
    console.log('Initial calculated quantity:', quantity);
    
    // Get REAL minimum requirements from Bitget API before placing order
    console.log(`🔍 Fetching minimum requirements for ${alert_data.symbol} from Bitget API...`);
    const { data: symbolInfoResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_symbol_info',
        apiCredentials,
        params: {
          symbol: alert_data.symbol
        }
      }
    });
    
    let minQuantity = 0.001; // Default fallback
    let minNotionalValue = 5; // Default fallback
    let volumePlace = 4; // Default precision (4 decimal places)
    
    if (symbolInfoResult?.success && symbolInfoResult.data?.length > 0) {
      const contractInfo = symbolInfoResult.data[0];
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
    const { sl_price, tp1_price, tp2_price, tp3_price } = calculateSLTP(
      alert_data,
      settings,
      quantity,
      effectiveLeverage  // CRITICAL FIX: Pass effective leverage for correct SL calculation
    );
    console.log('✓ Calculated prices:', { 
      entry: alert_data.price,
      sl_price, 
      tp1_price, 
      tp2_price, 
      tp3_price,
      quantity 
    });

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

    // Get symbol info to determine price precision
    const { data: priceInfoResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'get_symbol_info',
        apiCredentials,
        params: { symbol: alert_data.symbol }
      }
    });
    
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
    
    const roundedSlPrice = roundToPlaces(sl_price, pricePlace);
    const roundedTp1Price = tp1_price ? roundToPlaces(tp1_price, pricePlace) : null;
    const roundedTp2Price = tp2_price ? roundToPlaces(tp2_price, pricePlace) : null;
    const roundedTp3Price = tp3_price ? roundToPlaces(tp3_price, pricePlace) : null;
    
    console.log(`Prices rounded to ${pricePlace} decimals:`);
    console.log(`SL: ${sl_price} -> ${roundedSlPrice}`);
    if (roundedTp1Price) console.log(`TP1: ${tp1_price} -> ${roundedTp1Price}`);
    if (roundedTp2Price) console.log(`TP2: ${tp2_price} -> ${roundedTp2Price}`);
    if (roundedTp3Price) console.log(`TP3: ${tp3_price} -> ${roundedTp3Price}`);

    // Place Stop Loss order using TPSL endpoint
    await log({
      functionName: 'bitget-trader',
      message: 'Placing Stop Loss order',
      level: 'info',
      alertId: alert_id,
      metadata: { slPrice: roundedSlPrice, symbol: alert_data.symbol }
    });
    const holdSide = alert_data.side === 'BUY' ? 'long' : 'short';
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
          executePrice: 0, // Market order
        }
      }
    });

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
        
        if (tp1Qty >= minQuantity && tp2Qty >= minQuantity) {
          return 2;
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
      
      // Round DOWN each quantity to volumePlace precision
      let rounded = {
        tp1: Math.floor(quantities.tp1 * precision) / precision,
        tp2: Math.floor(quantities.tp2 * precision) / precision,
        tp3: Math.floor(quantities.tp3 * precision) / precision
      };
      
      // Calculate remainder (what was lost in rounding)
      const sumRounded = rounded.tp1 + rounded.tp2 + rounded.tp3;
      const remainder = Math.round((totalQuantity - sumRounded) * precision) / precision;
      
      // Add remainder to the largest active TP to maintain exact total
      if (remainder > 0) {
        if (rounded.tp1 >= rounded.tp2 && rounded.tp1 >= rounded.tp3) {
          rounded.tp1 = Math.round((rounded.tp1 + remainder) * precision) / precision;
        } else if (rounded.tp2 >= rounded.tp3) {
          rounded.tp2 = Math.round((rounded.tp2 + remainder) * precision) / precision;
        } else {
          rounded.tp3 = Math.round((rounded.tp3 + remainder) * precision) / precision;
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
        tp1Percent = originalPercentages.tp1 + redistributed;
        tp2Percent = originalPercentages.tp2 + redistributed;
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
          console.log(`✅ Using 2 TP as configured`);
          console.log(`   TP1: ${tp1Percent}%, TP2: ${tp2Percent}%`);
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

    // Place TP orders
    let tp1OrderId, tp2OrderId, tp3OrderId;

    if (effectiveTp1Price && tp1Quantity > 0) {
      const { data: tp1Result } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'place_tpsl_order',
          apiCredentials,
          params: {
            symbol: alert_data.symbol,
            planType: 'pos_profit',
            triggerPrice: effectiveTp1Price,
            triggerType: 'mark_price',
            holdSide: holdSide,
            executePrice: 0,
            size: tp1Quantity.toString(),
          }
        }
      });
      tp1OrderId = tp1Result?.success ? tp1Result.data.orderId : null;
      if (!tp1OrderId) {
        console.error('Failed to place TP1 order:', tp1Result);
      }
    }

    if (effectiveTp2Price && tp2Quantity > 0) {
      const { data: tp2Result } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'place_tpsl_order',
          apiCredentials,
          params: {
            symbol: alert_data.symbol,
            planType: 'pos_profit',
            triggerPrice: effectiveTp2Price,
            triggerType: 'mark_price',
            holdSide: holdSide,
            executePrice: 0,
            size: tp2Quantity.toString(),
          }
        }
      });
      tp2OrderId = tp2Result?.success ? tp2Result.data.orderId : null;
      if (!tp2OrderId) {
        console.error('Failed to place TP2 order:', tp2Result);
      }
    }

    if (effectiveTp3Price && tp3Quantity > 0) {
      const { data: tp3Result } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'place_tpsl_order',
          apiCredentials,
          params: {
            symbol: alert_data.symbol,
            planType: 'pos_profit',
            triggerPrice: effectiveTp3Price,
            triggerType: 'mark_price',
            holdSide: holdSide,
            executePrice: 0,
            size: tp3Quantity.toString(),
          }
        }
      });
      tp3OrderId = tp3Result?.success ? tp3Result.data.orderId : null;
      if (!tp3OrderId) {
        console.error('Failed to place TP3 order:', tp3Result);
      }
    }

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
                          ((settings.symbol_leverage_overrides || {})[alert_data.symbol] ? 'custom' : 'default')
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

    // Update alert status with latency
    const latencyMs = Date.now() - startTime;
    await supabase
      .from('alerts')
      .update({ 
        status: 'executed', 
        executed_at: new Date().toISOString(),
        position_id: position.id,
        latency_ms: latencyMs
      })
      .eq('id', alert_id);

    await log({
      functionName: 'bitget-trader',
      message: 'Trade execution completed successfully',
      level: 'info',
      alertId: alert_id,
      positionId: position.id,
      metadata: { 
        positionId: position.id,
        latencyMs,
        orderId,
        symbol: alert_data.symbol,
        side: alert_data.side,
        quantity,
        leverage: effectiveLeverage,
        entryPrice: alert_data.price
      }
    });
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
