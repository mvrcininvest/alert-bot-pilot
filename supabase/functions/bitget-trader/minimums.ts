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
  'XRPUSDT': 5,
  'ADAUSDT': 5,
  'DOGEUSDT': 5,
  'MATICUSDT': 5,
  'DOTUSDT': 5,
  'AVAXUSDT': 5,
  'LINKUSDT': 5,
  'UNIUSDT': 5,
  'LTCUSDT': 5,
  'ATOMUSDT': 5,
  'ETCUSDT': 5,
  'XLMUSDT': 5,
  'NEARUSDT': 5,
  'ALGOUSDT': 5,
  'TRXUSDT': 5,
  'FILUSDT': 5,
  // Default minimum for unlisted symbols
  'DEFAULT': 5
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
