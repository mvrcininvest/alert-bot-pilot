import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Percent } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

interface ROIStats {
  range: string;
  trades: number;
  wins: number;
  avgROI: number;
  totalPnL: number;
  avgMarginUsed: number;
}

interface ROIAnalysisCardProps {
  roiStats: ROIStats[];
}

export function ROIAnalysisCard({ roiStats }: ROIAnalysisCardProps) {
  const getColor = (avgROI: number) => {
    if (avgROI > 5) return "hsl(var(--profit))";
    if (avgROI > 0) return "hsl(var(--primary))";
    return "hsl(var(--loss))";
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Percent className="h-5 w-5 text-primary" />
          ROI według Dźwigni
        </CardTitle>
      </CardHeader>
      <CardContent>
        {roiStats.length > 0 ? (
          <div className="space-y-6">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={roiStats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis
                    dataKey="range"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `${value}%`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === "avgROI") return [`${value.toFixed(2)}%`, "Śr. ROI"];
                      return [value, name];
                    }}
                  />
                  <Bar dataKey="avgROI" radius={[8, 8, 0, 0]}>
                    {roiStats.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.avgROI)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Dźwignia</TableHead>
                    <TableHead className="text-center">Trade'y</TableHead>
                    <TableHead className="text-center">Win Rate</TableHead>
                    <TableHead className="text-right">Śr. ROI%</TableHead>
                    <TableHead className="text-right">Total PnL</TableHead>
                    <TableHead className="text-right">Śr. Margin</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {roiStats.map((stat) => {
                    const winRate = (stat.wins / stat.trades) * 100;
                    return (
                      <TableRow key={stat.range}>
                        <TableCell className="font-medium">{stat.range}</TableCell>
                        <TableCell className="text-center">
                          {stat.trades}
                          <span className="text-xs text-muted-foreground ml-1">
                            ({stat.wins}W)
                          </span>
                        </TableCell>
                        <TableCell className="text-center">
                          <span className={winRate >= 50 ? "text-profit" : "text-loss"}>
                            {winRate.toFixed(1)}%
                          </span>
                        </TableCell>
                        <TableCell className={`text-right font-bold ${stat.avgROI >= 0 ? "text-profit" : "text-loss"}`}>
                          {stat.avgROI.toFixed(2)}%
                        </TableCell>
                        <TableCell className={`text-right ${stat.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                          ${stat.totalPnL.toFixed(2)}
                        </TableCell>
                        <TableCell className="text-right text-muted-foreground">
                          ${stat.avgMarginUsed.toFixed(2)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">Brak danych ROI do analizy</p>
        )}
      </CardContent>
    </Card>
  );
}
