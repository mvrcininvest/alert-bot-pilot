import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Timer } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Progress } from "@/components/ui/progress";

interface DurationStats {
  range: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
}

interface DurationAnalysisCardProps {
  durationStats: DurationStats[];
}

export function DurationAnalysisCard({ durationStats }: DurationAnalysisCardProps) {
  const maxTrades = Math.max(...durationStats.map(d => d.trades), 1);

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Timer className="h-5 w-5 text-primary" />
          Position Duration Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        {durationStats.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Czas trwania</TableHead>
                  <TableHead>Trade'y</TableHead>
                  <TableHead className="text-center">Win Rate</TableHead>
                  <TableHead className="text-right">Śr. PnL</TableHead>
                  <TableHead className="text-right">Total PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {durationStats.map((stat) => (
                  <TableRow key={stat.range}>
                    <TableCell className="font-medium">
                      {stat.range}
                    </TableCell>
                    <TableCell>
                      <div className="space-y-2">
                        <div className="flex items-center gap-2">
                          <span className="font-medium">{stat.trades}</span>
                          <span className="text-xs text-muted-foreground">
                            ({stat.wins}W/{stat.losses}L)
                          </span>
                        </div>
                        <Progress 
                          value={(stat.trades / maxTrades) * 100} 
                          className="h-1.5"
                        />
                      </div>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={stat.winRate >= 50 ? "text-profit font-semibold" : "text-loss"}>
                        {stat.winRate.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className={`text-right ${stat.avgPnL >= 0 ? "text-profit" : "text-loss"}`}>
                      ${stat.avgPnL.toFixed(2)}
                    </TableCell>
                    <TableCell className={`text-right font-bold ${stat.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                      ${stat.totalPnL.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">Brak danych duration do analizy</p>
        )}
      </CardContent>
    </Card>
  );
}
