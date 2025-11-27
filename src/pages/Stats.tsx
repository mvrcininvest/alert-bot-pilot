import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3, Download, TrendingUp, TrendingDown } from "lucide-react";
import { Button } from "@/components/ui/button";
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
import { exportToCSV, exportStatsToCSV } from "@/lib/exportStats";
import { startOfDay, subDays, isAfter, isBefore, format, getDay, startOfMonth, endOfMonth } from "date-fns";
import { pl } from "date-fns/locale";
import { FileDown } from "lucide-react";

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
            mode
          )
        `)
        .eq("status", "closed")
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
      let reason = "Other";
      
      if (p.close_reason?.includes("tp1") || p.tp1_filled) reason = "TP1";
      else if (p.close_reason?.includes("tp2") || p.tp2_filled) reason = "TP2";
      else if (p.close_reason?.includes("tp3") || p.tp3_filled) reason = "TP3";
      else if (p.close_reason?.includes("sl") || p.close_reason?.includes("stop")) reason = "SL";
      else if (p.close_reason?.includes("manual")) reason = "Manual";
      
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
      const alert = Array.isArray(p.alerts) ? p.alerts[0] : p.alerts;
      const rawData = alert?.raw_data as any;
      const session = rawData?.timing?.session || "Unknown";
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

    exportToCSV(filteredPositions as any, "trading-positions");
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
      },
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
    }, "stats-summary");
    
    toast({
      title: "Eksport zakończony",
      description: "Statystyki zostały wyeksportowane do CSV",
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
          <div className="w-px h-8 bg-border" />
          <Button
            onClick={handleExportPositions}
            variant="outline"
            size="sm"
            disabled={!filteredPositions || filteredPositions.length === 0}
          >
            <FileDown className="h-4 w-4 mr-2" />
            Eksport Pozycji
          </Button>
          <Button
            onClick={handleExportStats}
            size="sm"
            disabled={!stats}
          >
            <FileDown className="h-4 w-4 mr-2" />
            Eksport Statystyk
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

      {stats ? (
        <>
          {/* Overview KPIs - Enhanced */}
          <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-5">
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
          </div>

          {/* Additional KPIs */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card className="glass-card">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Śr. Czas Pozycji</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold">
                  {stats.avgDurationMinutes < 60 
                    ? `${stats.avgDurationMinutes.toFixed(0)}m`
                    : `${(stats.avgDurationMinutes / 60).toFixed(1)}h`}
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

          {/* Equity Curve */}
          <EquityCurve 
            equityData={equityData} 
            maxDrawdown={stats.maxDrawdown}
          />

          {/* Tier Analysis */}
          <TierAnalysisCard tierStats={tierStats} />

          {/* Close Reason Analysis */}
          <CloseReasonChart closeReasons={closeReasonStats} />

          {/* Session Analysis */}
          <SessionAnalysisCard sessionStats={sessionStats} />

          {/* Signal Strength Analysis */}
          <SignalStrengthCard strengthStats={strengthStats} />

          {/* Duration Analysis */}
          <DurationAnalysisCard durationStats={durationStats} />

          {/* Regime Analysis */}
          <RegimeAnalysisCard regimeStats={regimeStats} />

          {/* Time-based Analysis */}
          <TimeBasedAnalysis hourlyStats={hourlyStats} dailyStats={dailyStats} />

          {/* ROI Analysis */}
          <ROIAnalysisCard roiStats={roiStats} />

          {/* Advanced Metrics */}
          <AdvancedMetricsCard metrics={advancedMetrics} />

          {/* Monthly Comparison */}
          <MonthlyComparison monthlyData={monthlyData} />

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
