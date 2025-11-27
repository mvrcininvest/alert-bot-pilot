import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Bitcoin } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface CorrelationStats {
  range: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
}

interface BTCCorrelationCardProps {
  correlationStats: CorrelationStats[];
}

export function BTCCorrelationCard({ correlationStats }: BTCCorrelationCardProps) {
  const getColor = (winRate: number) => {
    if (winRate >= 60) return "hsl(var(--profit))";
    if (winRate >= 50) return "hsl(var(--primary))";
    if (winRate >= 40) return "hsl(var(--warning))";
    return "hsl(var(--loss))";
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bitcoin className="h-5 w-5 text-primary" />
          BTC Correlation Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        {correlationStats.length > 0 ? (
          <div className="space-y-6">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={correlationStats}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis
                    dataKey="range"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
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
                      if (name === "winRate") return [`${value.toFixed(1)}%`, "Win Rate"];
                      return [value, name];
                    }}
                  />
                  <Bar dataKey="winRate" radius={[8, 8, 0, 0]}>
                    {correlationStats.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.winRate)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
              {correlationStats.map((stat) => (
                <div
                  key={stat.range}
                  className="p-4 rounded-lg border border-border bg-card"
                >
                  <div className="text-sm font-medium text-muted-foreground mb-2">
                    {stat.range}
                  </div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Trade'y:</span>
                      <span className="font-medium">{stat.trades} ({stat.wins}W)</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Win Rate:</span>
                      <span className={stat.winRate >= 50 ? "text-profit font-semibold" : "text-loss"}>
                        {stat.winRate.toFixed(1)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Śr. PnL:</span>
                      <span className={stat.avgPnL >= 0 ? "text-profit" : "text-loss"}>
                        ${stat.avgPnL.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Total:</span>
                      <span className={`font-bold ${stat.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                        ${stat.totalPnL.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">Brak danych korelacji BTC</p>
        )}
      </CardContent>
    </Card>
  );
}
