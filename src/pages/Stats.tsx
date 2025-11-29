import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Download, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useState, useMemo } from "react";
import { TimeFilters, type TimeFilter } from "@/components/stats/TimeFilters";
import { TierAnalysisCard } from "@/components/stats/TierAnalysisCard";
import { CloseReasonChart } from "@/components/stats/CloseReasonChart";
import { EquityCurve } from "@/components/stats/EquityCurve";
import { SessionAnalysisCard } from "@/components/stats/SessionAnalysisCard";
import { SignalStrengthCard } from "@/components/stats/SignalStrengthCard";
import { DurationAnalysisCard } from "@/components/stats/DurationAnalysisCard";
import { RegimeAnalysisCard } from "@/components/stats/RegimeAnalysisCard";
import { TimeBasedAnalysis } from "@/components/stats/TimeBasedAnalysis";
import { ROIAnalysisCard } from "@/components/stats/ROIAnalysisCard";
import { AdvancedMetricsCard } from "@/components/stats/AdvancedMetricsCard";
import { MonthlyComparison } from "@/components/stats/MonthlyComparison";
import { BTCCorrelationCard } from "@/components/stats/BTCCorrelationCard";
import { ZoneTypeCard } from "@/components/stats/ZoneTypeCard";
import { ModeAnalysisCard } from "@/components/stats/ModeAnalysisCard";
import { VolatilityAnalysisCard } from "@/components/stats/VolatilityAnalysisCard";
import { LatencyAnalysisCard } from "@/components/stats/LatencyAnalysisCard";
import { exportToCSV, exportStatsToCSV } from "@/lib/exportStats";
import { startOfDay, subDays, isAfter, isBefore, format, getDay, startOfMonth, endOfMonth } from "date-fns";
import { pl } from "date-fns/locale";
import { FileDown, Wrench } from "lucide-react";

// Helper function: Get raw data with fallback to metadata
function getRawDataWithFallback(position: any): any {
  const alert = Array.isArray(position.alerts) ? position.alerts[0] : position.alerts;
  return alert?.raw_data || (position.metadata as any)?.alert_data || {};
}

// Helper function: Get session from UTC time
function getSessionFromTime(dateStr: string): string {
  const hour = new Date(dateStr).getUTCHours();
  // Sydney: 21:00-06:00 UTC
  if (hour >= 21 || hour < 6) return 'Sydney';
  // Asia: 00:00-09:00 UTC (overlaps with Sydney)
  if (hour >= 0 && hour < 9) return 'Asia';
  // London: 07:00-16:00 UTC
  if (hour >= 7 && hour < 16) return 'London';
  // NY: 12:00-21:00 UTC
  if (hour >= 12 && hour < 21) return 'NY';
  return 'Off-Hours';
}

// Helper function: Determine close reason from prices
function determineCloseReason(position: any): string {
  const { close_price, entry_price, sl_price, tp1_price, tp2_price, tp3_price, 
          side, tp1_filled, tp2_filled, tp3_filled, close_reason } = position;
  
  // If already valid reason
  if (['tp1_hit', 'tp2_hit', 'tp3_hit', 'sl_hit', 'manual'].includes(close_reason)) {
    return close_reason.includes('tp1') ? 'TP1' : 
           close_reason.includes('tp2') ? 'TP2' : 
           close_reason.includes('tp3') ? 'TP3' : 
           close_reason.includes('sl') ? 'SL' : 'Manual';
  }
  
  // If filled flags are set
  if (tp3_filled) return 'TP3';
  if (tp2_filled) return 'TP2';
  if (tp1_filled) return 'TP1';
  
  // Determine from price comparison
  const cp = Number(close_price);
  const ep = Number(entry_price);
  const sl = Number(sl_price);
  const tp1 = tp1_price ? Number(tp1_price) : null;
  const tp2 = tp2_price ? Number(tp2_price) : null;
  const tp3 = tp3_price ? Number(tp3_price) : null;
  const isBuy = side === 'BUY';
  
  const tolerance = 0.005; // 0.5% tolerance
  
  if (isBuy) {
    // BUY: profit when price rises
    if (sl && cp <= sl * (1 + tolerance)) return 'SL';
    if (tp3 && cp >= tp3 * (1 - tolerance)) return 'TP3';
    if (tp2 && cp >= tp2 * (1 - tolerance)) return 'TP2';
    if (tp1 && cp >= tp1 * (1 - tolerance)) return 'TP1';
    return cp > ep ? 'Profit' : 'SL';
  } else {
    // SELL: profit when price falls
    if (sl && cp >= sl * (1 - tolerance)) return 'SL';
    if (tp3 && cp <= tp3 * (1 + tolerance)) return 'TP3';
    if (tp2 && cp <= tp2 * (1 + tolerance)) return 'TP2';
    if (tp1 && cp <= tp1 * (1 + tolerance)) return 'TP1';
    return cp < ep ? 'Profit' : 'SL';
  }
}

