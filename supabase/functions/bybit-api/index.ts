import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";
import { log } from "../_shared/logger.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BybitConfig {
  apiKey: string;
  secretKey: string;
  baseUrl: string;
  recvWindow: string;
}

function getTimestamp(): string {
  return Date.now().toString();
}

function sign(timestamp: string, apiKey: string, recvWindow: string, queryOrBody: string, secretKey: string): string {
  // Bybit v5 signature: HMAC_SHA256(timestamp + apiKey + recvWindow + queryString/body, secretKey)
  const message = timestamp + apiKey + recvWindow + queryOrBody;
  const hmac = createHmac('sha256', secretKey);
  hmac.update(message);
  return hmac.digest('hex');
}

function getBybitHeaders(config: BybitConfig, timestamp: string, queryOrBody: string): Record<string, string> {
  const signature = sign(timestamp, config.apiKey, config.recvWindow, queryOrBody, config.secretKey);

  return {
    'X-BAPI-API-KEY': config.apiKey,
    'X-BAPI-SIGN': signature,
    'X-BAPI-TIMESTAMP': timestamp,
    'X-BAPI-RECV-WINDOW': config.recvWindow,
    'Content-Type': 'application/json',
  };
}

async function bybitRequest(config: BybitConfig, method: string, endpoint: string, params?: any): Promise<any> {
  const timestamp = getTimestamp();
  let url = `${config.baseUrl}${endpoint}`;
  let queryOrBody = '';
  let body: string | undefined;

  if (method === 'GET' && params) {
    const queryString = new URLSearchParams(params).toString();
    queryOrBody = queryString;
    url = `${url}?${queryString}`;
  } else if (method === 'POST' && params) {
    body = JSON.stringify(params);
    queryOrBody = body;
  }

  const headers = getBybitHeaders(config, timestamp, queryOrBody);

  await log({
    functionName: 'bybit-api',
    message: `Bybit API request: ${method} ${endpoint}`,
    level: 'info',
    metadata: { method, endpoint, hasParams: !!params }
  });
  console.log('Bybit request:', method, endpoint, queryOrBody ? `Params: ${queryOrBody}` : '');

  const response = await fetch(url, {
    method,
    headers,
    body,
  });

  if (!response.ok) {
    const errorText = await response.text();
    await log({
      functionName: 'bybit-api',
      message: 'Bybit HTTP error',
      level: 'error',
      metadata: { status: response.status, error: errorText, endpoint }
    });
    console.error('Bybit HTTP error:', response.status, errorText);
    throw new Error(`Bybit HTTP error ${response.status}: ${errorText}`);
  }

  const data = await response.json();
  console.log('Bybit response:', JSON.stringify(data));
  
  if (data.retCode !== 0) {
    await log({
      functionName: 'bybit-api',
      message: 'Bybit API error',
      level: 'error',
      metadata: { retCode: data.retCode, retMsg: data.retMsg, endpoint }
    });
    console.error('Bybit API error:', data);
    throw new Error(`Bybit API error (${data.retCode}): ${data.retMsg || 'Unknown error'}`);
  }

  await log({
    functionName: 'bybit-api',
    message: `Bybit API success: ${method} ${endpoint}`,
    level: 'info',
    metadata: { endpoint }
  });

  return data.result;
}

// Helper: Map internal side format to Bybit format
function mapSideToBybit(side: string): { side: string; positionIdx: number } {
  const sideParam = side.toLowerCase();
  const isLong = sideParam.includes('long');
  const isOpen = sideParam.includes('open');
  
  // Bybit v5: side is "Buy" or "Sell", positionIdx: 1=Buy/Long, 2=Sell/Short (hedge mode)
  // open_long: Buy + positionIdx=1
  // open_short: Sell + positionIdx=2
  // close_long: Sell + positionIdx=1
  // close_short: Buy + positionIdx=2
  
  if (isOpen && isLong) {
    return { side: 'Buy', positionIdx: 1 };
  } else if (isOpen && !isLong) {
    return { side: 'Sell', positionIdx: 2 };
  } else if (!isOpen && isLong) {
    return { side: 'Sell', positionIdx: 1 };
  } else {
    return { side: 'Buy', positionIdx: 2 };
  }
}

