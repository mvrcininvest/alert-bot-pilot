import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Zap } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface StrengthStats {
  range: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
}

interface SignalStrengthCardProps {
  strengthStats: StrengthStats[];
}

export function SignalStrengthCard({ strengthStats }: SignalStrengthCardProps) {
  // Color based on win rate
  const getColor = (winRate: number) => {
    if (winRate >= 70) return "hsl(var(--profit))";
    if (winRate >= 50) return "hsl(var(--primary))";
    if (winRate >= 40) return "hsl(var(--warning))";
    return "hsl(var(--loss))";
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Zap className="h-5 w-5 text-primary" />
          Signal Strength Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        {strengthStats.length > 0 ? (
          <div className="space-y-6">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={strengthStats}>
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
                      if (name === "winRate") return [`${value.toFixed(1)}%`, "Win Rate"];
                      return [value, name];
                    }}
                  />
                  <Bar dataKey="winRate" radius={[8, 8, 0, 0]}>
                    {strengthStats.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.winRate)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {strengthStats.map((stat) => (
                <div
                  key={stat.range}
                  className="p-4 rounded-lg border border-border bg-muted/30"
                >
                  <div className="text-sm font-medium text-muted-foreground mb-1">
                    {stat.range}
                  </div>
                  <div className="flex items-baseline gap-2 mb-2">
                    <div className={`text-2xl font-bold ${stat.winRate >= 50 ? "text-profit" : "text-loss"}`}>
                      {stat.winRate.toFixed(0)}%
                    </div>
                    <div className="text-xs text-muted-foreground">
                      win rate
                    </div>
                  </div>
                  <div className="text-xs text-muted-foreground space-y-1">
                    <div>{stat.trades} trades ({stat.wins}W)</div>
                    <div className={stat.totalPnL >= 0 ? "text-profit" : "text-loss"}>
                      ${stat.totalPnL.toFixed(2)} total
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">Brak danych signal strength do analizy</p>
        )}
      </CardContent>
    </Card>
  );
}
