import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.84.0';
import { createHmac } from "https://deno.land/std@0.168.0/node/crypto.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

interface BitgetHistoricalPosition {
  positionId: string;
  symbol: string;
  holdSide: 'long' | 'short';
  openAvgPrice: string;
  closeAvgPrice: string;
  openTotalPos: string;
  closeTotalPos: string;
  pnl: string;
  netProfit: string;
  totalFee?: string;
  openFee: string;
  closeFee: string;
  ctime: string;
  utime: string;
  marginMode: string;
  marginCoin: string;
}

async function signBitgetRequest(
  method: string,
  requestPath: string,
  queryString: string,
  body: string,
  timestamp: string
): Promise<string> {
  const secretKey = Deno.env.get('BITGET_SECRET_KEY');

  if (!secretKey) {
    throw new Error('Missing Bitget SECRET_KEY');
  }

  const message = timestamp + method + requestPath + queryString + body;
  const hmac = createHmac('sha256', secretKey);
  hmac.update(message);
  return hmac.digest('base64');
}

async function fetchBitgetHistory(startTime: number, endTime: number): Promise<BitgetHistoricalPosition[]> {
  const apiKey = Deno.env.get('BITGET_API_KEY');
  const passphrase = Deno.env.get('BITGET_PASSPHRASE');
  const baseUrl = 'https://api.bitget.com';
  const path = '/api/v2/mix/position/history-position';
  
  const queryString = `?productType=USDT-FUTURES&startTime=${startTime}&endTime=${endTime}&pageSize=100`;
  const timestamp = Date.now().toString();
  const signature = await signBitgetRequest('GET', path, queryString, '', timestamp);

  console.log('Fetching from:', `${baseUrl}${path}${queryString}`);

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
  console.log('Bitget response:', JSON.stringify(data));
  
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
    
    if (positions.length > 0) {
      console.log('Sample position:', JSON.stringify(positions[0]));
    }

    // Map Bitget positions to our database format
    const dbPositions = positions.map(pos => {
      // Validate and parse timestamps - ctime and utime are in milliseconds
      const createdTime = pos.ctime ? parseInt(pos.ctime) : Date.now();
      const updatedTime = pos.utime ? parseInt(pos.utime) : Date.now();
      
      // Check if timestamps are valid
      if (isNaN(createdTime) || isNaN(updatedTime)) {
        console.error('Invalid timestamps for position:', pos.positionId, 'ctime:', pos.ctime, 'utime:', pos.utime);
      }

      return {
        symbol: pos.symbol, // Keep full symbol from Bitget (e.g. BTCUSDT)
        side: pos.holdSide === 'long' ? 'BUY' : 'SELL',
        entry_price: parseFloat(pos.openAvgPrice),
        close_price: parseFloat(pos.closeAvgPrice),
        quantity: parseFloat(pos.closeTotalPos),
        leverage: 10, // Default for imported positions
        realized_pnl: parseFloat(pos.netProfit),
        status: 'closed',
        created_at: new Date(createdTime).toISOString(),
        closed_at: new Date(updatedTime).toISOString(),
        close_reason: 'imported_from_bitget',
        sl_price: 0,
        metadata: {
          imported: true,
          import_date: new Date().toISOString(),
          bitget_position_id: pos.positionId,
          margin_mode: pos.marginMode,
          pnl: pos.pnl,
          total_fee: pos.totalFee || '0',
          open_total_pos: pos.openTotalPos,
        }
      };
    });

    // Check for existing positions to avoid duplicates
    const { data: existing } = await supabase
      .from('positions')
      .select('entry_price, close_price, closed_at')
      .eq('status', 'closed');

    // Filter out duplicates based on entry_price, close_price, and closed_at (with 5-minute tolerance)
    const existingSet = new Set(
      (existing || []).map(e => 
        `${e.entry_price}_${e.close_price}_${Math.floor(new Date(e.closed_at).getTime() / 300000)}`
      )
    );

    const newPositions = dbPositions.filter(p => {
      const timeKey = Math.floor(new Date(p.closed_at).getTime() / 300000);
      const key = `${p.entry_price}_${p.close_price}_${timeKey}`;
      return !existingSet.has(key);
    });

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
