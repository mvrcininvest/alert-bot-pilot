import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";
import { GitBranch, Lightbulb } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";

export interface StructureStats {
  category: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
}

interface StructureAnalysisCardProps {
  bosAgeStats: StructureStats[];
  bosAlignmentStats: StructureStats[];
  liquiditySweepStats: StructureStats[];
}

function generateInsight(
  bosAgeStats: StructureStats[],
  bosAlignmentStats: StructureStats[],
  liquiditySweepStats: StructureStats[]
): string | null {
  const insights: string[] = [];

  // BOS age insight
  const freshBos = bosAgeStats.filter(s => s.category.includes("1-5") || s.category.includes("6-15"));
  const oldBos = bosAgeStats.filter(s => s.category.includes(">"));
  
  if (freshBos.length > 0 && oldBos.length > 0) {
    const freshAvg = freshBos.reduce((sum, s) => sum + s.winRate * s.trades, 0) / 
                     Math.max(freshBos.reduce((sum, s) => sum + s.trades, 0), 1);
    const oldAvg = oldBos.reduce((sum, s) => sum + s.winRate * s.trades, 0) / 
                   Math.max(oldBos.reduce((sum, s) => sum + s.trades, 0), 1);
    
    if (freshAvg - oldAvg > 5) {
      insights.push(`Świeży BOS (age <15) ma ${(freshAvg - oldAvg).toFixed(0)}pp lepszy win rate`);
    }
  }

  // BOS alignment insight
  const aligned = bosAlignmentStats.find(s => s.category === "Zgodny");
  const opposite = bosAlignmentStats.find(s => s.category === "Przeciwny");
  
  if (aligned && opposite && aligned.trades >= 3 && opposite.trades >= 3) {
    if (aligned.winRate > opposite.winRate + 5) {
      insights.push(`Trading z kierunkiem BOS ma ${(aligned.winRate - opposite.winRate).toFixed(0)}pp lepszy win rate`);
    } else if (opposite.winRate > aligned.winRate + 5) {
      insights.push(`Counter-trend trading (przeciw BOS) daje lepsze wyniki`);
    }
  }

  // Liquidity sweep insight
  const withSweep = liquiditySweepStats.find(s => s.category === "Po sweep");
  const noSweep = liquiditySweepStats.find(s => s.category === "Bez sweep");
  
  if (withSweep && noSweep && withSweep.trades >= 3 && noSweep.trades >= 3) {
    if (withSweep.winRate > noSweep.winRate + 5) {
      insights.push(`Wejścia po liquidity sweep mają ${(withSweep.winRate - noSweep.winRate).toFixed(0)}pp lepszy win rate`);
    }
  }

  return insights.length > 0 ? insights.join(". ") + "." : null;
}

function StatsTable({ stats, title }: { stats: StructureStats[]; title: string }) {
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
            <TableHead className="w-[120px]">Kategoria</TableHead>
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

export function StructureAnalysisCard({ bosAgeStats, bosAlignmentStats, liquiditySweepStats }: StructureAnalysisCardProps) {
  const insight = generateInsight(bosAgeStats, bosAlignmentStats, liquiditySweepStats);
  const hasData = bosAgeStats.length > 0 || bosAlignmentStats.length > 0 || liquiditySweepStats.length > 0;

  // Chart data for BOS alignment (most important)
  const alignmentChartData = bosAlignmentStats.map(s => ({
    name: s.category,
    winRate: s.winRate,
    trades: s.trades,
  }));

  // Chart data for liquidity sweep
  const sweepChartData = liquiditySweepStats.map(s => ({
    name: s.category,
    winRate: s.winRate,
    trades: s.trades,
  }));

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-primary" />
          Analiza Struktury SMC (BOS & Liquidity)
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {!hasData ? (
          <div className="text-center text-muted-foreground py-8">
            Brak danych smc_context w alertach
          </div>
        ) : (
          <>
            {/* Side by side charts */}
            <div className="grid gap-6 md:grid-cols-2">
              {bosAlignmentStats.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-3">BOS Direction Alignment - Win Rate</h4>
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={alignmentChartData}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <Tooltip 
                        formatter={(value: number) => [`${value.toFixed(1)}%`, "Win Rate"]}
                      />
                      <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                      <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                        {alignmentChartData.map((entry, index) => (
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

              {liquiditySweepStats.length > 0 && (
                <div>
                  <h4 className="font-medium text-sm mb-3">Liquidity Sweep - Win Rate</h4>
                  <ResponsiveContainer width="100%" height={150}>
                    <BarChart data={sweepChartData}>
                      <XAxis dataKey="name" tick={{ fontSize: 11 }} />
                      <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
                      <Tooltip 
                        formatter={(value: number) => [`${value.toFixed(1)}%`, "Win Rate"]}
                      />
                      <ReferenceLine y={50} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                      <Bar dataKey="winRate" radius={[4, 4, 0, 0]}>
                        {sweepChartData.map((entry, index) => (
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
            <StatsTable stats={bosAgeStats} title="BOS Age (świece od BOS)" />

            <div className="grid gap-6 md:grid-cols-2">
              <StatsTable stats={bosAlignmentStats} title="BOS Direction Alignment" />
              <StatsTable stats={liquiditySweepStats} title="Liquidity Sweep" />
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
