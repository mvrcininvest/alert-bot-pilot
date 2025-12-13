-- Clean exchange prefixes (BITGET:, BYBIT:, etc.) and .P suffix from existing alerts
UPDATE public.alerts 
SET symbol = REGEXP_REPLACE(
  REGEXP_REPLACE(symbol, '^[A-Z]+:', ''),
  '\.P$', ''
)
WHERE symbol LIKE '%:%' OR symbol LIKE '%.P';