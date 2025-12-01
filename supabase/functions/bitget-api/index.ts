import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";
import { log } from "../_shared/logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BitgetConfig {
  apiKey: string;
  secretKey: string;
  passphrase: string;
  baseUrl: string;
}

function getTimestamp(): string {
  return Date.now().toString();
}

function sign(message: string, secretKey: string): string {
  const hmac = createHmac('sha256', secretKey);
  hmac.update(message);
  return hmac.digest('base64');
}

function getBitgetHeaders(config: BitgetConfig, method: string, requestPath: string, body: string = ''): Record<string, string> {
  const timestamp = getTimestamp();
  const sign_string = timestamp + method + requestPath + body;
  const signature = sign(sign_string, config.secretKey);

  return {
    'ACCESS-KEY': config.apiKey,
    'ACCESS-SIGN': signature,
    'ACCESS-TIMESTAMP': timestamp,
    'ACCESS-PASSPHRASE': config.passphrase,
    'Content-Type': 'application/json',
  };
}

async function bitgetRequest(config: BitgetConfig, method: string, endpoint: string, body?: any): Promise<any> {
  const requestPath = endpoint;
  const bodyStr = body ? JSON.stringify(body) : '';
  const headers = getBitgetHeaders(config, method, requestPath, bodyStr);

  await log({
    functionName: 'bitget-api',
    message: `Bitget API request: ${method} ${requestPath}`,
    level: 'info',
    metadata: { method, endpoint, hasBody: !!body }
  });
  console.log('Bitget request:', method, requestPath, bodyStr ? `Body: ${bodyStr}` : '');

  const response = await fetch(`${config.baseUrl}${requestPath}`, {
    method,
    headers,
    body: bodyStr || undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    await log({
      functionName: 'bitget-api',
      message: 'Bitget HTTP error',
      level: 'error',
      metadata: { status: response.status, error: errorText, endpoint }
    });
    console.error('Bitget HTTP error:', response.status, errorText);
    throw new Error(`Bitget HTTP error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  console.log('Bitget response:', JSON.stringify(data));
  
  if (data.code !== '00000') {
    await log({
      functionName: 'bitget-api',
      message: 'Bitget API error',
      level: 'error',
      metadata: { code: data.code, msg: data.msg, endpoint }
    });
    console.error('Bitget API error:', data);
    throw new Error(`Bitget API error (${data.code}): ${data.msg || 'Unknown error'}`);
  }

  await log({
    functionName: 'bitget-api',
    message: `Bitget API success: ${method} ${requestPath}`,
    level: 'info',
    metadata: { endpoint }
  });

  return data.data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { action, params, apiCredentials } = await req.json();
    
    // Use provided API credentials or fall back to env vars (for backward compatibility)
    const config: BitgetConfig = {
      apiKey: apiCredentials?.apiKey || Deno.env.get('BITGET_API_KEY') || '',
      secretKey: apiCredentials?.secretKey || Deno.env.get('BITGET_SECRET_KEY') || '',
      passphrase: apiCredentials?.passphrase || Deno.env.get('BITGET_PASSPHRASE') || '',
      baseUrl: 'https://api.bitget.com',
    };
    
    // Validate credentials
    if (!config.apiKey || !config.secretKey || !config.passphrase) {
      throw new Error('Missing API credentials');
    }
    await log({
      functionName: 'bitget-api',
      message: `Processing action: ${action}`,
      level: 'info',
      metadata: { action, params }
    });
    console.log('Bitget API action:', action);

    let result;

    switch (action) {
      case 'batch_actions':
        // Execute multiple actions in sequence and return all results
        // This reduces edge function invocation overhead
        console.log(`📦 batch_actions: ${params.actions?.length || 0} actions`);
        const batchResults: Record<string, any> = {};
        
        if (!params.actions || !Array.isArray(params.actions)) {
          throw new Error('batch_actions requires an array of actions');
        }
        
        for (const batchAction of params.actions) {
          const { id, type, params: actionParams } = batchAction;
          
          try {
            console.log(`  ➡️ Executing batch action ${id}: ${type}`);
            
            // Execute each action based on type
            switch (type) {
              case 'get_account':
                batchResults[id] = await bitgetRequest(config, 'GET', `/api/v2/mix/account/accounts?productType=USDT-FUTURES`);
                break;
                
              case 'get_symbol_info':
                batchResults[id] = await bitgetRequest(config, 'GET', `/api/v2/mix/market/contracts?productType=USDT-FUTURES&symbol=${actionParams.symbol}`);
                break;
                
              case 'set_leverage':
                batchResults[id] = await bitgetRequest(config, 'POST', '/api/v2/mix/account/set-leverage', {
                  symbol: actionParams.symbol,
                  productType: 'USDT-FUTURES',
                  marginCoin: 'USDT',
                  leverage: actionParams.leverage.toString(),
                  holdSide: actionParams.holdSide || 'long',
                });
                break;
                
              case 'get_ticker':
                batchResults[id] = await bitgetRequest(config, 'GET', `/api/v2/mix/market/ticker?symbol=${actionParams.symbol}&productType=USDT-FUTURES`);
                break;
                
              default:
                batchResults[id] = { error: `Unknown batch action type: ${type}` };
            }
            
            console.log(`  ✅ Batch action ${id} completed`);
          } catch (error: unknown) {
            const errorMessage = error instanceof Error ? error.message : 'Unknown error';
            console.error(`  ❌ Batch action ${id} failed:`, error);
            batchResults[id] = { error: errorMessage };
          }
        }
        
        result = batchResults;
        console.log(`📦 batch_actions completed: ${Object.keys(batchResults).length} results`);
        break;

      case 'get_account':
        // Get account info - v2 API
        result = await bitgetRequest(config, 'GET', `/api/v2/mix/account/accounts?productType=USDT-FUTURES`);
        break;

      case 'get_positions':
        // Get all open positions - v2 API
        result = await bitgetRequest(config, 'GET', `/api/v2/mix/position/all-position?productType=USDT-FUTURES&marginCoin=USDT`);
        break;

      case 'get_position':
        // Get specific position - v2 API
        result = await bitgetRequest(config, 'GET', 
          `/api/v2/mix/position/single-position?symbol=${params.symbol}&productType=USDT-FUTURES&marginCoin=USDT`);
        break;
      
      case 'get_history_positions':
        // Get closed positions fill history - v2 API
        const historyParams = new URLSearchParams({
          productType: 'USDT-FUTURES',
        });
        if (params.symbol) historyParams.append('symbol', params.symbol);
        if (params.startTime) historyParams.append('startTime', params.startTime);
        if (params.endTime) historyParams.append('endTime', params.endTime);
        if (params.limit) historyParams.append('limit', params.limit);
        
        result = await bitgetRequest(config, 'GET', `/api/v2/mix/order/fill-history?${historyParams.toString()}`);
        break;

      case 'get_fills':
        // Get recent fills for position - used to calculate actual PnL
        const fillParams = new URLSearchParams({
          productType: 'USDT-FUTURES',
        });
        if (params.symbol) fillParams.append('symbol', params.symbol);
        if (params.startTime) fillParams.append('startTime', params.startTime);
        if (params.endTime) fillParams.append('endTime', params.endTime);
        if (params.limit) fillParams.append('limit', params.limit || '50');
        
        result = await bitgetRequest(config, 'GET', `/api/v2/mix/order/fill-history?${fillParams.toString()}`);
        break;

      case 'get_position_history':
        // Get actual closed position history with real PnL data - v2 API
        // Uses cursor-based pagination with idLessThan + limit
        const posHistoryParams = new URLSearchParams({
          productType: 'USDT-FUTURES',
          limit: params.limit || '100'  // Changed from pageSize to limit
        });
        if (params.symbol) posHistoryParams.append('symbol', params.symbol);
        if (params.startTime) posHistoryParams.append('startTime', params.startTime);
        if (params.endTime) posHistoryParams.append('endTime', params.endTime);
        if (params.idLessThan) posHistoryParams.append('idLessThan', params.idLessThan);  // Cursor for pagination
        
        result = await bitgetRequest(config, 'GET', `/api/v2/mix/position/history-position?${posHistoryParams.toString()}`);
        
        // Log response structure for debugging
        console.log(`[get_position_history] Response structure: list=${result?.data?.list?.length || 0}, cursor=${result?.data?.cursor}, endId=${result?.data?.endId}`);
        break;

      case 'place_order':
        // Place order (market or limit) - v2 API
        // Map internal side format to Bitget API format
        const sideParam = params.side.toLowerCase();
        const isLong = sideParam.includes('long');
        const isOpen = sideParam.includes('open');
        
        // Bitget v2 API: side is "buy" or "sell", tradeSide is "open" or "close"
        // open_long: buy + open, open_short: sell + open
        // close_long: sell + close, close_short: buy + close
        const bitgetSide = (isOpen && isLong) || (!isOpen && !isLong) ? 'buy' : 'sell';
        const tradeSide = isOpen ? 'open' : 'close';
        const posSide = isLong ? 'long' : 'short';
        
        // Support both market and limit orders
        const orderType = params.orderType || 'market';
        const orderBody: any = {
          symbol: params.symbol,
          productType: 'USDT-FUTURES',
          marginMode: 'crossed',
          marginCoin: 'USDT',
          size: params.size.toString(),
          side: bitgetSide,
          tradeSide: tradeSide,
          posSide: posSide,
          orderType: orderType,
          force: orderType === 'limit' ? 'gtc' : 'ioc',
        };
        
        // Add price for limit orders
        if (orderType === 'limit' && params.price) {
          orderBody.price = params.price.toString();
        } else {
          orderBody.price = '';
        }
        
        // Add reduceOnly flag for closing positions
        if (params.reduceOnly === 'YES' || params.reduceOnly === true) {
          orderBody.reduceOnly = 'YES';
        }
        
        result = await bitgetRequest(config, 'POST', '/api/v2/mix/order/place-order', orderBody);
        break;

      case 'place_plan_order':
        // Place stop loss or take profit order - v2 API
        const planSideParam = params.side.toLowerCase();
        const planIsLong = planSideParam.includes('long');
        const planIsOpen = planSideParam.includes('open');
        
        // Map side correctly for plan orders (tradeSide: "open" or "close")
        const planBitgetSide = (planIsOpen && planIsLong) || (!planIsOpen && !planIsLong) ? 'buy' : 'sell';
        const planTradeSide = planIsOpen ? 'open' : 'close';
        const planPosSide = planIsLong ? 'long' : 'short';
        
        const planOrderBody: any = {
          symbol: params.symbol,
          productType: 'USDT-FUTURES',
          marginMode: 'crossed',
          marginCoin: 'USDT',
          size: params.size.toString(),
          side: planBitgetSide,
          tradeSide: planTradeSide,
          posSide: planPosSide,
          triggerPrice: params.triggerPrice.toString(),
          triggerType: params.triggerType || 'mark_price',
          orderType: params.orderType || 'market',
        };

        // Add executePrice only for limit orders
        if (params.orderType === 'limit') {
          planOrderBody.executePrice = (params.executePrice || params.triggerPrice).toString();
        }

        // Determine plan type based on parameters
        // Bitget v2 API uses: pos_loss (SL), pos_profit (TP), normal_plan (trigger)
        if (params.planType === 'loss_plan' || params.planType === 'pos_loss') {
          planOrderBody.planType = 'pos_loss';
        } else if (params.planType === 'profit_plan' || params.planType === 'pos_profit') {
          planOrderBody.planType = 'pos_profit';
        } else {
          planOrderBody.planType = 'normal_plan';
        }

        result = await bitgetRequest(config, 'POST', '/api/v2/mix/order/place-plan-order', planOrderBody);
        break;

      case 'place_tpsl_order':
        // Place SL/TP for existing position - v2 API
        // This is the CORRECT endpoint for setting SL/TP on positions in hedge mode
        const tpslOrderBody: any = {
          symbol: params.symbol,
          productType: 'USDT-FUTURES',
          marginCoin: 'USDT',
          planType: params.planType, // pos_loss or pos_profit
          triggerPrice: params.triggerPrice.toString(),
          triggerType: params.triggerType || 'mark_price',
          holdSide: params.holdSide, // 'long' or 'short'
        };

        // executePrice: 0 = market order, >0 = limit order
        if (params.executePrice && params.executePrice > 0) {
          tpslOrderBody.executePrice = params.executePrice.toString();
        } else {
          tpslOrderBody.executePrice = '0'; // Market order
        }

        // size is NOT required for pos_loss/pos_profit (affects entire position)
        // but CAN be provided for partial TP
        if (params.size) {
          tpslOrderBody.size = params.size.toString();
        }

        result = await bitgetRequest(config, 'POST', '/api/v2/mix/order/place-tpsl-order', tpslOrderBody);
        break;

      case 'cancel_plan_order':
        // Cancel plan order (SL/TP) - v2 API
        result = await bitgetRequest(config, 'POST', '/api/v2/mix/order/cancel-plan-order', {
          symbol: params.symbol,
          productType: 'USDT-FUTURES',
          marginCoin: 'USDT',
          orderId: params.orderId,
          planType: params.planType || 'normal_plan',
        });
        break;

      case 'modify_plan_order':
        // Modify plan order (for trailing stop, breakeven) - v2 API
        result = await bitgetRequest(config, 'POST', '/api/v2/mix/order/modify-plan-order', {
          symbol: params.symbol,
          productType: 'USDT-FUTURES',
          marginCoin: 'USDT',
          orderId: params.orderId,
          triggerPrice: params.triggerPrice.toString(),
          executePrice: params.executePrice ? params.executePrice.toString() : params.triggerPrice.toString(),
        });
        break;

      case 'flash_close_position':
        // Flash close - dedicated endpoint for closing positions
        console.log(`⚡ flash_close_position: ${params.symbol}, holdSide=${params.holdSide}, size=${params.size || 'full position'}`);
        
        const flashCloseBody: any = {
          symbol: params.symbol,
          productType: 'USDT-FUTURES',
          holdSide: params.holdSide,  // 'long' or 'short'
        };
        
        // If size is provided, close partial position, otherwise close entire position
        if (params.size) {
          flashCloseBody.size = params.size.toString();
        }
        
        result = await bitgetRequest(config, 'POST', '/api/v2/mix/order/close-positions', flashCloseBody);
        
        // ✅ PART 1: Add wasExecuted flag to determine if close was actually successful
        const wasExecuted = result?.result === true || 
          (Array.isArray(result?.successList) && result.successList.length > 0 && 
           (!result?.failureList || result.failureList.length === 0));
        
        console.log(`✅ flash_close_position: wasExecuted=${wasExecuted}, result=${JSON.stringify(result)}`);
        
        // Return enriched response with execution flag
        result = { ...result, wasExecuted };
        break;

      case 'close_position':
        // Close entire position - v2 API
        console.log(`🔄 close_position: ${params.symbol}, side=${params.side}, size=${params.size}`);
        const closeSideParam = params.side.toLowerCase();
        const closeIsLong = closeSideParam.includes('long');
        
        // For closing: buy to close short, sell to close long
        const closeBitgetSide = closeIsLong ? 'sell' : 'buy';
        const closePosSide = closeIsLong ? 'long' : 'short';
        
        result = await bitgetRequest(config, 'POST', '/api/v2/mix/order/place-order', {
          symbol: params.symbol,
          productType: 'USDT-FUTURES',
          marginMode: 'crossed',
          marginCoin: 'USDT',
          size: params.size.toString(),
          side: closeBitgetSide,
          tradeSide: 'close',
          posSide: closePosSide,
          orderType: 'market',
          force: 'ioc',  // ✅ CHANGED: Immediate or Cancel - allows partial fills, better for low liquidity
          reduceOnly: 'YES',
        });
        
        // Add execution flag to result
        const closeWasExecuted = result?.orderId && result?.status !== 'cancelled';
        console.log(`✅ close_position result: orderId=${result?.orderId}, status=${result?.status}, wasExecuted=${closeWasExecuted}`);
        result = { ...result, wasExecuted: closeWasExecuted };
        break;

      case 'get_ticker':
        // Get current market price - v2 API
        result = await bitgetRequest(config, 'GET', `/api/v2/mix/market/ticker?symbol=${params.symbol}&productType=USDT-FUTURES`);
        break;

      case 'get_symbol_info':
        // Get contract configuration including minimum order size - v2 API
        result = await bitgetRequest(config, 'GET', `/api/v2/mix/market/contracts?productType=USDT-FUTURES&symbol=${params.symbol}`);
        break;

      case 'get_plan_orders':
        // Get all plan orders (SL/TP) for a symbol - v2 API
        // planType can be 'profit_loss' (pos_profit/pos_loss) or 'normal_plan' (trigger orders)
        const planOrdersParams = new URLSearchParams({
          productType: 'USDT-FUTURES',
          planType: params.planType || 'profit_loss'
        });
        if (params.symbol) {
          planOrdersParams.append('symbol', params.symbol);
        }
        result = await bitgetRequest(config, 'GET', `/api/v2/mix/order/orders-plan-pending?${planOrdersParams.toString()}`);
        break;

      case 'set_leverage':
        // Set leverage for a symbol - v2 API
        result = await bitgetRequest(config, 'POST', '/api/v2/mix/account/set-leverage', {
          symbol: params.symbol,
          productType: 'USDT-FUTURES',
          marginCoin: 'USDT',
          leverage: params.leverage.toString(),
          holdSide: params.holdSide || 'long', // 'long' or 'short' - for cross margin use 'long'
        });
        break;

      case 'get_orders_history':
        // Get orders history with leverage info - v2 API
        const ordersHistoryParams = new URLSearchParams({
          productType: 'USDT-FUTURES',
          limit: params.limit || '100'
        });
        if (params.symbol) ordersHistoryParams.append('symbol', params.symbol);
        if (params.startTime) ordersHistoryParams.append('startTime', params.startTime);
        if (params.endTime) ordersHistoryParams.append('endTime', params.endTime);
        if (params.idLessThan) ordersHistoryParams.append('idLessThan', params.idLessThan);
        
        result = await bitgetRequest(config, 'GET', `/api/v2/mix/order/orders-history?${ordersHistoryParams.toString()}`);
        break;

      default:
        await log({
          functionName: 'bitget-api',
          message: `Unknown action: ${action}`,
          level: 'error',
          metadata: { action }
        });
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    await log({
      functionName: 'bitget-api',
      message: 'Bitget API call failed',
      level: 'error',
      metadata: { error: errorMessage }
    });
    console.error('Bitget API error:', error);
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
