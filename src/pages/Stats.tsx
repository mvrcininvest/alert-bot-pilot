import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BarChart3 } from "lucide-react";

export default function Stats() {
  const { data: allPositions } = useQuery({
    queryKey: ["all-positions-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("*")
        .eq("status", "closed");
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  // Calculate statistics
  const stats = allPositions ? {
    totalPnL: allPositions.reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0),
    totalTrades: allPositions.length,
    winningTrades: allPositions.filter(p => Number(p.realized_pnl || 0) > 0).length,
    losingTrades: allPositions.filter(p => Number(p.realized_pnl || 0) < 0).length,
    winRate: allPositions.length > 0 
      ? (allPositions.filter(p => Number(p.realized_pnl || 0) > 0).length / allPositions.length) * 100 
      : 0,
    avgWin: (() => {
      const wins = allPositions.filter(p => Number(p.realized_pnl || 0) > 0);
      return wins.length > 0 ? wins.reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0) / wins.length : 0;
    })(),
    avgLoss: (() => {
      const losses = allPositions.filter(p => Number(p.realized_pnl || 0) < 0);
      return losses.length > 0 ? losses.reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0) / losses.length : 0;
    })(),
    profitFactor: (() => {
      const totalWins = allPositions.filter(p => Number(p.realized_pnl || 0) > 0).reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0);
      const totalLosses = Math.abs(allPositions.filter(p => Number(p.realized_pnl || 0) < 0).reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0));
      return totalLosses > 0 ? totalWins / totalLosses : 0;
    })(),
    largestWin: allPositions.length > 0 
      ? Math.max(...allPositions.map(p => Number(p.realized_pnl || 0))) 
      : 0,
    largestLoss: allPositions.length > 0 
      ? Math.min(...allPositions.map(p => Number(p.realized_pnl || 0))) 
      : 0,
  } : null;

  // Group by symbol
  const bySymbol = allPositions?.reduce((acc, pos) => {
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

  const symbolStats = bySymbol ? Object.values(bySymbol).sort((a, b) => b.pnl - a.pnl) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Statystyki Wydajności</h1>
        <p className="text-muted-foreground">Szczegółowa analiza wyników tradingowych</p>
      </div>

      {stats && (
        <>
          {/* Overview KPIs */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Całkowity PnL</CardTitle>
              </CardHeader>
              <CardContent>
                <div className={`text-3xl font-bold ${stats.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                  ${stats.totalPnL.toFixed(2)}
                </div>
              </CardContent>
            </Card>
            <Card>
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
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Profit Factor</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.profitFactor.toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Wszystkie Trade'y</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-3xl font-bold">{stats.totalTrades}</div>
              </CardContent>
            </Card>
          </div>

          {/* Win/Loss Details */}
          <div className="grid gap-4 md:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Średni Win</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-profit">${stats.avgWin.toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Średni Loss</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-loss">${stats.avgLoss.toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Największy Win</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-profit">${stats.largestWin.toFixed(2)}</div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">Największy Loss</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="text-2xl font-bold text-loss">${stats.largestLoss.toFixed(2)}</div>
              </CardContent>
            </Card>
          </div>

          {/* By Symbol */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <BarChart3 className="h-5 w-5" />
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
      )}

      {!stats && (
        <Card>
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
