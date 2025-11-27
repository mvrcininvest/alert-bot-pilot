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
import { startOfDay, subDays, isAfter, isBefore } from "date-fns";

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
            size="sm"
          >
            <Download className="h-4 w-4 mr-2" />
            Import 90 dni
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