// Helper: Map holdSide to positionIdx
function holdSideToPositionIdx(holdSide: string): number {
  return holdSide === 'long' ? 1 : 2;
}

// Helper: Map positionIdx to holdSide
function positionIdxToHoldSide(positionIdx: number | string): string {
  return Number(positionIdx) === 1 ? 'long' : 'short';
}

// Helper: Transform Bybit position to Bitget-like format for compatibility
function transformPosition(bybitPos: any): any {
  if (!bybitPos) return null;
  
  return {
    symbol: bybitPos.symbol,
    holdSide: positionIdxToHoldSide(bybitPos.positionIdx),
    openPriceAvg: bybitPos.avgPrice,
    marginSize: bybitPos.positionIM,
    available: bybitPos.size,
    total: bybitPos.size,
    leverage: bybitPos.leverage,
    achievedProfits: bybitPos.cumRealisedPnl,
    unrealizedPL: bybitPos.unrealisedPnl,
    marginMode: bybitPos.tradeMode === 0 ? 'crossed' : 'isolated',
    liquidationPrice: bybitPos.liqPrice,
    markPrice: bybitPos.markPrice,
    // Keep original Bybit data
    _raw: bybitPos
  };
}

// Helper: Transform Bybit ticker to Bitget-like format
function transformTicker(bybitTicker: any): any {
  if (!bybitTicker) return null;
  
  return {
    symbol: bybitTicker.symbol,
    lastPr: bybitTicker.lastPrice,
    markPrice: bybitTicker.markPrice,
    indexPrice: bybitTicker.indexPrice,
    high24h: bybitTicker.highPrice24h,
    low24h: bybitTicker.lowPrice24h,
    change24h: bybitTicker.price24hPcnt,
    _raw: bybitTicker
  };
}

// Helper: Transform Bybit contract info to Bitget-like format
function transformContractInfo(bybitContract: any): any {
  if (!bybitContract) return null;
  
  return {
    symbol: bybitContract.symbol,
    baseCoin: bybitContract.baseCoin,
    quoteCoin: bybitContract.quoteCoin,
    minTradeNum: bybitContract.lotSizeFilter?.minOrderQty || '0.001',
    pricePlace: bybitContract.priceFilter?.tickSize ? 
      (bybitContract.priceFilter.tickSize.split('.')[1]?.length || 0) : 2,
    volumePlace: bybitContract.lotSizeFilter?.qtyStep ?
      (bybitContract.lotSizeFilter.qtyStep.split('.')[1]?.length || 0) : 3,
    sizeMultiplier: '1',
    maxLever: bybitContract.leverageFilter?.maxLeverage || '100',
    _raw: bybitContract
  };
}

