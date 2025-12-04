import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { BarChart2, Lightbulb } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";

export interface VolumeStats {
  category: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
}

interface VolumeAnalysisCardProps {
  volumeClimaxStats: VolumeStats[];
  volumeRatioStats: VolumeStats[];
}

function generateInsight(climaxStats: VolumeStats[], ratioStats: VolumeStats[]): string | null {
  const insights: string[] = [];

  // Volume climax insight
  const withClimax = climaxStats.find(s => s.category === "Volume Climax");
  const noClimax = climaxStats.find(s => s.category === "Normalny wolumen");
  
  if (withClimax && noClimax && withClimax.trades >= 3 && noClimax.trades >= 3) {
    if (withClimax.winRate > noClimax.winRate + 5) {
      insights.push(`Wejścia przy volume climax mają ${(withClimax.winRate - noClimax.winRate).toFixed(0)}pp lepszy win rate`);
    } else if (noClimax.winRate > withClimax.winRate + 5) {
      insights.push(`Lepiej unikać wejść przy volume climax - ${(noClimax.winRate - withClimax.winRate).toFixed(0)}pp gorszy win rate`);
    }
  }

  // Volume ratio insight
  const highVolume = ratioStats.filter(s => s.category.includes(">1.5") || s.category.includes("1.0-1.5"));
  const lowVolume = ratioStats.filter(s => s.category.includes("<0.5") || s.category.includes("0.5-1.0"));
  
  if (highVolume.length > 0 && lowVolume.length > 0) {
    const highAvg = highVolume.reduce((sum, s) => sum + s.winRate * s.trades, 0) / 
                    Math.max(highVolume.reduce((sum, s) => sum + s.trades, 0), 1);
    const lowAvg = lowVolume.reduce((sum, s) => sum + s.winRate * s.trades, 0) / 
                   Math.max(lowVolume.reduce((sum, s) => sum + s.trades, 0), 1);
    
    if (highAvg > lowAvg + 5) {
      insights.push(`Wyższy volume ratio (>1.0) koreluje z lepszym win rate`);
    } else if (lowAvg > highAvg + 5) {
      insights.push(`Niższy volume ratio (<1.0) daje lepsze wyniki`);
    }
  }

  // Best volume ratio range
  const bestRatio = ratioStats.filter(s => s.trades >= 3).sort((a, b) => b.winRate - a.winRate)[0];
  if (bestRatio && bestRatio.winRate > 55) {
    insights.push(`Optymalny volume_ratio: ${bestRatio.category} (${bestRatio.winRate.toFixed(0)}% win rate)`);
  }

  return insights.length > 0 ? insights.join(". ") + "." : null;
}

function StatsTable({ stats, title }: { stats: VolumeStats[]; title: string }) {
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
            <TableHead className="w-[150px]">Kategoria</TableHead>
            <TableHead>Trades</TableHead>
            <TableHead>Win Rate</TableHead>
            <TableHead className="text-right">Śr. PnL</TableHead>
            <TableHead className="text-right">Razem PnL</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {stats.map((stat) => (
            <TableRow key={`${title}-${stat.category}`}>
              <TableCell className="font-medium">{stat.category}</TableCell>
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

export function VolumeAnalysisCard({ volumeClimaxStats, volumeRatioStats }: VolumeAnalysisCardProps) {
  const insight = generateInsight(volumeClimaxStats, volumeRatioStats);
  const hasData = volumeClimaxStats.length > 0 || volumeRatioStats.length > 0;

  // Chart data
  const climaxChartData = volumeClimaxStats.map(s => ({
    name: s.category,
    winRate: s.winRate,
    trades: s.trades,
  }));

  const ratioChartData = volumeRatioStats.map(s => ({
    name: s.category,
    winRate: s.winRate,
    trades: s.trades,
  }));

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <BarChart2 className="h-5 w-5 text-primary" />
          Analiza Wolumenu
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {!hasData ? (
          <div className="text-center text-muted-foreground py-8">
            Brak danych wolumenu w alertach
          </div>
        ) : (
          <>
            {/* Side by side charts */}
            <div className="grid gap-6 md:grid-cols-2">
              {volumeClimaxStats.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-3">Volume Climax - Win Rate</h4>
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={climaxChartData}>
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <Tooltip 
                        formatter={(value: number) => [`${value.toFixed(1)}%`, "Win Rate"]}
                      />
                      <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                      <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                        {climaxChartData.map((entry, index) => (
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

              {volumeRatioStats.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-3">Volume Ratio - Win Rate</h4>
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={ratioChartData}>
                      <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <Tooltip 
                        formatter={(value: number) => [`${value.toFixed(1)}%`, "Win Rate"]}
                      />
                      <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                      <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                        {ratioChartData.map((entry, index) => (
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
            </div>

            {/* Stats Tables */}
            <div className="grid gap-6 md:grid-cols-2">
              <StatsTable stats={volumeClimaxStats} title="Volume Climax" />
              <StatsTable stats={volumeRatioStats} title="Volume Ratio" />
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
