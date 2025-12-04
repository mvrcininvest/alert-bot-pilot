import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { Target, Lightbulb } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine, ScatterChart, Scatter, ZAxis } from "recharts";

export interface ZoneAgeStats {
  range: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
}

interface ZoneAgeAnalysisCardProps {
  zoneAgeStats: ZoneAgeStats[];
  zoneRetestsStats: ZoneAgeStats[];
}

function generateInsight(ageStats: ZoneAgeStats[], retestStats: ZoneAgeStats[]): string | null {
  const insights: string[] = [];

  // Zone age insight
  const freshZones = ageStats.filter(s => s.range.includes("1-3") || s.range.includes("4-10"));
  const oldZones = ageStats.filter(s => s.range.includes(">"));
  
  const freshAvgWinRate = freshZones.reduce((sum, s) => sum + s.winRate * s.trades, 0) / 
                          Math.max(freshZones.reduce((sum, s) => sum + s.trades, 0), 1);
  const oldAvgWinRate = oldZones.reduce((sum, s) => sum + s.winRate * s.trades, 0) / 
                        Math.max(oldZones.reduce((sum, s) => sum + s.trades, 0), 1);

  if (freshZones.length > 0 && oldZones.length > 0 && freshAvgWinRate - oldAvgWinRate > 5) {
    insights.push(`Świeże strefy (age <10) mają ${(freshAvgWinRate - oldAvgWinRate).toFixed(0)}pp lepszy win rate niż starsze`);
  }

  // Zone retests insight
  const lowRetests = retestStats.filter(s => s.range.includes("1-2") || s.range.includes("3-5"));
  const highRetests = retestStats.filter(s => s.range.includes(">"));

  const lowAvgWinRate = lowRetests.reduce((sum, s) => sum + s.winRate * s.trades, 0) / 
                        Math.max(lowRetests.reduce((sum, s) => sum + s.trades, 0), 1);
  const highAvgWinRate = highRetests.reduce((sum, s) => sum + s.winRate * s.trades, 0) / 
                         Math.max(highRetests.reduce((sum, s) => sum + s.trades, 0), 1);

  if (lowRetests.length > 0 && highRetests.length > 0) {
    if (lowAvgWinRate > highAvgWinRate + 5) {
      insights.push(`Strefy z mniejszą liczbą retestów (<5) są bardziej skuteczne`);
    } else if (highAvgWinRate > lowAvgWinRate + 5) {
      insights.push(`Strefy przetestowane wiele razy (>5) mają lepsze wyniki`);
    }
  }

  // Best combination
  const bestAge = ageStats.filter(s => s.trades >= 3).sort((a, b) => b.winRate - a.winRate)[0];
  const bestRetest = retestStats.filter(s => s.trades >= 3).sort((a, b) => b.winRate - a.winRate)[0];
  
  if (bestAge && bestRetest && bestAge.winRate > 55 && bestRetest.winRate > 55) {
    insights.push(`Optymalna kombinacja: zone_age ${bestAge.range} + retests ${bestRetest.range}`);
  }

  return insights.length > 0 ? insights.join(". ") + "." : null;
}

function StatsTable({ stats, title }: { stats: ZoneAgeStats[]; title: string }) {
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
            <TableHead className="w-[120px]">Zakres</TableHead>
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

export function ZoneAgeAnalysisCard({ zoneAgeStats, zoneRetestsStats }: ZoneAgeAnalysisCardProps) {
  const insight = generateInsight(zoneAgeStats, zoneRetestsStats);
  const hasData = zoneAgeStats.length > 0 || zoneRetestsStats.length > 0;

  // Chart data
  const ageChartData = zoneAgeStats.map(s => ({
    name: s.range,
    winRate: s.winRate,
    trades: s.trades,
  }));

  const retestChartData = zoneRetestsStats.map(s => ({
    name: s.range,
    winRate: s.winRate,
    trades: s.trades,
  }));

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          Analiza Wieku i Retestów Stref
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {!hasData ? (
          <div className="text-center text-muted-foreground py-8">
            Brak danych zone_details w alertach
          </div>
        ) : (
          <>
            {/* Side by side charts */}
            <div className="grid gap-6 md:grid-cols-2">
              {zoneAgeStats.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-3">Zone Age (świece) - Win Rate</h4>
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={ageChartData}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <Tooltip 
                        formatter={(value: number) => [`${value.toFixed(1)}%`, "Win Rate"]}
                      />
                      <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                      <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                        {ageChartData.map((entry, index) => (
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

              {zoneRetestsStats.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-3">Zone Retests - Win Rate</h4>
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={retestChartData}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <Tooltip 
                        formatter={(value: number) => [`${value.toFixed(1)}%`, "Win Rate"]}
                      />
                      <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                      <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                        {retestChartData.map((entry, index) => (
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
              <StatsTable stats={zoneAgeStats} title="Zone Age (świece od powstania)" />
              <StatsTable stats={zoneRetestsStats} title="Zone Retests (ilość retestów)" />
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
