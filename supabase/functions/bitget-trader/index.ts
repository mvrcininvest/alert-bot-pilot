import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { calculatePositionSize, calculateSLTP } from "./calculators.ts";
import { adjustPositionSizeToMinimum, getMinimumPositionSize } from "./minimums.ts";
import { log } from "../_shared/logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  const startTime = Date.now(); // Track execution start time

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { alert_id, alert_data, settings } = await req.json();
    
    // Remove .P suffix from TradingView symbol format (XRPUSDT.P -> XRPUSDT)
    if (alert_data.symbol && alert_data.symbol.endsWith('.P')) {
      alert_data.symbol = alert_data.symbol.slice(0, -2);
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

    // Check if we've reached max open positions
    const { data: openPositions, error: countError } = await supabase
      .from('positions')
      .select('id', { count: 'exact' })
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

    // Check daily loss limit
    const today = new Date().toISOString().split('T')[0];
    const { data: todayPositions } = await supabase
      .from('positions')
      .select('realized_pnl')
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
      // Get account balance
      const { data: accountData } = await supabase.functions.invoke('bitget-api', {
        body: { action: 'get_account' }
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
      body: { action: 'get_account' }
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
      
      if (symbolLeverageOverrides[alert_data.symbol]) {
        effectiveLeverage = symbolLeverageOverrides[alert_data.symbol];
        leverageSource = 'symbol_override';
      } else {
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
    // Set leverage on Bitget before placing order
    await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'set_leverage',
        params: {
          symbol: alert_data.symbol,
          leverage: effectiveLeverage,
        }
      }
    });

    // Calculate position size
    let quantity = calculatePositionSize(settings, alert_data, accountBalance);
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
        params: {
          symbol: alert_data.symbol
        }
      }
    });
    
    let minQuantity = 0.001; // Default fallback
    let minNotionalValue = 5; // Default fallback
    
    if (symbolInfoResult?.success && symbolInfoResult.data?.length > 0) {
      const contractInfo = symbolInfoResult.data[0];
      minQuantity = parseFloat(contractInfo.minTradeNum || '0.001');
      minNotionalValue = parseFloat(contractInfo.minTradeUSDT || '5');
      
      await log({
        functionName: 'bitget-trader',
        message: `Retrieved real minimums from Bitget API for ${alert_data.symbol}`,
        level: 'info',
        alertId: alert_id,
        metadata: {
          symbol: alert_data.symbol,
          minTradeNum: minQuantity,
          minTradeUSDT: minNotionalValue
        }
      });
      
      console.log(`✅ ${alert_data.symbol} minimums from Bitget API:`, {
        minTradeNum: minQuantity,
        minTradeUSDT: minNotionalValue
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
    
    // Calculate notional value of our position
    const notionalValue = quantity * alert_data.price;
    
    // Check BOTH quantity and notional minimums and use whichever is HIGHER
    if (quantity < minQuantity || notionalValue < minNotionalValue) {
      const quantityFromMinNotional = minNotionalValue / alert_data.price;
      const adjustedQuantity = Math.max(minQuantity, quantityFromMinNotional);
      const adjustedNotional = adjustedQuantity * alert_data.price;
      const adjustedMargin = adjustedNotional / effectiveLeverage;
      
      await log({
        functionName: 'bitget-trader',
        message: 'Position size adjusted to meet Bitget minimums',
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
          minNotional: minNotionalValue
        }
      });
      
      console.log(`⚠️ Position size too small! Adjusting to meet Bitget requirements:`);
      console.log(`   Original: quantity=${quantity}, notional=${notionalValue.toFixed(2)} USDT, margin=${(notionalValue/effectiveLeverage).toFixed(2)} USDT`);
      console.log(`   Minimums: quantity=${minQuantity}, notional=${minNotionalValue} USDT`);
      console.log(`   Adjusted: quantity=${adjustedQuantity}, notional=${adjustedNotional.toFixed(2)} USDT, margin=${adjustedMargin.toFixed(2)} USDT`);
      
      quantity = adjustedQuantity;
    } else {
      console.log(`✅ Position size meets Bitget requirements: quantity=${quantity}, notional=${notionalValue.toFixed(2)} USDT, margin=${(notionalValue/effectiveLeverage).toFixed(2)} USDT`);
    }

    // Calculate SL/TP prices
    console.log('Calculating SL/TP prices...');
    const { sl_price, tp1_price, tp2_price, tp3_price } = calculateSLTP(
      alert_data,
      settings,
      quantity
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
        
        // Retry with minimum quantity
        const { data } = await supabase.functions.invoke('bitget-api', {
          body: {
            action: 'place_order',
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

    // Place Stop Loss order using TPSL endpoint
    await log({
      functionName: 'bitget-trader',
      message: 'Placing Stop Loss order',
      level: 'info',
      alertId: alert_id,
      metadata: { slPrice: sl_price, symbol: alert_data.symbol }
    });
    const holdSide = alert_data.side === 'BUY' ? 'long' : 'short';
    const { data: slResult } = await supabase.functions.invoke('bitget-api', {
      body: {
        action: 'place_tpsl_order',
        params: {
          symbol: alert_data.symbol,
          planType: 'pos_loss',
          triggerPrice: sl_price.toString(),
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

    // Calculate quantities for partial TP closing
    const tp1Quantity = tp1_price && settings.tp_strategy === 'partial_close' 
      ? quantity * (settings.tp1_close_percent / 100) 
      : quantity;
    const tp2Quantity = tp2_price && settings.tp_strategy === 'partial_close'
      ? quantity * (settings.tp2_close_percent / 100)
      : 0;
    const tp3Quantity = tp3_price && settings.tp_strategy === 'partial_close'
      ? quantity * (settings.tp3_close_percent / 100)
      : 0;

    // Place TP orders
    let tp1OrderId, tp2OrderId, tp3OrderId;

    if (tp1_price && tp1Quantity > 0) {
      const { data: tp1Result } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'place_tpsl_order',
          params: {
            symbol: alert_data.symbol,
            planType: 'pos_profit',
            triggerPrice: tp1_price.toString(),
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

    if (tp2_price && tp2Quantity > 0) {
      const { data: tp2Result } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'place_tpsl_order',
          params: {
            symbol: alert_data.symbol,
            planType: 'pos_profit',
            triggerPrice: tp2_price.toString(),
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

    if (tp3_price && tp3Quantity > 0) {
      const { data: tp3Result } = await supabase.functions.invoke('bitget-api', {
        body: {
          action: 'place_tpsl_order',
          params: {
            symbol: alert_data.symbol,
            planType: 'pos_profit',
            triggerPrice: tp3_price.toString(),
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
        alert_id: alert_id,
        bitget_order_id: orderId,
        symbol: alert_data.symbol,
        side: alert_data.side,
        entry_price: alert_data.price,
        quantity: quantity,
        leverage: effectiveLeverage, // Use custom or default leverage
        sl_price: sl_price,
        sl_order_id: slOrderId,
        tp1_price: tp1_price,
        tp1_quantity: tp1Quantity,
        tp1_order_id: tp1OrderId,
        tp2_price: tp2_price,
        tp2_quantity: tp2Quantity,
        tp2_order_id: tp2OrderId,
        tp3_price: tp3_price,
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
    console.log('SL Price:', sl_price);
    console.log('TP1 Price:', tp1_price);
    if (tp2_price) console.log('TP2 Price:', tp2_price);
    if (tp3_price) console.log('TP3 Price:', tp3_price);
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
