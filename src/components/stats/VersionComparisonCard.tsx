import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, TrendingUp, TrendingDown, BarChart3, Target, Clock } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer, PieChart, Pie, Cell } from "recharts";

interface VersionStats {
  version: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
  profitFactor: number;
  bestStreak: number;
  worstStreak: number;
  avgDuration: number;
  maxDrawdown: number;
  expectancy: number;
}

interface TierBreakdown {
  tier: string;
  trades: number;
  wins: number;
  winRate: number;
  totalPnL: number;
}

interface SymbolBreakdown {
  symbol: string;
  trades: number;
  wins: number;
  winRate: number;
  pnl: number;
}

interface CloseReasonBreakdown {
  reason: string;
  count: number;
  percentage: number;
}

interface EquityPoint {
  date: string;
  v91: number;
  v93: number;
  displayDate: string;
}

interface VersionComparisonCardProps {
  v91Stats: VersionStats | null;
  v93Stats: VersionStats | null;
  v91TierBreakdown: TierBreakdown[];
  v93TierBreakdown: TierBreakdown[];
  v91SymbolBreakdown: SymbolBreakdown[];
  v93SymbolBreakdown: SymbolBreakdown[];
  v91CloseReasons: CloseReasonBreakdown[];
  v93CloseReasons: CloseReasonBreakdown[];
  equityCurveData: EquityPoint[];
}

const COLORS = {
  v91: "hsl(var(--chart-1))",
  v93: "hsl(var(--chart-2))",
};

const PIE_COLORS = [
  "hsl(var(--chart-1))",
  "hsl(var(--chart-2))",
  "hsl(var(--chart-3))",
  "hsl(var(--chart-4))",
  "hsl(var(--chart-5))",
];

