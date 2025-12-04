import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Activity, TrendingUp, TrendingDown, Minus, Lightbulb } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";

export interface TechnicalIndicatorStats {
  category: string;
  value: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
}

interface TechnicalIndicatorsCardProps {
  adxStats: TechnicalIndicatorStats[];
  mfiStats: TechnicalIndicatorStats[];
  emaStats: TechnicalIndicatorStats[];
  vwapStats: TechnicalIndicatorStats[];
}

function generateInsight(
  adxStats: TechnicalIndicatorStats[],
  mfiStats: TechnicalIndicatorStats[],
  emaStats: TechnicalIndicatorStats[],
  vwapStats: TechnicalIndicatorStats[]
): string | null {
  const insights: string[] = [];

  // ADX insight
  const bestAdx = adxStats.filter(s => s.trades >= 3).sort((a, b) => b.winRate - a.winRate)[0];
  const worstAdx = adxStats.filter(s => s.trades >= 3).sort((a, b) => a.winRate - b.winRate)[0];
  if (bestAdx && worstAdx && bestAdx.winRate - worstAdx.winRate > 10) {
    insights.push(`ADX ${bestAdx.value} ma ${bestAdx.winRate.toFixed(0)}% win rate vs ${worstAdx.winRate.toFixed(0)}% dla ${worstAdx.value}`);
  }

  // MFI insight
  const bestMfi = mfiStats.filter(s => s.trades >= 3).sort((a, b) => b.winRate - a.winRate)[0];
  if (bestMfi && bestMfi.winRate > 55) {
    insights.push(`Najlepszy MFI: ${bestMfi.value} z ${bestMfi.winRate.toFixed(0)}% win rate`);
  }

  // EMA insight
  const bullishEma = emaStats.find(s => s.value === "BULLISH");
  const bearishEma = emaStats.find(s => s.value === "BEARISH");
  if (bullishEma && bearishEma && Math.abs(bullishEma.winRate - bearishEma.winRate) > 10) {
    const better = bullishEma.winRate > bearishEma.winRate ? "BULLISH" : "BEARISH";
    insights.push(`EMA ${better} alignment ma lepszy win rate`);
  }

  // VWAP insight
  const aboveVwap = vwapStats.find(s => s.value === "ABOVE");
  const belowVwap = vwapStats.find(s => s.value === "BELOW");
  if (aboveVwap && belowVwap && Math.abs(aboveVwap.winRate - belowVwap.winRate) > 10) {
    const better = aboveVwap.winRate > belowVwap.winRate ? "powyżej" : "poniżej";
    insights.push(`Lepsze wyniki gdy cena jest ${better} VWAP`);
  }

  return insights.length > 0 ? insights.join(". ") + "." : null;
}

function StatsTable({ stats, title }: { stats: TechnicalIndicatorStats[]; title: string }) {
  const maxTrades = Math.max(...stats.map(s => s.trades), 1);

  if (stats.length === 0) {
    return (
      <div className="text-center text-muted-foreground py-4 text-sm">
        Brak danych dla {title}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <h4 className="font-medium text-sm">{title}</h4>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="w-[120px]">Wartość</TableHead>
            <TableHead>Trades</TableHead>
            <TableHead>Win Rate</TableHead>
            <TableHead className="text-right">Śr. PnL</TableHead>
            <TableHead className="text-right">Razem PnL</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.map((stat) => (
            <TableRow key={`${title}-${stat.value}`}>
              <TableCell className="font-medium">{stat.value}</TableCell>
              <TableCell>
                <div className="flex items-center gap-2">
                  <span className="text-sm">{stat.trades}</span>
                  <Progress 
                    value={(stat.trades / maxTrades) * 100} 
                    className="w-16 h-2"
                  />
                </div>
              </TableCell>
              <TableCell>
                <span className={stat.winRate >= 50 ? "text-profit" : "text-loss"}>
                  {stat.winRate.toFixed(1)}%
                </span>
              </TableCell>
              <TableCell className={`text-right ${stat.avgPnL >= 0 ? "text-profit" : "text-loss"}`}>
                ${stat.avgPnL.toFixed(2)}
              </TableCell>
              <TableCell className={`text-right font-medium ${stat.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                ${stat.totalPnL.toFixed(2)}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

export function TechnicalIndicatorsCard({ adxStats, mfiStats, emaStats, vwapStats }: TechnicalIndicatorsCardProps) {
  const insight = generateInsight(adxStats, mfiStats, emaStats, vwapStats);
  const hasData = adxStats.length > 0 || mfiStats.length > 0 || emaStats.length > 0 || vwapStats.length > 0;

  // Prepare chart data for ADX
  const chartData = adxStats.map(s => ({
    name: s.value,
    winRate: s.winRate,
    trades: s.trades,
  }));

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Analiza Wskaźników Technicznych
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {!hasData ? (
          <div className="text-center text-muted-foreground py-8">
            Brak danych technicznych w alertach
          </div>
        ) : (
          <>
            {/* ADX Chart */}
            {adxStats.length > 0 && (
              <div>
                <h4 className="font-medium text-sm mb-3">ADX (Siła trendu) - Win Rate</h4>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={chartData}>
                    <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                    <Tooltip 
                      formatter={(value: number, name: string) => [
                        name === "winRate" ? `${value.toFixed(1)}%` : value,
                        name === "winRate" ? "Win Rate" : "Trades"
                      ]}
                    />
                    <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                    <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                      {chartData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.winRate >= 50 ? "hsl(var(--profit))" : "hsl(var(--loss))"} 
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}

            {/* Stats Tables */}
            <div className="grid gap-6 md:grid-cols-2">
              <StatsTable stats={adxStats} title="ADX (Siła trendu)" />
              <StatsTable stats={mfiStats} title="MFI (Money Flow Index)" />
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <StatsTable stats={emaStats} title="EMA Alignment" />
              <StatsTable stats={vwapStats} title="Pozycja względem VWAP" />
            </div>

            {/* Insight Box */}
            {insight && (
              <div className="bg-primary/10 border border-primary/20 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <Lightbulb className="h-5 w-5 text-primary flex-shrink-0 mt-0.5" />
                  <div>
                    <p className="font-medium text-sm text-primary">Insight</p>
                    <p className="text-sm text-muted-foreground">{insight}</p>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