// Helper: Transform Bybit order to Bitget-like format
function transformOrder(bybitOrder: any): any {
  if (!bybitOrder) return null;
  
  return {
    orderId: bybitOrder.orderId,
    clientOid: bybitOrder.orderLinkId,
    symbol: bybitOrder.symbol,
    size: bybitOrder.qty,
    executePrice: bybitOrder.price,
    triggerPrice: bybitOrder.triggerPrice,
    status: bybitOrder.orderStatus,
    orderType: bybitOrder.orderType?.toLowerCase(),
    side: bybitOrder.side?.toLowerCase(),
    posSide: positionIdxToHoldSide(bybitOrder.positionIdx),
    planType: bybitOrder.stopOrderType === 'StopLoss' ? 'pos_loss' : 
              bybitOrder.stopOrderType === 'TakeProfit' ? 'pos_profit' : 'normal_plan',
    _raw: bybitOrder
  };
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
    
    const { action, params, apiCredentials } = body;
    
    // Use provided API credentials or fall back to env vars
    const config: BybitConfig = {
      apiKey: apiCredentials?.apiKey || Deno.env.get('BYBIT_API_KEY') || '',
      secretKey: apiCredentials?.secretKey || Deno.env.get('BYBIT_SECRET_KEY') || '',
      baseUrl: 'https://api.bybit.com',
      recvWindow: '5000',
    };
    
    // Validate credentials (Bybit doesn't use passphrase)
    if (!config.apiKey || !config.secretKey) {
      throw new Error('Missing API credentials');
    }
    
    await log({
      functionName: 'bybit-api',
      message: `Processing action: ${action}`,
      level: 'info',
      metadata: { action, params }
    });
    console.log('Bybit API action:', action);

    let result;

    switch (action) {
      case 'batch_actions':
        // Execute multiple actions in sequence with rate limiting
        console.log(`📦 batch_actions: ${params.actions?.length || 0} actions`);
        const batchResults: Record<string, any> = {};
        
        if (!params.actions || !Array.isArray(params.actions)) {
          throw new Error('batch_actions requires an array of actions');
        }
        
        for (let i = 0; i < params.actions.length; i++) {
          const batchAction = params.actions[i];
          const { id, type, params: actionParams } = batchAction;
          
          // Add delay between requests to prevent rate limiting (100ms for Bybit)
          if (i > 0) {
            await new Promise(resolve => setTimeout(resolve, 100));
          }
          
          try {
            console.log(`  ➡️ Executing batch action ${id}: ${type}`);
            
            switch (type) {
              case 'get_account':
                const accResult = await bybitRequest(config, 'GET', '/v5/account/wallet-balance', {
                  accountType: 'UNIFIED'
                });
                // Transform to Bitget-like format
                const usdtCoin = accResult?.list?.[0]?.coin?.find((c: any) => c.coin === 'USDT');
                batchResults[id] = [{
                  marginCoin: 'USDT',
                  available: usdtCoin?.availableToWithdraw || '0',
                  crossedMaxAvailable: usdtCoin?.availableToWithdraw || '0',
                  equity: usdtCoin?.equity || '0',
                  usdtEquity: usdtCoin?.equity || '0',
                  accountEquity: accResult?.list?.[0]?.totalEquity || '0',
                  unrealizedPL: usdtCoin?.unrealisedPnl || '0',
                  _raw: accResult
                }];
                break;
                
              case 'get_symbol_info':
                const symbolResult = await bybitRequest(config, 'GET', '/v5/market/instruments-info', {
                  category: 'linear',
                  symbol: actionParams.symbol
                });
                batchResults[id] = symbolResult?.list?.map(transformContractInfo) || [];
                break;
                
              case 'set_leverage':
                batchResults[id] = await bybitRequest(config, 'POST', '/v5/position/set-leverage', {
                  category: 'linear',
                  symbol: actionParams.symbol,
                  buyLeverage: actionParams.leverage.toString(),
                  sellLeverage: actionParams.leverage.toString(),
                });
                break;
                
              case 'get_ticker':
                const tickerResult = await bybitRequest(config, 'GET', '/v5/market/tickers', {
                  category: 'linear',
                  symbol: actionParams.symbol
                });
                batchResults[id] = tickerResult?.list?.map(transformTicker) || [];
                break;
              
              case 'get_position':
                const posResult = await bybitRequest(config, 'GET', '/v5/position/list', {
                  category: 'linear',
                  symbol: actionParams.symbol
                });
                batchResults[id] = posResult?.list?.map(transformPosition) || [];
                break;
              
              case 'get_plan_orders':
                // Map planType to Bybit stopOrderType
                const stopOrderType = actionParams.planType === 'profit_loss' ? undefined : 
                  actionParams.planType === 'pos_loss' ? 'StopLoss' : 
                  actionParams.planType === 'pos_profit' ? 'TakeProfit' : undefined;
                
                const planParams: any = {
                  category: 'linear',
                  symbol: actionParams.symbol,
                };
                if (stopOrderType) {
                  planParams.stopOrderType = stopOrderType;
                }
                
                const planResult = await bybitRequest(config, 'GET', '/v5/order/realtime', planParams);
                batchResults[id] = {
                  entrustedList: planResult?.list?.map(transformOrder) || []
                };
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
        // Get account info - Bybit v5
        const accountResult = await bybitRequest(config, 'GET', '/v5/account/wallet-balance', {
          accountType: 'UNIFIED'
        });
        // Transform to Bitget-like format for compatibility
        const usdtAccount = accountResult?.list?.[0]?.coin?.find((c: any) => c.coin === 'USDT');
        result = [{
          marginCoin: 'USDT',
          available: usdtAccount?.availableToWithdraw || '0',
          crossedMaxAvailable: usdtAccount?.availableToWithdraw || '0',
          equity: usdtAccount?.equity || '0',
          usdtEquity: usdtAccount?.equity || '0',
          accountEquity: accountResult?.list?.[0]?.totalEquity || '0',
          unrealizedPL: usdtAccount?.unrealisedPnl || '0',
          _raw: accountResult
        }];
        break;

      case 'get_positions':
        // Get all open positions - Bybit v5
        const positionsResult = await bybitRequest(config, 'GET', '/v5/position/list', {
          category: 'linear',
          settleCoin: 'USDT'
        });
        result = positionsResult?.list?.filter((p: any) => parseFloat(p.size) > 0).map(transformPosition) || [];
        break;

      case 'get_position':
        // Get specific position - Bybit v5
        const singlePosResult = await bybitRequest(config, 'GET', '/v5/position/list', {
          category: 'linear',
          symbol: params.symbol
        });
        result = singlePosResult?.list?.map(transformPosition) || [];
        break;
      
      case 'get_history_positions':
      case 'get_fills':
      case 'get_order_fills':
        // Get fills/execution history - Bybit v5
        const fillsParams: any = {
          category: 'linear',
          limit: params.limit || '50'
        };
        if (params.symbol) fillsParams.symbol = params.symbol;
        if (params.startTime) fillsParams.startTime = params.startTime;
        if (params.endTime) fillsParams.endTime = params.endTime;
        
        const fillsResult = await bybitRequest(config, 'GET', '/v5/execution/list', fillsParams);
        result = {
          fillList: fillsResult?.list || []
        };
        break;

      case 'get_position_history':
        // Get closed position PnL history - Bybit v5
        const pnlParams: any = {
          category: 'linear',
          limit: params.limit || '100'
        };
        if (params.symbol) pnlParams.symbol = params.symbol;
        if (params.startTime) pnlParams.startTime = params.startTime;
        if (params.endTime) pnlParams.endTime = params.endTime;
        if (params.cursor) pnlParams.cursor = params.cursor;
        
        const pnlResult = await bybitRequest(config, 'GET', '/v5/position/closed-pnl', pnlParams);
        
        // Transform to Bitget-like format
        result = {
          list: pnlResult?.list?.map((p: any) => ({
            symbol: p.symbol,
            netProfit: p.closedPnl,
            openAvgPrice: p.avgEntryPrice,
            closeAvgPrice: p.avgExitPrice,
            closeTotalPos: p.closedSize,
            leverage: p.leverage,
            holdSide: positionIdxToHoldSide(p.positionIdx || (p.side === 'Buy' ? 1 : 2)),
            ctime: p.createdTime,
            utime: p.updatedTime,
            _raw: p
          })) || [],
          cursor: pnlResult?.nextPageCursor
        };
        
        console.log(`[get_position_history] Response: list=${result.list.length}, cursor=${result.cursor}`);
        break;

      case 'place_order':
        // Place order (market or limit) - Bybit v5
        const { side: orderSide, positionIdx: orderPosIdx } = mapSideToBybit(params.side);
        
        const orderBody: any = {
          category: 'linear',
          symbol: params.symbol,
          side: orderSide,
          orderType: (params.orderType || 'market').charAt(0).toUpperCase() + (params.orderType || 'market').slice(1),
          qty: params.size.toString(),
          positionIdx: orderPosIdx,
          timeInForce: params.orderType === 'limit' ? 'GTC' : 'IOC',
        };
        
        // Add price for limit orders
        if (params.orderType === 'limit' && params.price) {
          orderBody.price = params.price.toString();
        }
        
        // Add reduceOnly flag for closing positions
        if (params.reduceOnly === 'YES' || params.reduceOnly === true) {
          orderBody.reduceOnly = true;
        }
        
        const orderResult = await bybitRequest(config, 'POST', '/v5/order/create', orderBody);
        result = {
          orderId: orderResult?.orderId,
          clientOid: orderResult?.orderLinkId,
          _raw: orderResult
        };
        break;

      case 'place_plan_order':
        // Place conditional order (trigger order) - Bybit v5
        const { side: planSide, positionIdx: planPosIdx } = mapSideToBybit(params.side);
        
        const planOrderBody: any = {
          category: 'linear',
          symbol: params.symbol,
          side: planSide,
          orderType: (params.orderType || 'market').charAt(0).toUpperCase() + (params.orderType || 'market').slice(1),
          qty: params.size.toString(),
          positionIdx: planPosIdx,
          triggerPrice: params.triggerPrice.toString(),
          triggerDirection: planSide === 'Buy' ? 1 : 2, // 1=rise above, 2=fall below
          triggerBy: params.triggerType === 'mark_price' ? 'MarkPrice' : 'LastPrice',
          timeInForce: 'GTC',
        };
        
        if (params.orderType === 'limit' && params.executePrice) {
          planOrderBody.price = params.executePrice.toString();
        }
        
        const planOrderResult = await bybitRequest(config, 'POST', '/v5/order/create', planOrderBody);
        result = {
          orderId: planOrderResult?.orderId,
          clientOid: planOrderResult?.orderLinkId,
          _raw: planOrderResult
        };
        break;

      case 'place_tpsl_order':
        // Place SL/TP for existing position - Bybit v5
        // Uses /v5/position/trading-stop endpoint
        const tpslBody: any = {
          category: 'linear',
          symbol: params.symbol,
          positionIdx: holdSideToPositionIdx(params.holdSide),
          tpslMode: 'Partial', // Allow partial TP/SL
        };
        
        if (params.planType === 'pos_loss') {
          tpslBody.stopLoss = params.triggerPrice.toString();
          tpslBody.slTriggerBy = params.triggerType === 'mark_price' ? 'MarkPrice' : 'LastPrice';
          if (params.size) {
            tpslBody.slSize = params.size.toString();
          }
          if (params.executePrice && params.executePrice > 0) {
            tpslBody.slLimitPrice = params.executePrice.toString();
            tpslBody.slOrderType = 'Limit';
          } else {
            tpslBody.slOrderType = 'Market';
          }
        } else if (params.planType === 'pos_profit') {
          tpslBody.takeProfit = params.triggerPrice.toString();
          tpslBody.tpTriggerBy = params.triggerType === 'mark_price' ? 'MarkPrice' : 'LastPrice';
          if (params.size) {
            tpslBody.tpSize = params.size.toString();
          }
          if (params.executePrice && params.executePrice > 0) {
            tpslBody.tpLimitPrice = params.executePrice.toString();
            tpslBody.tpOrderType = 'Limit';
          } else {
            tpslBody.tpOrderType = 'Market';
          }
        }
        
        result = await bybitRequest(config, 'POST', '/v5/position/trading-stop', tpslBody);
        break;

      case 'cancel_plan_order':
        // Cancel conditional order - Bybit v5
        result = await bybitRequest(config, 'POST', '/v5/order/cancel', {
          category: 'linear',
          symbol: params.symbol,
          orderId: params.orderId,
        });
        break;

      case 'modify_plan_order':
        // Modify conditional order - Bybit v5
        const modifyBody: any = {
          category: 'linear',
          symbol: params.symbol,
          orderId: params.orderId,
        };
        
        if (params.triggerPrice) {
          modifyBody.triggerPrice = params.triggerPrice.toString();
        }
        if (params.executePrice) {
          modifyBody.price = params.executePrice.toString();
        }
        
        result = await bybitRequest(config, 'POST', '/v5/order/amend', modifyBody);
        break;

      case 'flash_close_position':
        // Flash close - close position immediately - Bybit v5
        console.log(`⚡ flash_close_position: ${params.symbol}, holdSide=${params.holdSide}, size=${params.size || 'full position'}`);
        
        // Get current position to determine size
        const currentPos = await bybitRequest(config, 'GET', '/v5/position/list', {
          category: 'linear',
          symbol: params.symbol
        });
        
        const posToClose = currentPos?.list?.find((p: any) => 
          positionIdxToHoldSide(p.positionIdx) === params.holdSide && parseFloat(p.size) > 0
        );
        
        if (!posToClose) {
          result = { wasExecuted: false, message: 'No position to close' };
          break;
        }
        
        const closeSize = params.size || posToClose.size;
        const closeSide = params.holdSide === 'long' ? 'Sell' : 'Buy';
        const closePosIdx = holdSideToPositionIdx(params.holdSide);
        
        const flashCloseResult = await bybitRequest(config, 'POST', '/v5/order/create', {
          category: 'linear',
          symbol: params.symbol,
          side: closeSide,
          orderType: 'Market',
          qty: closeSize.toString(),
          positionIdx: closePosIdx,
          reduceOnly: true,
          timeInForce: 'IOC',
        });
        
        const wasExecuted = !!flashCloseResult?.orderId;
        console.log(`✅ flash_close_position: wasExecuted=${wasExecuted}, orderId=${flashCloseResult?.orderId}`);
        
        result = { 
          ...flashCloseResult, 
          wasExecuted,
          orderId: flashCloseResult?.orderId
        };
        break;

      case 'close_position':
        // Close position - Bybit v5
        console.log(`🔄 close_position: ${params.symbol}, side=${params.side}, size=${params.size}`);
        
        const closeSideParam = params.side.toLowerCase();
        const closeIsLong = closeSideParam.includes('long');
        const closeBybitSide = closeIsLong ? 'Sell' : 'Buy';
        const closePositionIdx = closeIsLong ? 1 : 2;
        
        const closeResult = await bybitRequest(config, 'POST', '/v5/order/create', {
          category: 'linear',
          symbol: params.symbol,
          side: closeBybitSide,
          orderType: 'Market',
          qty: params.size.toString(),
          positionIdx: closePositionIdx,
          reduceOnly: true,
          timeInForce: 'IOC',
        });
        
        const closeWasExecuted = !!closeResult?.orderId;
        console.log(`✅ close_position result: orderId=${closeResult?.orderId}, wasExecuted=${closeWasExecuted}`);
        
        result = { 
          orderId: closeResult?.orderId,
          wasExecuted: closeWasExecuted,
          _raw: closeResult
        };
        break;

      case 'get_ticker':
        // Get current market price - Bybit v5
        const tickerResult = await bybitRequest(config, 'GET', '/v5/market/tickers', {
          category: 'linear',
          symbol: params.symbol
        });
        result = tickerResult?.list?.map(transformTicker) || [];
        break;

      case 'get_symbol_info':
        // Get contract configuration - Bybit v5
        const contractResult = await bybitRequest(config, 'GET', '/v5/market/instruments-info', {
          category: 'linear',
          symbol: params.symbol
        });
        result = contractResult?.list?.map(transformContractInfo) || [];
        break;

      case 'get_plan_orders':
        // Get all conditional/SL/TP orders - Bybit v5
        const planOrdersParams: any = {
          category: 'linear',
        };
        if (params.symbol) {
          planOrdersParams.symbol = params.symbol;
        }
        
        // For profit_loss (SL/TP), we need to check position's TP/SL settings
        // For normal_plan, check conditional orders
        const ordersResult = await bybitRequest(config, 'GET', '/v5/order/realtime', planOrdersParams);
        
        result = {
          entrustedList: ordersResult?.list?.map(transformOrder) || []
        };
        break;

      case 'set_leverage':
        // Set leverage for a symbol - Bybit v5
        // Note: Bybit sets leverage for both sides at once
        result = await bybitRequest(config, 'POST', '/v5/position/set-leverage', {
          category: 'linear',
          symbol: params.symbol,
          buyLeverage: params.leverage.toString(),
          sellLeverage: params.leverage.toString(),
        });
        break;

      case 'get_orders_history':
        // Get orders history - Bybit v5
        const ordersHistoryParams: any = {
          category: 'linear',
          limit: params.limit || '100'
        };
        if (params.symbol) ordersHistoryParams.symbol = params.symbol;
        if (params.startTime) ordersHistoryParams.startTime = params.startTime;
        if (params.endTime) ordersHistoryParams.endTime = params.endTime;
        if (params.cursor) ordersHistoryParams.cursor = params.cursor;
        
        const historyResult = await bybitRequest(config, 'GET', '/v5/order/history', ordersHistoryParams);
        result = {
          orderList: historyResult?.list || [],
          cursor: historyResult?.nextPageCursor
        };
        break;

      default:
        await log({
          functionName: 'bybit-api',
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
      functionName: 'bybit-api',
      message: 'Bybit API call failed',
      level: 'error',
      metadata: { error: errorMessage }
    });
    console.error('Bybit API error:', error);
    return new Response(JSON.stringify({ success: false, error: errorMessage }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

