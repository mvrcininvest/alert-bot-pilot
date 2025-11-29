-- Create RPC functions for trading statistics

-- Function to get margin bucket statistics
CREATE OR REPLACE FUNCTION get_margin_bucket_stats()
RETURNS TABLE (
  margin_bucket text,
  count bigint,
  win_rate numeric,
  avg_pnl numeric,
  total_pnl numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    CASE 
      WHEN (p.entry_price * p.quantity / p.leverage) < 1 THEN '<1 USDT'
      WHEN (p.entry_price * p.quantity / p.leverage) < 2 THEN '1-2 USDT'
      WHEN (p.entry_price * p.quantity / p.leverage) < 5 THEN '2-5 USDT'
      ELSE '>5 USDT'
    END as margin_bucket,
    COUNT(*)::bigint as count,
    ROUND((COUNT(*) FILTER (WHERE p.realized_pnl > 0)::numeric / COUNT(*)::numeric * 100), 1) as win_rate,
    ROUND(AVG(p.realized_pnl), 2) as avg_pnl,
    ROUND(SUM(p.realized_pnl), 2) as total_pnl
  FROM positions p
  WHERE p.status = 'closed' AND p.realized_pnl IS NOT NULL
  GROUP BY margin_bucket
  ORDER BY win_rate DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get tier statistics
CREATE OR REPLACE FUNCTION get_tier_stats()
RETURNS TABLE (
  tier text,
  count bigint,
  win_rate numeric,
  avg_pnl numeric,
  total_pnl numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    COALESCE(a.tier, 'Unknown') as tier,
    COUNT(*)::bigint as count,
    ROUND((COUNT(*) FILTER (WHERE p.realized_pnl > 0)::numeric / COUNT(*)::numeric * 100), 1) as win_rate,
    ROUND(AVG(p.realized_pnl), 2) as avg_pnl,
    ROUND(SUM(p.realized_pnl), 2) as total_pnl
  FROM positions p
  LEFT JOIN alerts a ON p.alert_id = a.id
  WHERE p.status = 'closed' AND p.realized_pnl IS NOT NULL
  GROUP BY a.tier
  ORDER BY win_rate DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to get leverage statistics
CREATE OR REPLACE FUNCTION get_leverage_stats()
RETURNS TABLE (
  leverage integer,
  count bigint,
  win_rate numeric,
  avg_pnl numeric,
  total_pnl numeric
) AS $$
BEGIN
  RETURN QUERY
  SELECT 
    p.leverage,
    COUNT(*)::bigint as count,
    ROUND((COUNT(*) FILTER (WHERE p.realized_pnl > 0)::numeric / COUNT(*)::numeric * 100), 1) as win_rate,
    ROUND(AVG(p.realized_pnl), 2) as avg_pnl,
    ROUND(SUM(p.realized_pnl), 2) as total_pnl
  FROM positions p
  WHERE p.status = 'closed' AND p.realized_pnl IS NOT NULL
  GROUP BY p.leverage
  ORDER BY win_rate DESC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;