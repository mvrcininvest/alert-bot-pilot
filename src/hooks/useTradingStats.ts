import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TradingStats {
  totalTrades: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
  bestMarginBucket: string;
  bestMarginWinRate: number;
  bestMarginAvgPnl: number;
  worstMarginBucket: string;
  worstMarginWinRate: number;
  bestTier: string;
  bestTierWinRate: number;
  bestTierTotalPnl: number;
  bestLeverage: number;
  bestLeverageWinRate: number;
  marginBucketStats: Array<{
    margin_bucket: string;
    count: number;
    win_rate: number;
    avg_pnl: number;
    total_pnl: number;
  }>;
  tierStats: Array<{
    tier: string;
    count: number;
    win_rate: number;
    avg_pnl: number;
    total_pnl: number;
  }>;
  leverageStats: Array<{
    leverage: number;
    count: number;
    win_rate: number;
    avg_pnl: number;
    total_pnl: number;
  }>;
  // R:R Analysis
  bestTP1RR: number;
  bestTP1RRWinRate: number;
  rrStats: Array<{
    tp1_rr_bucket: number;
    count: number;
    win_rate: number;
    avg_pnl: number;
    total_pnl: number;
  }>;
  // TP Distribution Analysis
  optimalTPLevels: number;
  optimalTP1ClosePct: number;
  optimalTP2ClosePct: number;
  tpDistributionStats: Array<{
    close_reason: string;
    count: number;
    win_rate: number;
    avg_pnl: number;
    avg_tp1_close_pct: number;
    tp_levels_used: number;
  }>;
  // Money Management
  moneyManagementStats: Array<{
    position_sizing_type: string;
    margin_bucket: string;
    symbol_category: string;
    count: number;
    win_rate: number;
    avg_pnl: number;
    total_pnl: number;
  }>;
  // Derived
  recommendedSLPercent: number;
}

export function useTradingStats() {
  return useQuery<TradingStats>({
    queryKey: ['trading-stats'],
    queryFn: async () => {
      // Fetch margin bucket statistics
      const { data: marginStats, error: marginError } = await supabase
        .rpc('get_margin_bucket_stats');
      
      if (marginError) throw marginError;

      // Fetch tier statistics
      const { data: tierStats, error: tierError } = await supabase
        .rpc('get_tier_stats');
      
      if (tierError) throw tierError;

      // Fetch leverage statistics
      const { data: leverageStats, error: leverageError } = await supabase
        .rpc('get_leverage_stats');
      
      if (leverageError) throw leverageError;

      // Fetch R:R statistics
      const { data: rrStats, error: rrError } = await supabase
        .rpc('get_rr_stats');
      
      if (rrError) throw rrError;

      // Fetch TP distribution statistics
      const { data: tpDistributionStats, error: tpDistError } = await supabase
        .rpc('get_tp_distribution_stats');
      
      if (tpDistError) throw tpDistError;

      // Fetch Money Management statistics
      const { data: mmStats, error: mmError } = await supabase
        .rpc('get_money_management_stats');
      
      if (mmError) throw mmError;

      // Calculate aggregates
      const totalTrades = marginStats?.reduce((sum: number, m: any) => sum + Number(m.count), 0) || 0;
      const totalPnl = marginStats?.reduce((sum: number, m: any) => sum + Number(m.total_pnl), 0) || 0;
      const avgPnl = totalTrades > 0 ? totalPnl / totalTrades : 0;
      
      // Calculate overall win rate
      const totalWins = marginStats?.reduce((sum: number, m: any) => {
        const wins = (Number(m.win_rate) / 100) * Number(m.count);
        return sum + wins;
      }, 0) || 0;
      const winRate = totalTrades > 0 ? (totalWins / totalTrades) * 100 : 0;

      // Find best margin bucket
      const bestMargin = marginStats?.reduce((best: any, curr: any) => 
        Number(curr.win_rate) > Number(best.win_rate) ? curr : best
      , marginStats[0]);

      // Find worst margin bucket
      const worstMargin = marginStats?.reduce((worst: any, curr: any) => 
        Number(curr.win_rate) < Number(worst.win_rate) ? curr : worst
      , marginStats[0]);

      // Find best tier
      const bestTier = tierStats?.reduce((best: any, curr: any) => 
        Number(curr.win_rate) > Number(best.win_rate) ? curr : best
      , tierStats?.[0]);

      // Find best leverage
      const bestLeverage = leverageStats?.reduce((best: any, curr: any) => 
        Number(curr.win_rate) > Number(best.win_rate) ? curr : best
      , leverageStats?.[0]);

      // Find best R:R
      const bestRR = rrStats?.reduce((best: any, curr: any) => 
        Number(curr.win_rate) > Number(best.win_rate) ? curr : best
      , rrStats?.[0]);

      // Find optimal TP levels and close percentages
      const tpLevelAnalysis = tpDistributionStats?.find((stat: any) => stat.close_reason === 'TP1') || tpDistributionStats?.[0];
      const optimalTPLevels = tpLevelAnalysis?.tp_levels_used || 1;
      const optimalTP1ClosePct = optimalTPLevels === 1 ? 100 : (optimalTPLevels === 2 ? 50 : 33.33);
      const optimalTP2ClosePct = optimalTPLevels === 2 ? 50 : (optimalTPLevels === 3 ? 33.33 : 0);

      // Calculate recommended SL percent (average from data)
      const avgSLPercent = marginStats?.reduce((sum: number, m: any) => {
        return sum + (Number(m.avg_pnl) < 0 ? 1.0 : 0.5);
      }, 0) / (marginStats?.length || 1) || 1.0;

      return {
        totalTrades,
        winRate: Number(winRate.toFixed(1)),
        avgPnl: Number(avgPnl.toFixed(2)),
        totalPnl: Number(totalPnl.toFixed(2)),
        bestMarginBucket: bestMargin?.margin_bucket || 'N/A',
        bestMarginWinRate: Number(bestMargin?.win_rate) || 0,
        bestMarginAvgPnl: Number(bestMargin?.avg_pnl) || 0,
        worstMarginBucket: worstMargin?.margin_bucket || 'N/A',
        worstMarginWinRate: Number(worstMargin?.win_rate) || 0,
        bestTier: bestTier?.tier || 'N/A',
        bestTierWinRate: Number(bestTier?.win_rate) || 0,
        bestTierTotalPnl: Number(bestTier?.total_pnl) || 0,
        bestLeverage: Number(bestLeverage?.leverage) || 0,
        bestLeverageWinRate: Number(bestLeverage?.win_rate) || 0,
        marginBucketStats: marginStats || [],
        tierStats: tierStats || [],
        leverageStats: leverageStats || [],
        // R:R Analysis
        bestTP1RR: Number(bestRR?.tp1_rr_bucket) || 1.5,
        bestTP1RRWinRate: Number(bestRR?.win_rate) || 0,
        rrStats: rrStats || [],
        // TP Distribution
        optimalTPLevels: optimalTPLevels,
        optimalTP1ClosePct: optimalTP1ClosePct,
        optimalTP2ClosePct: optimalTP2ClosePct,
        tpDistributionStats: tpDistributionStats || [],
        // Money Management
        moneyManagementStats: mmStats || [],
        // Derived
        recommendedSLPercent: Number(avgSLPercent.toFixed(2)),
      };
    },
    staleTime: 2 * 60 * 1000, // Cache for 2 minutes
  });
}
