import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { log } from "../_shared/logger.ts";
import { getUserSettings } from "../_shared/userSettings.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// ============= SL/TP CALCULATION LOGIC =============

interface AlertData {
  price: number;
  sl: number;
  tp1: number;
  tp2?: number;
  tp3?: number;
  main_tp: number;
  atr: number;
  leverage: number;
  side: 'BUY' | 'SELL';
  strength: number;
  technical?: any;
  volume_ratio?: number;
}

interface Settings {
  calculator_type: 'simple_percent' | 'risk_reward' | 'atr_based';
  sl_method: 'percent_margin' | 'percent_entry' | 'fixed_usdt' | 'atr_based';
  simple_sl_percent: number;
  simple_tp_percent: number;
  rr_sl_percent_margin: number;
  rr_ratio: number;
  rr_adaptive: boolean;
  atr_sl_multiplier: number;
  atr_tp_multiplier: number;
  tp_levels: number;
  tp1_rr_ratio: number;
  tp2_rr_ratio: number;
  tp3_rr_ratio: number;
  adaptive_tp_spacing: boolean;
  adaptive_tp_high_volatility_multiplier: number;
  adaptive_tp_low_volatility_multiplier: number;
  momentum_based_tp: boolean;
  momentum_weak_multiplier: number;
  momentum_moderate_multiplier: number;
  momentum_strong_multiplier: number;
  adaptive_rr: boolean;
  adaptive_rr_weak_signal: number;
  adaptive_rr_standard: number;
  adaptive_rr_strong: number;
  adaptive_rr_very_strong: number;
}

interface CalculatedPrices {
  sl_price: number;
  tp1_price?: number;
  tp2_price?: number;
  tp3_price?: number;
}

function calculateSLTP(
  alertData: AlertData,
  settings: Settings,
  positionSize: number
): CalculatedPrices {
  let slPrice: number;
  let tp1Price: number | undefined;
  let tp2Price: number | undefined;
  let tp3Price: number | undefined;

  // Calculate SL
  if (settings.calculator_type === 'risk_reward' && settings.sl_method === 'percent_entry') {
    slPrice = calculateSLByPercentMargin(alertData, settings, positionSize);
  } else {
    switch (settings.sl_method) {
      case 'percent_entry':
        slPrice = calculateSLByPercentEntry(alertData, settings);
        break;
      case 'percent_margin':
        slPrice = calculateSLByPercentMargin(alertData, settings, positionSize);
        break;
      case 'fixed_usdt':
        slPrice = calculateSLByFixedUSDT(alertData, settings, positionSize);
        break;
      case 'atr_based':
        slPrice = calculateSLByATR(alertData, settings);
        break;
      default:
        slPrice = alertData.sl;
    }
  }

  // Calculate TP
  switch (settings.calculator_type) {
    case 'simple_percent':
      ({ tp1Price, tp2Price, tp3Price } = calculateTPSimple(alertData, settings, slPrice));
      break;
    case 'risk_reward':
      ({ tp1Price, tp2Price, tp3Price } = calculateTPRiskReward(alertData, settings, slPrice));
      break;
    case 'atr_based':
      ({ tp1Price, tp2Price, tp3Price } = calculateTPATR(alertData, settings, slPrice));
      break;
  }

  return { sl_price: slPrice, tp1_price: tp1Price, tp2_price: tp2Price, tp3_price: tp3Price };
}

function calculateSLByPercentEntry(alertData: AlertData, settings: Settings): number {
  const percent = settings.simple_sl_percent / 100;
  return alertData.side === 'BUY'
    ? alertData.price * (1 - percent)
    : alertData.price * (1 + percent);
}

function calculateSLByPercentMargin(alertData: AlertData, settings: Settings, positionSize: number): number {
  const marginValue = positionSize * alertData.price / alertData.leverage;
  const maxLoss = marginValue * (settings.rr_sl_percent_margin / 100);
  const slDistance = maxLoss / positionSize;
  
  return alertData.side === 'BUY'
    ? alertData.price - slDistance
    : alertData.price + slDistance;
}

