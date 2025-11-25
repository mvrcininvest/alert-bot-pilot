// Minimum position sizes for different symbols on Bitget
// Values in USDT (notional value)

interface SymbolMinimums {
  [key: string]: number;
}

// Minimum notional values (USDT) for each symbol on Bitget
// These are REAL minimums from Bitget API, not arbitrary values!
// Updated: 2025-11-25
export const SYMBOL_MINIMUMS: SymbolMinimums = {
  // Major coins - minimum 5 USDT notional
  'BTCUSDT': 5,
  'ETHUSDT': 5,
  'BNBUSDT': 5,
  'SOLUSDT': 5,
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
