-- Create function to get money management statistics
CREATE OR REPLACE FUNCTION public.get_money_management_stats()
RETURNS TABLE(
  position_sizing_type text,
  margin_bucket text,
  symbol_category text,
  count bigint,
  win_rate numeric,
  avg_pnl numeric,
  total_pnl numeric
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  RETURN QUERY
  WITH position_mm_data AS (
    SELECT 
      p.id,
      p.realized_pnl,
      -- Extract position_sizing_type from settings_snapshot or mm_data
      COALESCE(
        (p.metadata->'settings_snapshot'->>'position_sizing_type'),
        (p.metadata->'mm_data'->>'position_sizing_type'),
        'unknown'
      ) as sizing_type,
      -- Extract or calculate margin bucket
      COALESCE(
        (p.metadata->'mm_data'->>'margin_bucket'),
        CASE 
          WHEN ((p.metadata->'settings_snapshot'->>'position_size_value')::numeric) IS NOT NULL 
            AND ((p.metadata->'settings_snapshot'->>'position_sizing_type') = 'scalping_mode')
          THEN 
            CASE 
              WHEN ((p.entry_price * p.quantity / p.leverage) < 1) THEN '<1'
              WHEN ((p.entry_price * p.quantity / p.leverage) < 2) THEN '1-2'
              WHEN ((p.entry_price * p.quantity / p.leverage) < 5) THEN '2-5'
              ELSE '>5'
            END
          ELSE NULL
        END,
        CASE 
          WHEN ((p.entry_price * p.quantity / p.leverage) < 1) THEN '<1'
          WHEN ((p.entry_price * p.quantity / p.leverage) < 2) THEN '1-2'
          WHEN ((p.entry_price * p.quantity / p.leverage) < 5) THEN '2-5'
          ELSE '>5'
        END
      ) as margin_bucket,
      -- Extract or calculate symbol category
      COALESCE(
        (p.metadata->'mm_data'->>'symbol_category'),
        CASE 
          WHEN p.symbol LIKE '%BTC%' OR p.symbol LIKE '%ETH%' THEN 'BTC_ETH'
          WHEN p.symbol LIKE '%SOL%' OR p.symbol LIKE '%BNB%' OR p.symbol LIKE '%XRP%' 
            OR p.symbol LIKE '%ADA%' OR p.symbol LIKE '%DOGE%' OR p.symbol LIKE '%MATIC%' 
            OR p.symbol LIKE '%DOT%' OR p.symbol LIKE '%AVAX%' OR p.symbol LIKE '%LINK%' 
          THEN 'MAJOR'
          ELSE 'ALTCOIN'
        END
      ) as symbol_category
    FROM positions p
    WHERE p.status = 'closed' 
      AND p.realized_pnl IS NOT NULL
  )
  SELECT 
    pmd.sizing_type::text as position_sizing_type,
    pmd.margin_bucket::text,
    pmd.symbol_category::text,
    COUNT(*)::bigint as count,
    ROUND((COUNT(*) FILTER (WHERE pmd.realized_pnl > 0)::numeric / COUNT(*)::numeric * 100), 1) as win_rate,
    ROUND(AVG(pmd.realized_pnl), 2) as avg_pnl,
    ROUND(SUM(pmd.realized_pnl), 2) as total_pnl
  FROM position_mm_data pmd
  GROUP BY pmd.sizing_type, pmd.margin_bucket, pmd.symbol_category
  ORDER BY total_pnl DESC;
END;
$function$;