function calculateSLByFixedUSDT(alertData: AlertData, settings: Settings, positionSize: number): number {
  const fixedLoss = (settings as any).sl_fixed_usdt || 50;
  const slDistance = fixedLoss / positionSize;
  
  return alertData.side === 'BUY'
    ? alertData.price - slDistance
    : alertData.price + slDistance;
}

function calculateSLByATR(alertData: AlertData, settings: Settings): number {
  const atrMultiplier = settings.atr_sl_multiplier;
  const slDistance = alertData.atr * atrMultiplier;
  
  return alertData.side === 'BUY'
    ? alertData.price - slDistance
    : alertData.price + slDistance;
}

function calculateTPSimple(alertData: AlertData, settings: Settings, slPrice: number): { tp1Price?: number; tp2Price?: number; tp3Price?: number } {
  const percent = settings.simple_tp_percent / 100;
  
  const tp1Price = alertData.side === 'BUY'
    ? alertData.price * (1 + percent)
    : alertData.price * (1 - percent);

  let tp2Price, tp3Price;
  if (settings.tp_levels >= 2) {
    const tp2Percent = ((settings as any).simple_tp2_percent || (settings.simple_tp_percent * 1.5)) / 100;
    tp2Price = alertData.side === 'BUY'
      ? alertData.price * (1 + tp2Percent)
      : alertData.price * (1 - tp2Percent);
  }
  if (settings.tp_levels >= 3) {
    const tp3Percent = ((settings as any).simple_tp3_percent || (settings.simple_tp_percent * 2)) / 100;
    tp3Price = alertData.side === 'BUY'
      ? alertData.price * (1 + tp3Percent)
      : alertData.price * (1 - tp3Percent);
  }

  return { tp1Price, tp2Price, tp3Price };
}

function calculateTPRiskReward(alertData: AlertData, settings: Settings, slPrice: number): { tp1Price?: number; tp2Price?: number; tp3Price?: number } {
  const slDistance = Math.abs(alertData.price - slPrice);
  
  const tp1Price = alertData.side === 'BUY'
    ? alertData.price + (slDistance * settings.tp1_rr_ratio)
    : alertData.price - (slDistance * settings.tp1_rr_ratio);

  let tp2Price, tp3Price;
  if (settings.tp_levels >= 2) {
    tp2Price = alertData.side === 'BUY'
      ? alertData.price + (slDistance * settings.tp2_rr_ratio)
      : alertData.price - (slDistance * settings.tp2_rr_ratio);
  }
  if (settings.tp_levels >= 3) {
    tp3Price = alertData.side === 'BUY'
      ? alertData.price + (slDistance * settings.tp3_rr_ratio)
      : alertData.price - (slDistance * settings.tp3_rr_ratio);
  }

  return { tp1Price, tp2Price, tp3Price };
}

function calculateTPATR(alertData: AlertData, settings: Settings, slPrice: number): { tp1Price?: number; tp2Price?: number; tp3Price?: number } {
  const atrMultiplier = settings.atr_tp_multiplier;
  
  const tp1Price = alertData.side === 'BUY'
    ? alertData.price + (alertData.atr * atrMultiplier)
    : alertData.price - (alertData.atr * atrMultiplier);

  let tp2Price, tp3Price;
  if (settings.tp_levels >= 2) {
    const tp2Mult = (settings as any).atr_tp2_multiplier || (atrMultiplier * 1.5);
    tp2Price = alertData.side === 'BUY'
      ? alertData.price + (alertData.atr * tp2Mult)
      : alertData.price - (alertData.atr * tp2Mult);
  }
  if (settings.tp_levels >= 3) {
    const tp3Mult = (settings as any).atr_tp3_multiplier || (atrMultiplier * 2);
    tp3Price = alertData.side === 'BUY'
      ? alertData.price + (alertData.atr * tp3Mult)
      : alertData.price - (alertData.atr * tp3Mult);
  }

  return { tp1Price, tp2Price, tp3Price };
}