export default function Stats() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [isImporting, setIsImporting] = useState(false);
  const [timeFilter, setTimeFilter] = useState<TimeFilter>("30d");
  const [customRange, setCustomRange] = useState<{ from: Date | undefined; to: Date | undefined }>({
    from: undefined,
    to: undefined,
  });

  const importMutation = useMutation({
    mutationFn: async (days: number) => {
      const { data, error } = await supabase.functions.invoke('import-history', {
        body: { days }
      });
      
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["all-positions-stats"] });
      toast({
        title: "Import zakończony",
        description: `Zaimportowano ${data.imported} pozycji (${data.skipped} pominiętych duplikatów)`,
      });
      setIsImporting(false);
    },
    onError: (error: Error) => {
      toast({
        title: "Błąd importu",
        description: error.message,
        variant: "destructive",
      });
      setIsImporting(false);
    },
  });

  const handleImport = (days: number) => {
    setIsImporting(true);
    importMutation.mutate(days);
  };

  // Repair history data mutation
  const repairMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('repair-history-data');
      if (error) throw error;
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["all-positions-stats"] });
      toast({
        title: "Naprawa zakończona",
        description: `Naprawiono ${data.updated} pozycji`,
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Błąd naprawy",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  const { data: allPositions } = useQuery({
    queryKey: ["all-positions-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select(`
          *,
          alerts (
            is_test,
            tier,
            strength,
            mode,
            raw_data,
            atr,
            latency_ms,
            latency_webhook_ms,
            latency_execution_ms,
            tv_timestamp,
            exchange_executed_at
          )
        `)
        .eq("status", "closed")
        .like("symbol", "%USDT")
        .neq("close_reason", "error")
        .order("closed_at", { ascending: true });
      
      if (error) throw error;
      
      // Filter out test alerts
      return (data || []).filter(position => {
        if (!position.alert_id) return true;
        const alert = Array.isArray(position.alerts) ? position.alerts[0] : position.alerts;
        return alert && !alert.is_test;
      });
    },
    refetchInterval: 30000,
  });

  const { data: allAlerts } = useQuery({
    queryKey: ["all-alerts-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select("*")
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
  });

  // Filter positions by time
  const filteredPositions = useMemo(() => {
    if (!allPositions) return [];
    
    const now = new Date();
    let startDate: Date;
    
    switch (timeFilter) {
      case "today":
        startDate = startOfDay(now);
        break;
      case "7d":
        startDate = subDays(now, 7);
        break;
      case "30d":
        startDate = subDays(now, 30);
        break;
      case "90d":
        startDate = subDays(now, 90);
        break;
      case "custom":
        if (!customRange.from || !customRange.to) return allPositions;
        return allPositions.filter(p => {
          const closedAt = new Date(p.closed_at!);
          return isAfter(closedAt, customRange.from!) && isBefore(closedAt, customRange.to!);
        });
      case "all":
      default:
        return allPositions;
    }
    
    return allPositions.filter(p => {
      const closedAt = new Date(p.closed_at!);
      return isAfter(closedAt, startDate);
    });
  }, [allPositions, timeFilter, customRange]);

  // Filter alerts by time
  const filteredAlerts = useMemo(() => {
    if (!allAlerts) return [];
    
    const now = new Date();
    let startDate: Date;
    
    switch (timeFilter) {
      case "today":
        startDate = startOfDay(now);
        break;
      case "7d":
        startDate = subDays(now, 7);
        break;
      case "30d":
        startDate = subDays(now, 30);
        break;
      case "90d":
        startDate = subDays(now, 90);
        break;
      case "custom":
        if (!customRange.from || !customRange.to) return allAlerts;
        return allAlerts.filter(a => {
          const createdAt = new Date(a.created_at);
          return isAfter(createdAt, customRange.from!) && isBefore(createdAt, customRange.to!);
        });
      case "all":
      default:
        return allAlerts;
    }
    
    return allAlerts.filter(a => {
      const createdAt = new Date(a.created_at);
      return isAfter(createdAt, startDate);
    });
  }, [allAlerts, timeFilter, customRange]);

  // Calculate statistics
  const stats = useMemo(() => {
    if (!filteredPositions || filteredPositions.length === 0) return null;

    const wins = filteredPositions.filter(p => Number(p.realized_pnl || 0) > 0);
    const losses = filteredPositions.filter(p => Number(p.realized_pnl || 0) < 0);
    
    const totalPnL = filteredPositions.reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0);
    const totalWins = wins.reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0);
    const totalLosses = Math.abs(losses.reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0));

    // Calculate expectancy
    const avgWin = wins.length > 0 ? totalWins / wins.length : 0;
    const avgLoss = losses.length > 0 ? totalLosses / losses.length : 0;
    const winRate = (wins.length / filteredPositions.length);
    const expectancy = (winRate * avgWin) - ((1 - winRate) * avgLoss);

    // Calculate avg position time
    const totalDuration = filteredPositions.reduce((sum, p) => {
      if (!p.created_at || !p.closed_at) return sum;
      return sum + (new Date(p.closed_at).getTime() - new Date(p.created_at).getTime());
    }, 0);
    const avgDurationMs = filteredPositions.length > 0 ? totalDuration / filteredPositions.length : 0;
    const avgDurationMinutes = avgDurationMs / (1000 * 60);

    // Calculate max drawdown
    let peak = 0;
    let maxDrawdown = 0;
    let cumulativePnL = 0;
    
    filteredPositions.forEach(p => {
      cumulativePnL += Number(p.realized_pnl || 0);
      if (cumulativePnL > peak) peak = cumulativePnL;
      const drawdown = peak - cumulativePnL;
      if (drawdown > maxDrawdown) maxDrawdown = drawdown;
    });

    // Calculate consecutive streaks
    let currentStreak = 0;
    let bestWinStreak = 0;
    let worstLossStreak = 0;
    let lastWasWin = false;

    filteredPositions.forEach(p => {
      const isWin = Number(p.realized_pnl || 0) > 0;
      if (isWin === lastWasWin) {
        currentStreak++;
      } else {
        currentStreak = 1;
        lastWasWin = isWin;
      }
      
      if (isWin && currentStreak > bestWinStreak) {
        bestWinStreak = currentStreak;
      } else if (!isWin && currentStreak > worstLossStreak) {
        worstLossStreak = currentStreak;
      }
    });

    // Calculate closing transactions (like Bitget counts)
    const closingTransactions = filteredPositions.reduce((sum, p) => {
      let count = 1; // base: final close
      if (p.tp1_filled) count++;
      if (p.tp2_filled) count++;
      if (p.tp3_filled) count++;
      return sum + count;
    }, 0);

    // Winning transactions (each TP fill + profitable final closes)
    const winningTransactions = filteredPositions.reduce((sum, p) => {
      let wins = 0;
      if (p.tp1_filled) wins++;
      if (p.tp2_filled) wins++;
      if (p.tp3_filled) wins++;
      if (Number(p.realized_pnl || 0) > 0) wins++; // final close was profitable
      return sum + wins;
    }, 0);

    return {
      totalPnL,
      totalTrades: filteredPositions.length,
      winningTrades: wins.length,
      losingTrades: losses.length,
      winRate: winRate * 100,
      avgWin,
      avgLoss,
      profitFactor: totalLosses > 0 ? totalWins / totalLosses : 0,
      largestWin: Math.max(...filteredPositions.map(p => Number(p.realized_pnl || 0))),
      largestLoss: Math.min(...filteredPositions.map(p => Number(p.realized_pnl || 0))),
      expectancy,
      avgDurationMinutes,
      maxDrawdown,
      bestWinStreak,
      worstLossStreak,
      closingTransactions,
      winningTransactions,
      transactionWinRate: closingTransactions > 0 
        ? (winningTransactions / closingTransactions) * 100 
        : 0,
    };
  }, [filteredPositions]);

  // Tier analysis
  const tierStats = useMemo(() => {
    if (!filteredPositions) return [];
    
    const tierMap = new Map<string, {
      tier: string;
      trades: number;
      wins: number;
      losses: number;
      totalPnL: number;
      winsPnL: number;
      lossesPnL: number;
    }>();

    filteredPositions.forEach(p => {
      const alert = Array.isArray(p.alerts) ? p.alerts[0] : p.alerts;
      const tier = alert?.tier || "Unknown";
      const pnl = Number(p.realized_pnl || 0);
      const isWin = pnl > 0;

      if (!tierMap.has(tier)) {
        tierMap.set(tier, {
          tier,
          trades: 0,
          wins: 0,
          losses: 0,
          totalPnL: 0,
          winsPnL: 0,
          lossesPnL: 0,
        });
      }

      const stats = tierMap.get(tier)!;
      stats.trades++;
      stats.totalPnL += pnl;
      if (isWin) {
        stats.wins++;
        stats.winsPnL += pnl;
      } else {
        stats.losses++;
        stats.lossesPnL += pnl;
      }
    });

    return Array.from(tierMap.values())
      .map(t => ({
        tier: t.tier,
        trades: t.trades,
        wins: t.wins,
        losses: t.losses,
        winRate: (t.wins / t.trades) * 100,
        totalPnL: t.totalPnL,
        avgWin: t.wins > 0 ? t.winsPnL / t.wins : 0,
        avgLoss: t.losses > 0 ? t.lossesPnL / t.losses : 0,
      }))
      .sort((a, b) => b.totalPnL - a.totalPnL);
  }, [filteredPositions]);

  // Close reason analysis
  const closeReasonStats = useMemo(() => {
    if (!filteredPositions) return [];
    
    const reasonMap = new Map<string, number>();
    
    filteredPositions.forEach(p => {
      const reason = determineCloseReason(p);
      reasonMap.set(reason, (reasonMap.get(reason) || 0) + 1);
    });

    const total = filteredPositions.length;
    return Array.from(reasonMap.entries())
      .map(([reason, count]) => ({
        reason,
        count,
        percentage: (count / total) * 100,
      }))
      .sort((a, b) => b.count - a.count);
  }, [filteredPositions]);

  // Session analysis
  const sessionStats = useMemo(() => {
    if (!filteredPositions) return [];
    
    const sessionMap = new Map<string, {
      session: string;
      trades: number;
      wins: number;
      losses: number;
      totalPnL: number;
      winsPnL: number;
    }>();

    filteredPositions.forEach(p => {
      const rawData = getRawDataWithFallback(p);
      // Priority: alert data, fallback: compute from time
      const session = rawData?.timing?.session || getSessionFromTime(p.created_at);
      const pnl = Number(p.realized_pnl || 0);
      const isWin = pnl > 0;

      if (!sessionMap.has(session)) {
        sessionMap.set(session, {
          session,
          trades: 0,
          wins: 0,
          losses: 0,
          totalPnL: 0,
          winsPnL: 0,
        });
      }

      const stats = sessionMap.get(session)!;
      stats.trades++;
      stats.totalPnL += pnl;
      if (isWin) {
        stats.wins++;
        stats.winsPnL += pnl;
      } else {
        stats.losses++;
      }
    });

    return Array.from(sessionMap.values())
      .map(s => ({
        session: s.session,
        trades: s.trades,
        wins: s.wins,
        losses: s.losses,
        winRate: (s.wins / s.trades) * 100,
        totalPnL: s.totalPnL,
        avgPnL: s.totalPnL / s.trades,
      }))
      .sort((a, b) => b.totalPnL - a.totalPnL);
  }, [filteredPositions]);

  // Signal strength analysis
  const strengthStats = useMemo(() => {
    if (!filteredPositions) return [];
    
    const ranges = [
      { min: 0.8, max: 1.0, label: "0.8-1.0" },
      { min: 0.6, max: 0.8, label: "0.6-0.8" },
      { min: 0.4, max: 0.6, label: "0.4-0.6" },
      { min: 0.2, max: 0.4, label: "0.2-0.4" },
      { min: 0, max: 0.2, label: "0.0-0.2" },
    ];

    const rangeMap = new Map<string, {
      range: string;
      trades: number;
      wins: number;
      totalPnL: number;
    }>();

    filteredPositions.forEach(p => {
      const alert = Array.isArray(p.alerts) ? p.alerts[0] : p.alerts;
      const strength = alert?.strength || 0;
      const pnl = Number(p.realized_pnl || 0);
      const isWin = pnl > 0;

      const matchingRange = ranges.find(r => strength >= r.min && strength < r.max);
      if (!matchingRange) return;

      const label = matchingRange.label;
      if (!rangeMap.has(label)) {
        rangeMap.set(label, {
          range: label,
          trades: 0,
          wins: 0,
          totalPnL: 0,
        });
      }

      const stats = rangeMap.get(label)!;
      stats.trades++;
      stats.totalPnL += pnl;
      if (isWin) stats.wins++;
    });

    return ranges
      .map(r => {
        const stats = rangeMap.get(r.label);
        if (!stats) return null;
        return {
          range: stats.range,
          trades: stats.trades,
          wins: stats.wins,
          winRate: (stats.wins / stats.trades) * 100,
          avgPnL: stats.totalPnL / stats.trades,
          totalPnL: stats.totalPnL,
        };
      })
      .filter(Boolean) as any[];
  }, [filteredPositions]);

  // Duration analysis
  const durationStats = useMemo(() => {
    if (!filteredPositions) return [];
    
    const ranges = [
      { min: 0, max: 5, label: "< 5 min" },
      { min: 5, max: 30, label: "5-30 min" },
      { min: 30, max: 120, label: "30min - 2h" },
      { min: 120, max: Infinity, label: "> 2h" },
    ];

    const rangeMap = new Map<string, {
      range: string;
      trades: number;
      wins: number;
      losses: number;
      totalPnL: number;
    }>();

    filteredPositions.forEach(p => {
      if (!p.created_at || !p.closed_at) return;
      
      const durationMs = new Date(p.closed_at).getTime() - new Date(p.created_at).getTime();
      const durationMinutes = durationMs / (1000 * 60);
      const pnl = Number(p.realized_pnl || 0);
      const isWin = pnl > 0;

      const matchingRange = ranges.find(r => durationMinutes >= r.min && durationMinutes < r.max);
      if (!matchingRange) return;

      const label = matchingRange.label;
      if (!rangeMap.has(label)) {
        rangeMap.set(label, {
          range: label,
          trades: 0,
          wins: 0,
          losses: 0,
          totalPnL: 0,
        });
      }

      const stats = rangeMap.get(label)!;
      stats.trades++;
      stats.totalPnL += pnl;
      if (isWin) stats.wins++;
      else stats.losses++;
    });

    return ranges
      .map(r => {
        const stats = rangeMap.get(r.label);
        if (!stats) return null;
        return {
          range: stats.range,
          trades: stats.trades,
          wins: stats.wins,
          losses: stats.losses,
          winRate: (stats.wins / stats.trades) * 100,
          avgPnL: stats.totalPnL / stats.trades,
          totalPnL: stats.totalPnL,
        };
      })
      .filter(Boolean) as any[];
  }, [filteredPositions]);

  // Regime analysis
  const regimeStats = useMemo(() => {
    if (!filteredPositions) return [];
    
    const regimeMap = new Map<string, {
      regime: string;
      trades: number;
      wins: number;
      losses: number;
      totalPnL: number;
    }>();

    filteredPositions.forEach(p => {
      const alert = Array.isArray(p.alerts) ? p.alerts[0] : p.alerts;
      const rawData = alert?.raw_data as any;
      const regime = rawData?.diagnostics?.regime || "Unknown";
      const pnl = Number(p.realized_pnl || 0);
      const isWin = pnl > 0;

      if (!regimeMap.has(regime)) {
        regimeMap.set(regime, {
          regime,
          trades: 0,
          wins: 0,
          losses: 0,
          totalPnL: 0,
        });
      }

      const stats = regimeMap.get(regime)!;
      stats.trades++;
      stats.totalPnL += pnl;
      if (isWin) stats.wins++;
      else stats.losses++;
    });

    return Array.from(regimeMap.values())
      .map(r => ({
        regime: r.regime,
        trades: r.trades,
        wins: r.wins,
        losses: r.losses,
        winRate: (r.wins / r.trades) * 100,
        totalPnL: r.totalPnL,
        avgPnL: r.totalPnL / r.trades,
      }))
      .sort((a, b) => b.totalPnL - a.totalPnL);
  }, [filteredPositions]);

  // Hourly analysis
  const hourlyStats = useMemo(() => {
    if (!filteredPositions) return [];
    
    const hourMap = new Map<number, {
      hour: number;
      trades: number;
      wins: number;
      totalPnL: number;
    }>();

    filteredPositions.forEach(p => {
      if (!p.closed_at) return;
      
      const hour = new Date(p.closed_at).getHours();
      const pnl = Number(p.realized_pnl || 0);
      const isWin = pnl > 0;

      if (!hourMap.has(hour)) {
        hourMap.set(hour, {
          hour,
          trades: 0,
          wins: 0,
          totalPnL: 0,
        });
      }

      const stats = hourMap.get(hour)!;
      stats.trades++;
      stats.totalPnL += pnl;
      if (isWin) stats.wins++;
    });

    return Array.from(hourMap.values())
      .map(h => ({
        hour: h.hour,
        trades: h.trades,
        wins: h.wins,
        winRate: (h.wins / h.trades) * 100,
        avgPnL: h.totalPnL / h.trades,
      }))
      .sort((a, b) => a.hour - b.hour);
  }, [filteredPositions]);

  // Daily analysis (day of week)
  const dailyStats = useMemo(() => {
    if (!filteredPositions) return [];
    
    const dayNames = ["Niedziela", "Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota"];
    const dayMap = new Map<string, {
      day: string;
      trades: number;
      wins: number;
      totalPnL: number;
    }>();

    filteredPositions.forEach(p => {
      if (!p.closed_at) return;
      
      const dayIndex = getDay(new Date(p.closed_at));
      const dayName = dayNames[dayIndex];
      const pnl = Number(p.realized_pnl || 0);
      const isWin = pnl > 0;

      if (!dayMap.has(dayName)) {
        dayMap.set(dayName, {
          day: dayName,
          trades: 0,
          wins: 0,
          totalPnL: 0,
        });
      }

      const stats = dayMap.get(dayName)!;
      stats.trades++;
      stats.totalPnL += pnl;
      if (isWin) stats.wins++;
    });

    return Array.from(dayMap.values())
      .map(d => ({
        day: d.day,
        trades: d.trades,
        wins: d.wins,
        winRate: (d.wins / d.trades) * 100,
        avgPnL: d.totalPnL / d.trades,
      }));
  }, [filteredPositions]);

  // ROI by leverage analysis
  const roiStats = useMemo(() => {
    if (!filteredPositions) return [];
    
    const ranges = [
      { min: 1, max: 10, label: "1x-10x" },
      { min: 10, max: 25, label: "10x-25x" },
      { min: 25, max: 50, label: "25x-50x" },
      { min: 50, max: 100, label: "50x-100x" },
      { min: 100, max: Infinity, label: "100x+" },
    ];

    const rangeMap = new Map<string, {
      range: string;
      trades: number;
      wins: number;
      totalPnL: number;
      totalMargin: number;
    }>();

    filteredPositions.forEach(p => {
      const leverage = p.leverage;
      const pnl = Number(p.realized_pnl || 0);
      const isWin = pnl > 0;
      
      // Calculate margin used (entry_price * quantity / leverage)
      const marginUsed = (p.entry_price * p.quantity) / leverage;

      const matchingRange = ranges.find(r => leverage >= r.min && leverage < r.max);
      if (!matchingRange) return;

      const label = matchingRange.label;
      if (!rangeMap.has(label)) {
        rangeMap.set(label, {
          range: label,
          trades: 0,
          wins: 0,
          totalPnL: 0,
          totalMargin: 0,
        });
      }

      const stats = rangeMap.get(label)!;
      stats.trades++;
      stats.totalPnL += pnl;
      stats.totalMargin += marginUsed;
      if (isWin) stats.wins++;
    });

    return ranges
      .map(r => {
        const stats = rangeMap.get(r.label);
        if (!stats) return null;
        const avgMargin = stats.totalMargin / stats.trades;
        const avgROI = (stats.totalPnL / stats.totalMargin) * 100;
        return {
          range: stats.range,
          trades: stats.trades,
          wins: stats.wins,
          avgROI,
          totalPnL: stats.totalPnL,
          avgMarginUsed: avgMargin,
        };
      })
      .filter(Boolean) as any[];
  }, [filteredPositions]);

  // Advanced metrics
  const advancedMetrics = useMemo(() => {
    if (!stats || !filteredPositions || filteredPositions.length === 0) {
      return {
        sharpeRatio: 0,
        sortinoRatio: 0,
        calmarRatio: 0,
        recoveryFactor: 0,
        avgRRR: 0,
        payoffRatio: 0,
      };
    }

    // Calculate returns for each trade
    const returns = filteredPositions.map(p => Number(p.realized_pnl || 0));
    const avgReturn = returns.reduce((sum, r) => sum + r, 0) / returns.length;
    
    // Standard deviation of returns
    const variance = returns.reduce((sum, r) => sum + Math.pow(r - avgReturn, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);
    
    // Sharpe Ratio (assuming risk-free rate = 0)
    const sharpeRatio = stdDev > 0 ? avgReturn / stdDev : 0;
    
    // Sortino Ratio (only negative returns)
    const negativeReturns = returns.filter(r => r < 0);
    const downside = negativeReturns.length > 0
      ? Math.sqrt(negativeReturns.reduce((sum, r) => sum + Math.pow(r, 2), 0) / negativeReturns.length)
      : 0;
    const sortinoRatio = downside > 0 ? avgReturn / downside : 0;
    
    // Calmar Ratio
    const calmarRatio = stats.maxDrawdown > 0 ? stats.totalPnL / stats.maxDrawdown : 0;
    
    // Recovery Factor
    const recoveryFactor = stats.maxDrawdown > 0 ? stats.totalPnL / stats.maxDrawdown : 0;
    
    // Average R:R Ratio (approximate from win/loss ratio and profit factor)
    const avgRRR = stats.avgLoss !== 0 ? Math.abs(stats.avgWin / stats.avgLoss) : 0;
    
    // Payoff Ratio
    const payoffRatio = stats.avgLoss !== 0 ? stats.avgWin / Math.abs(stats.avgLoss) : 0;

    return {
      sharpeRatio,
      sortinoRatio,
      calmarRatio,
      recoveryFactor,
      avgRRR,
      payoffRatio,
    };
  }, [stats, filteredPositions]);

  // Monthly comparison
  const monthlyData = useMemo(() => {
    if (!filteredPositions) return [];
    
    const monthMap = new Map<string, {
      month: string;
      trades: number;
      wins: number;
      totalPnL: number;
    }>();

    filteredPositions.forEach(p => {
      if (!p.closed_at) return;
      
      const date = new Date(p.closed_at);
      const monthKey = format(date, "yyyy-MM", { locale: pl });
      const monthLabel = format(date, "MMM yyyy", { locale: pl });
      const pnl = Number(p.realized_pnl || 0);
      const isWin = pnl > 0;

      if (!monthMap.has(monthKey)) {
        monthMap.set(monthKey, {
          month: monthLabel,
          trades: 0,
          wins: 0,
          totalPnL: 0,
        });
      }

      const stats = monthMap.get(monthKey)!;
      stats.trades++;
      stats.totalPnL += pnl;
      if (isWin) stats.wins++;
    });

    return Array.from(monthMap.values())
      .map(m => ({
        month: m.month,
        trades: m.trades,
        wins: m.wins,
        totalPnL: m.totalPnL,
        winRate: (m.wins / m.trades) * 100,
      }))
      .sort((a, b) => a.month.localeCompare(b.month));
  }, [filteredPositions]);

  // Latency Analysis
  const latencyAnalysis = useMemo(() => {
    if (!filteredPositions) return null;
    
    const validPositions = filteredPositions.filter(p => {
      const alert = Array.isArray(p.alerts) ? p.alerts[0] : p.alerts;
      return alert?.latency_ms && alert.latency_ms > 0;
    });
    
    if (validPositions.length === 0) return null;
    
    const latencies = validPositions.map(p => {
      const alert = Array.isArray(p.alerts) ? p.alerts[0] : p.alerts;
      return alert.latency_ms;
    });
    
    const sorted = [...latencies].sort((a, b) => a - b);
    
    return {
      count: latencies.length,
      min: Math.min(...latencies),
      max: Math.max(...latencies),
      avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  }, [filteredPositions]);

  // BTC Correlation analysis
  const btcCorrelationStats = useMemo(() => {
    if (!filteredPositions) return [];
    
    const ranges = [
      { min: 0.8, max: 1.0, label: "Wysoka (0.8-1.0)" },
      { min: 0.5, max: 0.8, label: "Średnia (0.5-0.8)" },
      { min: 0.2, max: 0.5, label: "Niska (0.2-0.5)" },
      { min: -0.2, max: 0.2, label: "Brak (-0.2-0.2)" },
      { min: -1.0, max: -0.2, label: "Negatywna (<-0.2)" },
    ];

    const rangeMap = new Map<string, {
      range: string;
      trades: number;
      wins: number;
      totalPnL: number;
    }>();

    filteredPositions.forEach(p => {
      const rawData = getRawDataWithFallback(p);
      const btcCorr = rawData?.smc_context?.btc_correlation;
      
      // Only process if we have actual value (not default 0)
      if (btcCorr === undefined || btcCorr === null) return;
      
      const pnl = Number(p.realized_pnl || 0);
      const isWin = pnl > 0;

      const matchingRange = ranges.find(r => btcCorr >= r.min && btcCorr < r.max);
      if (!matchingRange) return;

      const label = matchingRange.label;
      if (!rangeMap.has(label)) {
        rangeMap.set(label, {
          range: label,
          trades: 0,
          wins: 0,
          totalPnL: 0,
        });
      }

      const stats = rangeMap.get(label)!;
      stats.trades++;
      stats.totalPnL += pnl;
      if (isWin) stats.wins++;
    });

    return ranges
      .map(r => {
        const stats = rangeMap.get(r.label);
        if (!stats) return null;
        return {
          range: stats.range,
          trades: stats.trades,
          wins: stats.wins,
          winRate: (stats.wins / stats.trades) * 100,
          avgPnL: stats.totalPnL / stats.trades,
          totalPnL: stats.totalPnL,
        };
      })
      .filter(Boolean) as any[];
  }, [filteredPositions]);

  // Zone Type analysis
  const zoneTypeStats = useMemo(() => {
    if (!filteredPositions) return [];
    
    const zoneMap = new Map<string, {
      zoneType: string;
      trades: number;
      wins: number;
      totalPnL: number;
    }>();

    filteredPositions.forEach(p => {
      const rawData = getRawDataWithFallback(p);
      const zoneType = rawData?.zone_details?.zone_type || "Unknown";
      const pnl = Number(p.realized_pnl || 0);
      const isWin = pnl > 0;

      if (!zoneMap.has(zoneType)) {
        zoneMap.set(zoneType, {
          zoneType,
          trades: 0,
          wins: 0,
          totalPnL: 0,
        });
      }

      const stats = zoneMap.get(zoneType)!;
      stats.trades++;
      stats.totalPnL += pnl;
      if (isWin) stats.wins++;
    });

    return Array.from(zoneMap.values())
      .map(z => ({
        zoneType: z.zoneType,
        trades: z.trades,
        wins: z.wins,
        winRate: (z.wins / z.trades) * 100,
        avgPnL: z.totalPnL / z.trades,
        totalPnL: z.totalPnL,
      }))
      .sort((a, b) => b.totalPnL - a.totalPnL);
  }, [filteredPositions]);

  // Mode analysis
  const modeStats = useMemo(() => {
    if (!filteredPositions) return [];
    
    const modeMap = new Map<string, {
      mode: string;
      trades: number;
      wins: number;
      totalPnL: number;
    }>();

    filteredPositions.forEach(p => {
      const alert = Array.isArray(p.alerts) ? p.alerts[0] : p.alerts;
      const mode = alert?.mode || "Unknown";
      const pnl = Number(p.realized_pnl || 0);
      const isWin = pnl > 0;

      if (!modeMap.has(mode)) {
        modeMap.set(mode, {
          mode,
          trades: 0,
          wins: 0,
          totalPnL: 0,
        });
      }

      const stats = modeMap.get(mode)!;
      stats.trades++;
      stats.totalPnL += pnl;
      if (isWin) stats.wins++;
    });

    return Array.from(modeMap.values())
      .map(m => ({
        mode: m.mode,
        trades: m.trades,
        wins: m.wins,
        winRate: (m.wins / m.trades) * 100,
        avgPnL: m.totalPnL / m.trades,
        totalPnL: m.totalPnL,
      }))
      .sort((a, b) => b.totalPnL - a.totalPnL);
  }, [filteredPositions]);

  // Volatility (ATR) analysis
  const volatilityStats = useMemo(() => {
    if (!filteredPositions) return [];
    
    const ranges = [
      { min: 0, max: 0.0005, label: "< 0.0005" },
      { min: 0.0005, max: 0.001, label: "0.0005-0.001" },
      { min: 0.001, max: 0.002, label: "0.001-0.002" },
      { min: 0.002, max: 0.005, label: "0.002-0.005" },
      { min: 0.005, max: Infinity, label: "> 0.005" },
    ];

    const rangeMap = new Map<string, {
      range: string;
      trades: number;
      wins: number;
      totalPnL: number;
      totalATR: number;
    }>();

    filteredPositions.forEach(p => {
      const alert = Array.isArray(p.alerts) ? p.alerts[0] : p.alerts;
      const atr = alert?.atr || 0;
      const pnl = Number(p.realized_pnl || 0);
      const isWin = pnl > 0;

      const matchingRange = ranges.find(r => atr >= r.min && atr < r.max);
      if (!matchingRange) return;

      const label = matchingRange.label;
      if (!rangeMap.has(label)) {
        rangeMap.set(label, {
          range: label,
          trades: 0,
          wins: 0,
          totalPnL: 0,
          totalATR: 0,
        });
      }

      const stats = rangeMap.get(label)!;
      stats.trades++;
      stats.totalPnL += pnl;
      stats.totalATR += atr;
      if (isWin) stats.wins++;
    });

    return ranges
      .map(r => {
        const stats = rangeMap.get(r.label);
        if (!stats) return null;
        return {
          range: stats.range,
          trades: stats.trades,
          wins: stats.wins,
          winRate: (stats.wins / stats.trades) * 100,
          avgPnL: stats.totalPnL / stats.trades,
          totalPnL: stats.totalPnL,
          avgATR: stats.totalATR / stats.trades,
        };
      })
      .filter(Boolean) as any[];
  }, [filteredPositions]);

  // Helper: Get time filter label for export filenames
  const getTimeFilterLabel = () => {
    if (timeFilter === "custom" && customRange.from && customRange.to) {
      return `custom_${format(customRange.from, "yyyy-MM-dd")}_${format(customRange.to, "yyyy-MM-dd")}`;
    }
    return timeFilter === "all" ? "all" : timeFilter;
  };

  // Helper: Get time filter display text
  const getTimeFilterDisplay = () => {
    switch (timeFilter) {
      case "today": return "Dziś";
      case "7d": return "7 dni";
      case "30d": return "30 dni";
      case "90d": return "90 dni";
      case "all": return "Wszystkie";
      case "custom": 
        if (customRange.from && customRange.to) {
          return `${format(customRange.from, "dd.MM")} - ${format(customRange.to, "dd.MM")}`;
        }
        return "Własny";
      default: return "";
    }
  };

  // Export handlers
  const handleExportPositions = () => {
    if (!filteredPositions || filteredPositions.length === 0) {
      toast({
        title: "Brak danych",
        description: "Brak pozycji do eksportu",
        variant: "destructive",
      });
      return;
    }

    const filename = `positions_${getTimeFilterLabel()}_${format(new Date(), "yyyy-MM-dd")}`;
    exportToCSV(filteredPositions as any, filename);
    toast({
      title: "Eksport zakończony",
      description: `Wyeksportowano ${filteredPositions.length} pozycji`,
    });
  };

  const handleExportStats = () => {
    if (!stats) {
      toast({
        title: "Brak danych",
        description: "Brak statystyk do eksportu",
        variant: "destructive",
      });
      return;
    }

    exportStatsToCSV({
      summary: {
        totalTrades: stats.totalTrades,
        winRate: stats.winRate,
        totalPnL: stats.totalPnL,
        profitFactor: stats.profitFactor,
        expectancy: stats.expectancy,
        avgWin: stats.avgWin,
        avgLoss: stats.avgLoss,
        maxDrawdown: stats.maxDrawdown,
        largestWin: stats.largestWin,
        largestLoss: stats.largestLoss,
        avgDurationMinutes: stats.avgDurationMinutes,
        bestWinStreak: stats.bestWinStreak,
        worstLossStreak: stats.worstLossStreak,
      },
      advancedMetrics: {
        sharpeRatio: advancedMetrics.sharpeRatio,
        sortinoRatio: advancedMetrics.sortinoRatio,
        calmarRatio: advancedMetrics.calmarRatio,
        recoveryFactor: advancedMetrics.recoveryFactor,
        payoffRatio: advancedMetrics.payoffRatio,
      },
      latencyAnalysis: latencyAnalysis || undefined,
      bySession: sessionStats,
      byCloseReason: closeReasonStats,
      bySignalStrength: strengthStats,
      byDuration: durationStats,
      byHour: hourlyStats,
      byDayOfWeek: dailyStats,
      byLeverage: roiStats.map(r => ({
        leverage: parseInt(r.range.split('x')[0]),
        trades: r.trades,
        winRate: (r.wins / r.trades) * 100,
        avgPnL: r.totalPnL / r.trades,
        totalPnL: r.totalPnL,
      })),
      bySymbol: symbolStats.map(s => ({
        symbol: s.symbol,
        trades: s.trades,
        winRate: (s.wins / s.trades) * 100,
        pnl: s.pnl,
      })),
      byTier: tierStats.map(t => ({
        tier: t.tier,
        trades: t.trades,
        winRate: t.winRate,
        pnl: t.totalPnL,
      })),
      monthlyData: monthlyData,
    }, `stats_${getTimeFilterLabel()}_${format(new Date(), "yyyy-MM-dd")}`);
    
    toast({
      title: "Eksport zakończony",
      description: "Wszystkie statystyki zostały wyeksportowane do CSV",
    });
  };

  const handleExportAlerts = () => {
    if (!filteredAlerts || filteredAlerts.length === 0) {
      toast({
        title: "Brak danych",
        description: "Brak alertów do eksportu",
        variant: "destructive",
      });
      return;
    }

    const headers = [
      "Data", "Symbol", "Side", "Entry Price", "SL", "TP", "Tier", 
      "Strength", "Leverage", 
      "TV Timestamp", "Webhook Received", "Exchange Executed",
      "Latencja TV→Webhook (ms)", "Latencja Processing (ms)", "Latencja Total (ms)",
      "Status", "Testowy", "Błąd"
    ];

    const rows = filteredAlerts.map((alert) => [
      format(new Date(alert.created_at), "dd.MM.yyyy HH:mm:ss"),
      alert.symbol,
      alert.side,
      Number(alert.entry_price).toFixed(8),
      Number(alert.sl).toFixed(8),
      Number(alert.main_tp).toFixed(8),
      alert.tier || "-",
      Number(alert.strength || 0).toFixed(2),
      alert.leverage,
      alert.tv_timestamp || "-",
      alert.webhook_received_at ? format(new Date(alert.webhook_received_at), "dd.MM.yyyy HH:mm:ss") : "-",
      alert.exchange_executed_at || "-",
      alert.latency_webhook_ms || "-",
      alert.latency_execution_ms || "-",
      alert.latency_ms || "-",
      alert.status,
      alert.is_test ? "Tak" : "Nie",
      alert.error_message || "-"
    ]);

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    const filename = `alerts_${getTimeFilterLabel()}_${format(new Date(), "yyyy-MM-dd")}.csv`;
    link.setAttribute("href", url);
    link.setAttribute("download", filename);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Eksport zakończony",
      description: `Wyeksportowano ${filteredAlerts.length} alertów do CSV`,
    });
  };

  // Equity curve data
  const equityData = useMemo(() => {
    if (!filteredPositions) return [];
    
    let cumulativePnL = 0;
    return filteredPositions.map((p, index) => {
      cumulativePnL += Number(p.realized_pnl || 0);
      return {
        date: p.closed_at!,
        cumulativePnL,
        displayDate: index % Math.max(1, Math.floor(filteredPositions.length / 10)) === 0 
          ? new Date(p.closed_at!).toLocaleDateString("pl-PL", { day: "2-digit", month: "short" })
          : "",
      };
    });
  }, [filteredPositions]);

  // Group by symbol
  const symbolStats = useMemo(() => {
    if (!filteredPositions) return [];
    
    const bySymbol = filteredPositions.reduce((acc, pos) => {
      if (!acc[pos.symbol]) {
        acc[pos.symbol] = {
          symbol: pos.symbol,
          trades: 0,
          pnl: 0,
          wins: 0,
        };
      }
      acc[pos.symbol].trades++;
      acc[pos.symbol].pnl += Number(pos.realized_pnl || 0);
      if (Number(pos.realized_pnl || 0) > 0) acc[pos.symbol].wins++;
      return acc;
    }, {} as Record<string, { symbol: string; trades: number; pnl: number; wins: number }>);

    return Object.values(bySymbol).sort((a, b) => b.pnl - a.pnl);
  }, [filteredPositions]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold">Statystyki Wydajności</h1>
          <p className="text-muted-foreground">Szczegółowa analiza wyników tradingowych</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            onClick={() => handleImport(7)}
            disabled={isImporting}
            variant="outline"
            size="sm"
          >
            <Download className="h-4 w-4 mr-2" />
            Import 7 dni
          </Button>
          <Button
            onClick={() => handleImport(30)}
            disabled={isImporting}
            variant="outline"
            size="sm"
          >
            <Download className="h-4 w-4 mr-2" />
            Import 30 dni
          </Button>
          <Button
            onClick={() => handleImport(90)}
            disabled={isImporting}
            variant="outline"
            size="sm"
          >
            <Download className="h-4 w-4 mr-2" />
            Import 90 dni
          </Button>
          <Button
            onClick={() => repairMutation.mutate()}
            disabled={repairMutation.isPending}
            variant="outline"
            size="sm"
          >
            <Wrench className="h-4 w-4 mr-2" />
            Napraw dane
          </Button>
        </div>
      </div>

      {/* Time Filters */}
      <TimeFilters
        selected={timeFilter}
        onSelect={setTimeFilter}
        customRange={customRange}
        onCustomRangeChange={setCustomRange}
      />

      {/* Export Buttons */}
      <div className="flex gap-2 flex-wrap">
        <Button
          onClick={handleExportPositions}
          variant="outline"
          size="sm"
          disabled={!filteredPositions || filteredPositions.length === 0}
        >
          <FileDown className="h-4 w-4 mr-2" />
          Eksport Pozycji ({getTimeFilterDisplay()})
        </Button>
        <Button
          onClick={handleExportStats}
          size="sm"
          disabled={!stats}
        >
          <FileDown className="h-4 w-4 mr-2" />
          Eksport Statystyk ({getTimeFilterDisplay()})
        </Button>
        <Button
          onClick={handleExportAlerts}
          variant="outline"
          size="sm"
          disabled={!filteredAlerts || filteredAlerts.length === 0}
        >
          <FileDown className="h-4 w-4 mr-2" />
          Eksport Alertów ({getTimeFilterDisplay()})
        </Button>
      </div>

      {stats ? (
        <>
          {/* Overview KPIs - Enhanced */}
          <div className="grid gap-4 md:grid-cols-3 lg:grid-cols-6">
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Całkowity PnL</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${stats.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                  ${stats.totalPnL.toFixed(2)}
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Win Rate</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.winRate.toFixed(1)}%</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.winningTrades}W / {stats.losingTrades}L
                </p>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Expectancy</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${stats.expectancy >= 0 ? "text-profit" : "text-loss"}`}>
                  ${stats.expectancy.toFixed(2)}
                </div>
                <p className="text-xs text-muted-foreground mt-1">per trade</p>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Profit Factor</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.profitFactor.toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Wszystkie Trade'y</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.totalTrades}</div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Transakcje Zamknięcia</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.closingTransactions}</div>
                <p className="text-xs text-muted-foreground mt-1">
                  {stats.winningTransactions}W / {stats.closingTransactions - stats.winningTransactions}L
                  ({stats.transactionWinRate.toFixed(1)}%)
                </p>
              </CardContent>
            </Card>
          </div>

          {/* Additional KPIs */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Śr. Czas Pozycji</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats.avgDurationMinutes.toFixed(0)} min
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Max Drawdown</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-loss">
                  ${stats.maxDrawdown.toFixed(2)}
                </div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1">
                  <TrendingUp className="h-4 w-4 text-profit" />
                  Seria Win
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-profit">
                  {stats.bestWinStreak}
                </div>
                <p className="text-xs text-muted-foreground mt-1">z rzędu</p>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-1">
                  <TrendingDown className="h-4 w-4 text-loss" />
                  Seria Loss
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-loss">
                  {stats.worstLossStreak}
                </div>
                <p className="text-xs text-muted-foreground mt-1">z rzędu</p>
              </CardContent>
            </Card>
          </div>

          {/* Win/Loss Details */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Średni Win</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-profit">${stats.avgWin.toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Średni Loss</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-loss">${stats.avgLoss.toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Największy Win</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-profit">${stats.largestWin.toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Największy Loss</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-loss">${stats.largestLoss.toFixed(2)}</div>
              </CardContent>
            </Card>
          </div>

          {/* Tabs for organized sections */}
          <Tabs defaultValue="overview" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="overview">Przegląd</TabsTrigger>
              <TabsTrigger value="strategy">Strategia</TabsTrigger>
              <TabsTrigger value="time">Czas</TabsTrigger>
              <TabsTrigger value="advanced">Zaawansowane</TabsTrigger>
            </TabsList>
            
            <TabsContent value="overview" className="space-y-6 mt-6">
              {/* Equity Curve */}
              <EquityCurve 
                equityData={equityData} 
                maxDrawdown={stats.maxDrawdown}
              />

              {/* Monthly Comparison */}
              <MonthlyComparison monthlyData={monthlyData} />

              {/* Latency Analysis */}
              <LatencyAnalysisCard positions={filteredPositions} />

              {/* By Symbol */}
              <Card className="glass-card">
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <BarChart3 className="h-5 w-5 text-primary" />
                    Wyniki według pary
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="space-y-4">
                    {symbolStats.map((sym) => {
                      const winRate = (sym.wins / sym.trades) * 100;
                      return (
                        <div key={sym.symbol} className="flex items-center justify-between border-b border-border pb-3 last:border-0">
                          <div className="flex-1">
                            <div className="font-medium">{sym.symbol}</div>
                            <div className="text-sm text-muted-foreground">
                              {sym.trades} trade{sym.trades !== 1 ? "s" : ""} • {winRate.toFixed(0)}% win rate
                            </div>
                          </div>
                          <div className={`text-xl font-bold ${sym.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                            ${sym.pnl.toFixed(2)}
                          </div>
                        </div>
                      );
                    })}
                    {symbolStats.length === 0 && (
                      <p className="text-center text-muted-foreground py-4">Brak danych</p>
                    )}
                  </div>
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="strategy" className="space-y-6 mt-6">
              {/* Tier Analysis */}
              <TierAnalysisCard tierStats={tierStats} />

              {/* Close Reason Analysis */}
              <CloseReasonChart closeReasons={closeReasonStats} />

              {/* Signal Strength Analysis */}
              <SignalStrengthCard strengthStats={strengthStats} />

              {/* Zone Type Analysis */}
              <ZoneTypeCard zoneStats={zoneTypeStats} />

              {/* Mode Analysis */}
              <ModeAnalysisCard modeStats={modeStats} />

              {/* Regime Analysis */}
              <RegimeAnalysisCard regimeStats={regimeStats} />
            </TabsContent>

            <TabsContent value="time" className="space-y-6 mt-6">
              {/* Session Analysis */}
              <SessionAnalysisCard sessionStats={sessionStats} />

              {/* Time-based Analysis */}
              <TimeBasedAnalysis hourlyStats={hourlyStats} dailyStats={dailyStats} />

              {/* Duration Analysis */}
              <DurationAnalysisCard durationStats={durationStats} />
            </TabsContent>

            <TabsContent value="advanced" className="space-y-6 mt-6">
              {/* Advanced Metrics */}
              <AdvancedMetricsCard metrics={advancedMetrics} />

              {/* ROI Analysis */}
              <ROIAnalysisCard roiStats={roiStats} />

              {/* BTC Correlation */}
              <BTCCorrelationCard correlationStats={btcCorrelationStats} />

              {/* Volatility Analysis */}
              <VolatilityAnalysisCard volatilityStats={volatilityStats} />
            </TabsContent>
          </Tabs>
        </>
      ) : (
        <Card className="glass-card">
          <CardContent className="py-12">
            <div className="text-center text-muted-foreground">
              <BarChart3 className="h-12 w-12 mx-auto mb-4 opacity-50" />
              <p>Brak danych statystycznych</p>
              <p className="text-sm">Statystyki pojawią się po zamknięciu pierwszych pozycji</p>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
