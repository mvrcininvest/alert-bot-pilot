import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.84.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BitgetHistoricalPosition {
  positionId: string;
  symbol: string;
  posSide: 'long' | 'short';
  openPriceAvg: string;
  closePriceAvg: string;
  openTotalPos: string;
  netProfit: string;
  cumRealisedPnl: string;
  createdTime: string;
  updatedTime: string;
  marginMode: string;
}

async function signBitgetRequest(
  method: string,
  requestPath: string,
  queryString: string,
  body: string,
  timestamp: string
): Promise<string> {
  const apiKey = Deno.env.get('BITGET_API_KEY');
  const secretKey = Deno.env.get('BITGET_SECRET_KEY');
  const passphrase = Deno.env.get('BITGET_PASSPHRASE');

  if (!apiKey || !secretKey || !passphrase) {
    throw new Error('Missing Bitget API credentials');
  }

  const message = timestamp + method + requestPath + queryString + body;
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secretKey);
  const messageData = encoder.encode(message);

  const key = await crypto.subtle.importKey(
    'raw',
    keyData,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );

  const signature = await crypto.subtle.sign('HMAC', key, messageData);
  const hashArray = Array.from(new Uint8Array(signature));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');

  return hashHex;
}

async function fetchBitgetHistory(startTime: number, endTime: number): Promise<BitgetHistoricalPosition[]> {
  const apiKey = Deno.env.get('BITGET_API_KEY');
  const passphrase = Deno.env.get('BITGET_PASSPHRASE');
  const baseUrl = 'https://api.bitget.com';
  const path = '/api/v1/uta/trade/position-history';
  
  const queryString = `?category=USDT-FUTURES&startTime=${startTime}&endTime=${endTime}&limit=100`;
  const timestamp = Date.now().toString();
  const signature = await signBitgetRequest('GET', path, queryString, '', timestamp);

  const response = await fetch(`${baseUrl}${path}${queryString}`, {
    method: 'GET',
    headers: {
      'ACCESS-KEY': apiKey!,
      'ACCESS-SIGN': signature,
      'ACCESS-TIMESTAMP': timestamp,
      'ACCESS-PASSPHRASE': passphrase!,
      'Content-Type': 'application/json',
      'locale': 'en-US',
    },
  });

  const data = await response.json();
  
  if (data.code !== '00000') {
    console.error('Bitget API error:', data);
    throw new Error(`Bitget API error: ${data.msg}`);
  }

  return data.data?.list || [];
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const { days = 30 } = await req.json();
    const endTime = Date.now();
    const startTime = endTime - (days * 24 * 60 * 60 * 1000);

    console.log(`Fetching history from ${new Date(startTime).toISOString()} to ${new Date(endTime).toISOString()}`);

    const positions = await fetchBitgetHistory(startTime, endTime);
    console.log(`Fetched ${positions.length} positions from Bitget`);

    // Map Bitget positions to our database format
    const dbPositions = positions.map(pos => ({
      symbol: pos.symbol.replace('USDT', ''),
      side: pos.posSide === 'long' ? 'BUY' : 'SELL',
      entry_price: parseFloat(pos.openPriceAvg),
      close_price: parseFloat(pos.closePriceAvg),
      quantity: parseFloat(pos.openTotalPos),
      leverage: 10, // Default, we don't have this in history
      realized_pnl: parseFloat(pos.netProfit),
      status: 'closed',
      created_at: new Date(parseInt(pos.createdTime)).toISOString(),
      closed_at: new Date(parseInt(pos.updatedTime)).toISOString(),
      close_reason: 'imported_from_bitget',
      sl_price: 0,
      metadata: {
        imported: true,
        import_date: new Date().toISOString(),
        bitget_position_id: pos.positionId,
        margin_mode: pos.marginMode,
        cum_realised_pnl: pos.cumRealisedPnl,
      }
    }));

    // Check for existing positions to avoid duplicates
    const existingSymbols = dbPositions.map(p => p.symbol);
    const { data: existing } = await supabase
      .from('positions')
      .select('symbol, created_at, close_price')
      .eq('status', 'closed')
      .in('symbol', existingSymbols);

    // Filter out duplicates based on symbol, created_at, and close_price
    const existingSet = new Set(
      (existing || []).map(e => `${e.symbol}_${e.created_at}_${e.close_price}`)
    );

    const newPositions = dbPositions.filter(p => 
      !existingSet.has(`${p.symbol}_${p.created_at}_${p.close_price}`)
    );

    console.log(`Inserting ${newPositions.length} new positions (${dbPositions.length - newPositions.length} duplicates skipped)`);

    if (newPositions.length > 0) {
      const { data, error } = await supabase
        .from('positions')
        .insert(newPositions)
        .select();

      if (error) {
        console.error('Error inserting positions:', error);
        throw error;
      }

      console.log(`Successfully imported ${data.length} positions`);
    }

    return new Response(
      JSON.stringify({
        success: true,
        imported: newPositions.length,
        skipped: dbPositions.length - newPositions.length,
        total: dbPositions.length,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );

  } catch (error) {
    console.error('Error in import-history:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : undefined;
    
    return new Response(
      JSON.stringify({ 
        success: false, 
        error: errorMessage,
        details: errorStack 
      }),
      { 
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    );
  }
});