export function VersionComparisonCard({
  v91Stats,
  v93Stats,
  v91TierBreakdown,
  v93TierBreakdown,
  v91SymbolBreakdown,
  v93SymbolBreakdown,
  v91CloseReasons,
  v93CloseReasons,
  equityCurveData,
}: VersionComparisonCardProps) {
  const minTrades = 30;
  const v91HasEnoughData = v91Stats && v91Stats.trades >= minTrades;
  const v93HasEnoughData = v93Stats && v93Stats.trades >= minTrades;

  const renderMetricComparison = (
    label: string,
    v91Value: number | string,
    v93Value: number | string,
    format: "number" | "percent" | "currency" | "duration" = "number",
    higherIsBetter: boolean = true
  ) => {
    const formatValue = (val: number | string) => {
      if (typeof val === "string") return val;
      switch (format) {
        case "percent":
          return `${val.toFixed(1)}%`;
        case "currency":
          return `$${val.toFixed(2)}`;
        case "duration":
          return `${val.toFixed(0)} min`;
        default:
          return val.toFixed(2);
      }
    };

    const v91Num = typeof v91Value === "number" ? v91Value : 0;
    const v93Num = typeof v93Value === "number" ? v93Value : 0;
    const v91Better = higherIsBetter ? v91Num > v93Num : v91Num < v93Num;
    const v93Better = higherIsBetter ? v93Num > v91Num : v93Num < v91Num;

    return (
      <div className="grid grid-cols-3 gap-4 py-2 border-b border-border last:border-0">
        <div className="text-sm text-muted-foreground">{label}</div>
        <div className={`text-center font-medium ${v91Better ? "text-profit" : ""}`}>
          {v91Stats ? formatValue(v91Value) : "-"}
          {v91Better && v91Stats && v93Stats && <span className="ml-1 text-xs">✓</span>}
        </div>
        <div className={`text-center font-medium ${v93Better ? "text-profit" : ""}`}>
          {v93Stats ? formatValue(v93Value) : "-"}
          {v93Better && v91Stats && v93Stats && <span className="ml-1 text-xs">✓</span>}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-6">
      {/* Warning if not enough data */}
      {(!v91HasEnoughData || !v93HasEnoughData) && (
        <Alert variant="default" className="border-yellow-500/50 bg-yellow-500/10">
          <AlertTriangle className="h-4 w-4 text-yellow-500" />
          <AlertDescription className="text-yellow-600 dark:text-yellow-400">
            Aby porównanie było statystycznie istotne, potrzeba minimum {minTrades} transakcji dla każdej wersji.
            {!v91HasEnoughData && v91Stats && (
              <span className="block mt-1">v9.1: {v91Stats.trades} trades (brakuje {minTrades - v91Stats.trades})</span>
            )}
            {!v93HasEnoughData && v93Stats && (
              <span className="block mt-1">v9.3: {v93Stats.trades} trades (brakuje {minTrades - v93Stats.trades})</span>
            )}
            {!v91Stats && <span className="block mt-1">v9.1: Brak danych</span>}
            {!v93Stats && <span className="block mt-1">v9.3: Brak danych</span>}
          </AlertDescription>
        </Alert>
      )}

      {/* Main Comparison Header */}
      <Card className="glass-card">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <BarChart3 className="h-5 w-5 text-primary" />
            Porównanie Wersji Wskaźnika
          </CardTitle>
        </CardHeader>
        <CardContent>
          {/* Version Headers */}
          <div className="grid grid-cols-3 gap-4 mb-4 pb-2 border-b-2 border-border">
            <div className="text-sm font-medium text-muted-foreground">Metryka</div>
            <div className="text-center">
              <Badge variant="outline" className="bg-chart-1/20 border-chart-1">v9.1</Badge>
              <p className="text-xs text-muted-foreground mt-1">{v91Stats?.trades || 0} trades</p>
            </div>
            <div className="text-center">
              <Badge variant="outline" className="bg-chart-2/20 border-chart-2">v9.3</Badge>
              <p className="text-xs text-muted-foreground mt-1">{v93Stats?.trades || 0} trades</p>
            </div>
          </div>

          {/* Metrics Comparison */}
          <div className="space-y-1">
            {renderMetricComparison("Trades", v91Stats?.trades || 0, v93Stats?.trades || 0, "number", true)}
            {renderMetricComparison("Win Rate", v91Stats?.winRate || 0, v93Stats?.winRate || 0, "percent", true)}
            {renderMetricComparison("Total PnL", v91Stats?.totalPnL || 0, v93Stats?.totalPnL || 0, "currency", true)}
            {renderMetricComparison("Avg PnL", v91Stats?.avgPnL || 0, v93Stats?.avgPnL || 0, "currency", true)}
            {renderMetricComparison("Profit Factor", v91Stats?.profitFactor || 0, v93Stats?.profitFactor || 0, "number", true)}
            {renderMetricComparison("Expectancy", v91Stats?.expectancy || 0, v93Stats?.expectancy || 0, "currency", true)}
            {renderMetricComparison("Max Drawdown", v91Stats?.maxDrawdown || 0, v93Stats?.maxDrawdown || 0, "currency", false)}
            {renderMetricComparison("Best Streak", v91Stats?.bestStreak || 0, v93Stats?.bestStreak || 0, "number", true)}
            {renderMetricComparison("Worst Streak", v91Stats?.worstStreak || 0, v93Stats?.worstStreak || 0, "number", false)}
            {renderMetricComparison("Avg Duration", v91Stats?.avgDuration || 0, v93Stats?.avgDuration || 0, "duration", false)}
          </div>
        </CardContent>
      </Card>

      {/* Dual Equity Curve */}
      {equityCurveData.length > 0 && (
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Krzywa Kapitału (Porównanie)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={equityCurveData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis 
                    dataKey="displayDate" 
                    tick={{ fontSize: 12 }} 
                    className="text-muted-foreground"
                  />
                  <YAxis 
                    tick={{ fontSize: 12 }}
                    tickFormatter={(v) => `$${v.toFixed(0)}`}
                    className="text-muted-foreground"
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number, name: string) => [
                      `$${value.toFixed(2)}`,
                      name === "v91" ? "v9.1" : "v9.3"
                    ]}
                  />
                  <Legend 
                    formatter={(value) => value === "v91" ? "v9.1" : "v9.3"}
                  />
                  <Line 
                    type="monotone" 
                    dataKey="v91" 
                    stroke={COLORS.v91}
                    strokeWidth={2}
                    dot={false}
                    name="v91"
                  />
                  <Line 
                    type="monotone" 
                    dataKey="v93" 
                    stroke={COLORS.v93}
                    strokeWidth={2}
                    dot={false}
                    name="v93"
                  />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Close Reason Distribution */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-chart-1" />
              v9.1 - Close Reasons
            </CardTitle>
          </CardHeader>
          <CardContent>
            {v91CloseReasons.length > 0 ? (
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={v91CloseReasons}
                      dataKey="count"
                      nameKey="reason"
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      label={({ reason, percentage }) => `${reason}: ${percentage.toFixed(0)}%`}
                    >
                      {v91CloseReasons.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">Brak danych</p>
            )}
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Target className="h-4 w-4 text-chart-2" />
              v9.3 - Close Reasons
            </CardTitle>
          </CardHeader>
          <CardContent>
            {v93CloseReasons.length > 0 ? (
              <div className="h-[200px]">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={v93CloseReasons}
                      dataKey="count"
                      nameKey="reason"
                      cx="50%"
                      cy="50%"
                      outerRadius={70}
                      label={({ reason, percentage }) => `${reason}: ${percentage.toFixed(0)}%`}
                    >
                      {v93CloseReasons.map((_, index) => (
                        <Cell key={`cell-${index}`} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <p className="text-center text-muted-foreground py-8">Brak danych</p>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Tier Breakdown */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Badge variant="outline" className="bg-chart-1/20">v9.1</Badge>
              Performance per Tier
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {v91TierBreakdown.length > 0 ? (
                v91TierBreakdown.map((tier) => (
                  <div key={tier.tier} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                    <div>
                      <span className="font-medium">{tier.tier}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {tier.trades} trades • {tier.winRate.toFixed(0)}% WR
                      </span>
                    </div>
                    <span className={`font-bold ${tier.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                      ${tier.totalPnL.toFixed(2)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground">Brak danych</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Badge variant="outline" className="bg-chart-2/20">v9.3</Badge>
              Performance per Tier
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {v93TierBreakdown.length > 0 ? (
                v93TierBreakdown.map((tier) => (
                  <div key={tier.tier} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                    <div>
                      <span className="font-medium">{tier.tier}</span>
                      <span className="text-xs text-muted-foreground ml-2">
                        {tier.trades} trades • {tier.winRate.toFixed(0)}% WR
                      </span>
                    </div>
                    <span className={`font-bold ${tier.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                      ${tier.totalPnL.toFixed(2)}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground">Brak danych</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Top Symbols */}
      <div className="grid gap-6 md:grid-cols-2">
        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Badge variant="outline" className="bg-chart-1/20">v9.1</Badge>
              Top 5 Symboli
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {v91SymbolBreakdown.slice(0, 5).map((sym, idx) => (
                <div key={sym.symbol} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-4">#{idx + 1}</span>
                    <span className="font-medium">{sym.symbol}</span>
                    <span className="text-xs text-muted-foreground">
                      {sym.trades}t • {sym.winRate.toFixed(0)}%
                    </span>
                  </div>
                  <span className={`font-bold ${sym.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                    ${sym.pnl.toFixed(2)}
                  </span>
                </div>
              ))}
              {v91SymbolBreakdown.length === 0 && (
                <p className="text-center text-muted-foreground">Brak danych</p>
              )}
            </div>
          </CardContent>
        </Card>

        <Card className="glass-card">
          <CardHeader>
            <CardTitle className="text-sm flex items-center gap-2">
              <Badge variant="outline" className="bg-chart-2/20">v9.3</Badge>
              Top 5 Symboli
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3">
              {v93SymbolBreakdown.slice(0, 5).map((sym, idx) => (
                <div key={sym.symbol} className="flex items-center justify-between border-b border-border pb-2 last:border-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-muted-foreground w-4">#{idx + 1}</span>
                    <span className="font-medium">{sym.symbol}</span>
                    <span className="text-xs text-muted-foreground">
                      {sym.trades}t • {sym.winRate.toFixed(0)}%
                    </span>
                  </div>
                  <span className={`font-bold ${sym.pnl >= 0 ? "text-profit" : "text-loss"}`}>
                    ${sym.pnl.toFixed(2)}
                  </span>
                </div>
              ))}
              {v93SymbolBreakdown.length === 0 && (
                <p className="text-center text-muted-foreground">Brak danych</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Summary Verdict */}
      {v91Stats && v93Stats && (
        <Card className="glass-card border-primary/30">
          <CardHeader>
            <CardTitle className="text-sm">Podsumowanie</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 text-center">
              <div>
                <Badge variant="outline" className="bg-chart-1/20 border-chart-1 mb-2">v9.1</Badge>
                <div className="space-y-1 text-sm">
                  <p>Win Rate: <span className="font-bold">{v91Stats.winRate.toFixed(1)}%</span></p>
                  <p>PnL: <span className={`font-bold ${v91Stats.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                    ${v91Stats.totalPnL.toFixed(2)}
                  </span></p>
                  <p>Profit Factor: <span className="font-bold">{v91Stats.profitFactor.toFixed(2)}</span></p>
                </div>
              </div>
              <div>
                <Badge variant="outline" className="bg-chart-2/20 border-chart-2 mb-2">v9.3</Badge>
                <div className="space-y-1 text-sm">
                  <p>Win Rate: <span className="font-bold">{v93Stats.winRate.toFixed(1)}%</span></p>
                  <p>PnL: <span className={`font-bold ${v93Stats.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                    ${v93Stats.totalPnL.toFixed(2)}
                  </span></p>
                  <p>Profit Factor: <span className="font-bold">{v93Stats.profitFactor.toFixed(2)}</span></p>
                </div>
              </div>
            </div>
            {!v91HasEnoughData || !v93HasEnoughData ? (
              <p className="text-center text-muted-foreground text-xs mt-4">
                ⚠️ Niewystarczająca ilość danych do wiarygodnego porównania
              </p>
            ) : (
              <p className="text-center text-sm mt-4">
                {v91Stats.winRate > v93Stats.winRate && v91Stats.totalPnL > v93Stats.totalPnL ? (
                  <span className="text-chart-1">v9.1 aktualnie prowadzi w obu metrykach</span>
                ) : v93Stats.winRate > v91Stats.winRate && v93Stats.totalPnL > v91Stats.totalPnL ? (
                  <span className="text-chart-2">v9.3 aktualnie prowadzi w obu metrykach</span>
                ) : (
                  <span className="text-muted-foreground">Wyniki są mieszane - kontynuuj zbieranie danych</span>
                )}
              </p>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
