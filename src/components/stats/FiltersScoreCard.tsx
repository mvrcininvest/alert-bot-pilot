import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Filter, Lightbulb } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";

export interface FilterStats {
  range: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
}

interface FiltersScoreCardProps {
  volumeMultiplierStats: FilterStats[];
  roomToTargetStats: FilterStats[];
  fakePenaltyStats: FilterStats[];
}

function generateInsight(
  volumeStats: FilterStats[],
  roomStats: FilterStats[],
  penaltyStats: FilterStats[]
): string | null {
  const insights: string[] = [];

  // Volume multiplier insight
  const bestVolume = volumeStats.filter(s => s.trades >= 3).sort((a, b) => b.winRate - a.winRate)[0];
  if (bestVolume && bestVolume.winRate > 55) {
    insights.push(`Najlepszy volume_multiplier: ${bestVolume.range} z ${bestVolume.winRate.toFixed(0)}% win rate`);
  }

  // Room to target insight
  const goodRoom = roomStats.filter(s => s.trades >= 3 && s.winRate > 55);
  if (goodRoom.length > 0) {
    const ranges = goodRoom.map(r => r.range).join(", ");
    insights.push(`Room to target ${ranges} ma ponadprzeciętne wyniki`);
  }

  // Fake penalty insight
  const noPenalty = penaltyStats.find(s => s.range === "Brak (=1)");
  const withPenalty = penaltyStats.find(s => s.range === "Z penalizacją (<1)");
  if (noPenalty && withPenalty && noPenalty.winRate > withPenalty.winRate + 5) {
    insights.push(`Sygnały bez fake_breakout_penalty mają ${(noPenalty.winRate - withPenalty.winRate).toFixed(0)}pp lepszy win rate`);
  }

  return insights.length > 0 ? insights.join(". ") + "." : null;
}

function StatsTable({ stats, title }: { stats: FilterStats[]; title: string }) {
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
            <TableHead className="w-[140px]">Zakres</TableHead>
            <TableHead>Trades</TableHead>
            <TableHead>Win Rate</TableHead>
            <TableHead className="text-right">Śr. PnL</TableHead>
            <TableHead className="text-right">Razem PnL</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.map((stat) => (
            <TableRow key={`${title}-${stat.range}`}>
              <TableCell className="font-medium">{stat.range}</TableCell>
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

export function FiltersScoreCard({ volumeMultiplierStats, roomToTargetStats, fakePenaltyStats }: FiltersScoreCardProps) {
  const insight = generateInsight(volumeMultiplierStats, roomToTargetStats, fakePenaltyStats);
  const hasData = volumeMultiplierStats.length > 0 || roomToTargetStats.length > 0 || fakePenaltyStats.length > 0;

  // Prepare chart data
  const chartData = volumeMultiplierStats.map(s => ({
    name: s.range,
    winRate: s.winRate,
    trades: s.trades,
  }));

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Filter className="h-5 w-5 text-primary" />
          Analiza Filtrów Sygnału
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {!hasData ? (
          <div className="text-center text-muted-foreground py-8">
            Brak danych filtrów w alertach
          </div>
        ) : (
          <>
            {/* Volume Multiplier Chart */}
            {volumeMultiplierStats.length > 0 && (
              <div>
                <h4 className="font-medium text-sm mb-3">Volume Multiplier - Win Rate</h4>
                <ResponsiveContainer width="100%" height={150}>
                  <BarChart data={chartData}>
                    <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                    <Tooltip 
                      formatter={(value: number) => [`${value.toFixed(1)}%`, "Win Rate"]}
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
              <StatsTable stats={volumeMultiplierStats} title="Volume Multiplier" />
              <StatsTable stats={roomToTargetStats} title="Room to Target" />
            </div>

            <StatsTable stats={fakePenaltyStats} title="Fake Breakout Penalty" />

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
