-- Function to get R:R ratio statistics
CREATE OR REPLACE FUNCTION public.get_rr_stats()
RETURNS TABLE(
  tp1_rr_bucket numeric,
  count bigint,
  win_rate numeric,
  avg_pnl numeric,
  total_pnl numeric
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN a.tp1 IS NULL OR a.entry_price = 0 THEN 0
      WHEN a.side = 'BUY' THEN 
        ROUND(((a.tp1 - a.entry_price) / (a.entry_price - a.sl))::numeric, 1)
      ELSE 
        ROUND(((a.entry_price - a.tp1) / (a.sl - a.entry_price))::numeric, 1)
    END as tp1_rr_bucket,
    COUNT(*)::bigint as count,
    ROUND((COUNT(*) FILTER (WHERE p.realized_pnl > 0)::numeric / COUNT(*)::numeric * 100), 1) as win_rate,
    ROUND(AVG(p.realized_pnl), 2) as avg_pnl,
    ROUND(SUM(p.realized_pnl), 2) as total_pnl
  FROM positions p
  LEFT JOIN alerts a ON p.alert_id = a.id
  WHERE p.status = 'closed' 
    AND p.realized_pnl IS NOT NULL
    AND a.tp1 IS NOT NULL
    AND a.entry_price > 0
    AND a.sl > 0
  GROUP BY tp1_rr_bucket
  HAVING COUNT(*) >= 3  -- Only show buckets with at least 3 trades
  ORDER BY win_rate DESC;
END;
$function$;

-- Function to get TP distribution statistics
CREATE OR REPLACE FUNCTION public.get_tp_distribution_stats()
RETURNS TABLE(
  close_reason text,
  count bigint,
  win_rate numeric,
  avg_pnl numeric,
  avg_tp1_close_pct numeric,
  tp_levels_used integer
) 
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(p.close_reason, 'Unknown') as close_reason,
    COUNT(*)::bigint as count,
    ROUND((COUNT(*) FILTER (WHERE p.realized_pnl > 0)::numeric / COUNT(*)::numeric * 100), 1) as win_rate,
    ROUND(AVG(p.realized_pnl), 2) as avg_pnl,
    ROUND(AVG(
      CASE 
        WHEN a.tp1 IS NOT NULL THEN
          CASE 
            WHEN a.tp2 IS NOT NULL AND a.tp3 IS NOT NULL THEN 33.33
            WHEN a.tp2 IS NOT NULL THEN 50.0
            ELSE 100.0
          END
        ELSE NULL
      END
    ), 1) as avg_tp1_close_pct,
    CASE 
      WHEN COUNT(*) FILTER (WHERE a.tp3 IS NOT NULL) > 0 THEN 3
      WHEN COUNT(*) FILTER (WHERE a.tp2 IS NOT NULL) > 0 THEN 2
      WHEN COUNT(*) FILTER (WHERE a.tp1 IS NOT NULL) > 0 THEN 1
      ELSE 0
    END as tp_levels_used
  FROM positions p
  LEFT JOIN alerts a ON p.alert_id = a.id
  WHERE p.status = 'closed' AND p.realized_pnl IS NOT NULL
  GROUP BY p.close_reason
  ORDER BY count DESC;
END;
$function$;