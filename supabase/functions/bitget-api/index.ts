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
  const requestPath = `/api/mix/v1${endpoint}`;
  const bodyStr = body ? JSON.stringify(body) : '';
  const headers = getBitgetHeaders(config, method, requestPath, bodyStr);

  console.log('Bitget request:', method, requestPath);

  const response = await fetch(`${config.baseUrl}${requestPath}`, {
    method,
    headers,
    body: bodyStr || undefined,
  });

  const data = await response.json();
  
  if (data.code !== '00000') {
    console.error('Bitget API error:', data);
    throw new Error(`Bitget API error: ${data.msg || 'Unknown error'}`);
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
        // Get account info
        result = await bitgetRequest(config, 'GET', `/account/accounts?productType=umcbl`);
        break;

      case 'get_positions':
        // Get all open positions
        result = await bitgetRequest(config, 'GET', `/position/allPosition?productType=umcbl`);
        break;

      case 'get_position':
        // Get specific position
        result = await bitgetRequest(config, 'GET', 
          `/position/singlePosition?symbol=${params.symbol}&marginCoin=USDT`);
        break;

      case 'place_order':
        // Place market order
        result = await bitgetRequest(config, 'POST', '/order/placeOrder', {
          symbol: params.symbol,
          marginCoin: 'USDT',
          size: params.size,
          side: params.side.toLowerCase(), // 'open_long' or 'open_short'
          orderType: 'market',
          timeInForceValue: 'normal',
        });
        break;

      case 'place_plan_order':
        // Place stop loss or take profit order
        result = await bitgetRequest(config, 'POST', '/plan/placePlan', {
          symbol: params.symbol,
          marginCoin: 'USDT',
          size: params.size,
          side: params.side, // 'close_long' or 'close_short'
          orderType: params.orderType, // 'limit' or 'market'
          triggerPrice: params.triggerPrice,
          executePrice: params.executePrice || params.triggerPrice,
          triggerType: params.triggerType || 'fill_price', // 'fill_price' or 'mark_price'
          planType: params.planType || 'normal_plan', // 'normal_plan', 'profit_plan', 'loss_plan'
        });
        break;

      case 'cancel_plan_order':
        // Cancel plan order (SL/TP)
        result = await bitgetRequest(config, 'POST', '/plan/cancelPlan', {
          symbol: params.symbol,
          marginCoin: 'USDT',
          orderId: params.orderId,
          planType: params.planType || 'normal_plan',
        });
        break;

      case 'modify_plan_order':
        // Modify plan order (for trailing stop, breakeven)
        result = await bitgetRequest(config, 'POST', '/plan/modifyPlan', {
          symbol: params.symbol,
          marginCoin: 'USDT',
          orderId: params.orderId,
          triggerPrice: params.triggerPrice,
          executePrice: params.executePrice,
        });
        break;

      case 'close_position':
        // Close entire position
        result = await bitgetRequest(config, 'POST', '/order/placeOrder', {
          symbol: params.symbol,
          marginCoin: 'USDT',
          size: params.size,
          side: params.side, // 'close_long' or 'close_short'
          orderType: 'market',
          timeInForceValue: 'normal',
        });
        break;

      case 'get_ticker':
        // Get current market price
        result = await bitgetRequest(config, 'GET', `/market/ticker?symbol=${params.symbol}`);
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