// ============= MAIN FUNCTION =============

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const { user_id } = await req.json();

    if (!user_id) {
      throw new Error('user_id is required');
    }

    await log({
      functionName: 'recalculate-sltp',
      message: `🔄 Starting SL/TP recalculation for user ${user_id}`,
      level: 'info'
    });
    console.log(`🔄 Starting SL/TP recalculation for user ${user_id}...`);

    // Get user settings
    const settings = await getUserSettings(user_id);

    console.log('✓ Settings loaded:', {
      calculator_type: settings.calculator_type,
      sl_method: settings.sl_method,
      tp_levels: settings.tp_levels
    });

    // Get all open positions for this user
    const { data: positions, error: positionsError } = await supabase
      .from('positions')
      .select('*')
      .eq('status', 'open')
      .eq('user_id', user_id);

    if (positionsError) {
      throw new Error(`Failed to fetch positions: ${positionsError.message}`);
    }

    if (!positions || positions.length === 0) {
      console.log('No open positions to recalculate');
      return new Response(
        JSON.stringify({ message: 'No open positions found', updated: 0 }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Found ${positions.length} open positions`);

    const results = [];

    // Recalculate SL/TP for each position
    for (const position of positions) {
      console.log(`\n🔧 Processing ${position.symbol}...`);
      console.log(`  Current: Entry=${position.entry_price}, SL=${position.sl_price}, TP1=${position.tp1_price}, TP2=${position.tp2_price}`);

      // Build alert data from position
      const alertData: AlertData = {
        price: position.entry_price,
        sl: position.sl_price,
        tp1: position.tp1_price || position.entry_price,
        tp2: position.tp2_price,
        tp3: position.tp3_price,
        main_tp: position.tp1_price || position.entry_price,
        atr: (position.metadata as any)?.atr || 0.01,
        leverage: position.leverage,
        side: position.side,
        strength: (position.metadata as any)?.strength || 0.5,
      };

      // Recalculate SL/TP
      const { sl_price, tp1_price, tp2_price, tp3_price } = calculateSLTP(
        alertData,
        settings as unknown as Settings,
        position.quantity
      );

      console.log(`  Recalculated: SL=${sl_price}, TP1=${tp1_price}, TP2=${tp2_price}`);

      // Update position in database
      const { error: updateError } = await supabase
        .from('positions')
        .update({
          sl_price: sl_price,
          tp1_price: tp1_price,
          tp2_price: tp2_price,
          tp3_price: tp3_price,
          updated_at: new Date().toISOString()
        })
        .eq('id', position.id)
        .eq('user_id', user_id);

      if (updateError) {
        console.error(`❌ Failed to update ${position.symbol}:`, updateError);
        results.push({
          symbol: position.symbol,
          success: false,
          error: updateError.message
        });
      } else {
        console.log(`✅ Updated ${position.symbol}`);
        results.push({
          symbol: position.symbol,
          success: true,
          old: {
            sl: position.sl_price,
            tp1: position.tp1_price,
            tp2: position.tp2_price
          },
          new: {
            sl: sl_price,
            tp1: tp1_price,
            tp2: tp2_price
          }
        });
      }
    }

    const successCount = results.filter(r => r.success).length;

    await log({
      functionName: 'recalculate-sltp',
      message: `Recalculation complete: ${successCount}/${positions.length} positions updated`,
      level: 'info',
      metadata: { results }
    });

    console.log(`\n✅ Recalculation complete: ${successCount}/${positions.length} positions updated`);

    return new Response(
      JSON.stringify({
        message: 'SL/TP recalculation complete',
        updated: successCount,
        total: positions.length,
        results
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200
      }
    );

  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    console.error('Error:', error);
    await log({
      functionName: 'recalculate-sltp',
      message: 'Failed to recalculate SL/TP',
      level: 'error',
      metadata: { error: errorMessage }
    });

    return new Response(
      JSON.stringify({ error: errorMessage }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 500
      }
    );
  }
});
