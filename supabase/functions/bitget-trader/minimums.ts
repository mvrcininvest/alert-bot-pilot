// Minimum position sizes for different symbols on Bitget
// Values in USDT (notional value)

interface SymbolMinimums {
  [key: string]: number;
}

// Common minimums for popular symbols
// These should be updated periodically as exchanges change their requirements
export const SYMBOL_MINIMUMS: SymbolMinimums = {
  'BTCUSDT': 80,
  'ETHUSDT': 80,
  'BNBUSDT': 80,
  'SOLUSDT': 80,
  'XRPUSDT': 6,
  'ADAUSDT': 6,
  'DOGEUSDT': 6,
  'MATICUSDT': 6,
  'DOTUSDT': 6,
  'AVAXUSDT': 6,
  'LINKUSDT': 6,
  'UNIUSDT': 6,
  'LTCUSDT': 6,
  'ATOMUSDT': 6,
  'ETCUSDT': 6,
  'XLMUSDT': 6,
  'NEARUSDT': 6,
  'ALGOUSDT': 6,
  'TRXUSDT': 6,
  'FILUSDT': 6,
  // Default minimum for unlisted symbols
  'DEFAULT': 6
};

export function getMinimumPositionSize(symbol: string): number {
  return SYMBOL_MINIMUMS[symbol] || SYMBOL_MINIMUMS['DEFAULT'];
}

export function adjustPositionSizeToMinimum(
  calculatedSize: number,
  symbol: string,
  price: number
): { adjustedQuantity: number; adjustedNotional: number; wasAdjusted: boolean } {
  const minNotional = getMinimumPositionSize(symbol);
  const calculatedNotional = calculatedSize * price;
  
  if (calculatedNotional < minNotional) {
    // Need to adjust up to minimum
    const adjustedQuantity = minNotional / price;
    return {
      adjustedQuantity,
      adjustedNotional: minNotional,
      wasAdjusted: true
    };
  }
  
  return {
    adjustedQuantity: calculatedSize,
    adjustedNotional: calculatedNotional,
    wasAdjusted: false
  };
}
