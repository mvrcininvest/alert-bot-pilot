import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";

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

  console.log('Bitget request:', method, requestPath, bodyStr ? `Body: ${bodyStr}` : '');

  const response = await fetch(`${config.baseUrl}${requestPath}`, {
    method,
    headers,
    body: bodyStr || undefined,
  });

  if (!response.ok) {
    const errorText = await response.text();
    console.error('Bitget HTTP error:', response.status, errorText);
    throw new Error(`Bitget HTTP error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  console.log('Bitget response:', JSON.stringify(data));
  
  if (data.code !== '00000') {
    console.error('Bitget API error:', data);
    throw new Error(`Bitget API error (${data.code}): ${data.msg || 'Unknown error'}`);
  }

  return data.data;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const config: BitgetConfig = {
      apiKey: Deno.env.get('BITGET_API_KEY') ?? '',
      secretKey: Deno.env.get('BITGET_SECRET_KEY') ?? '',
      passphrase: Deno.env.get('BITGET_PASSPHRASE') ?? '',
      baseUrl: 'https://api.bitget.com',
    };

    const { action, params } = await req.json();
    console.log('Bitget API action:', action);

    let result;

    switch (action) {
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

      case 'place_order':
        // Place market order - v2 API
        result = await bitgetRequest(config, 'POST', '/api/v2/mix/order/place-order', {
          symbol: params.symbol,
          productType: 'USDT-FUTURES',
          marginMode: 'crossed',
          marginCoin: 'USDT',
          size: params.size.toString(),
          price: '',
          side: params.side.toLowerCase(), // 'open_long', 'open_short', 'close_long', 'close_short'
          tradeSide: params.side.toLowerCase().includes('long') ? 'long' : 'short',
          orderType: 'market',
          force: 'ioc',
        });
        break;

      case 'place_plan_order':
        // Place stop loss or take profit order - v2 API
        const planOrderBody: any = {
          symbol: params.symbol,
          productType: 'USDT-FUTURES',
          marginMode: 'crossed',
          marginCoin: 'USDT',
          size: params.size.toString(),
          side: params.side, // 'close_long' or 'close_short'
          tradeSide: params.side.includes('long') ? 'long' : 'short',
          triggerPrice: params.triggerPrice.toString(),
          triggerType: params.triggerType || 'mark_price',
          orderType: params.orderType || 'market',
        };

        // Add executePrice only for limit orders
        if (params.orderType === 'limit') {
          planOrderBody.executePrice = (params.executePrice || params.triggerPrice).toString();
        }

        // Determine plan type based on parameters
        if (params.planType === 'loss_plan') {
          planOrderBody.planType = 'loss_plan';
        } else if (params.planType === 'profit_plan') {
          planOrderBody.planType = 'profit_plan';
        } else {
          planOrderBody.planType = 'normal_plan';
        }

        result = await bitgetRequest(config, 'POST', '/api/v2/mix/order/place-plan-order', planOrderBody);
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

      case 'close_position':
        // Close entire position - v2 API
        result = await bitgetRequest(config, 'POST', '/api/v2/mix/order/place-order', {
          symbol: params.symbol,
          productType: 'USDT-FUTURES',
          marginMode: 'crossed',
          marginCoin: 'USDT',
          size: params.size.toString(),
          price: '',
          side: params.side, // 'close_long' or 'close_short'
          tradeSide: params.side.includes('long') ? 'long' : 'short',
          orderType: 'market',
          force: 'ioc',
        });
        break;

      case 'get_ticker':
        // Get current market price - v2 API
        result = await bitgetRequest(config, 'GET', `/api/v2/mix/market/ticker?symbol=${params.symbol}&productType=USDT-FUTURES`);
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

      default:
        throw new Error(`Unknown action: ${action}`);
    }

    return new Response(JSON.stringify({ success: true, data: result }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Bitget API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
