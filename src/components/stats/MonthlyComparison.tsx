import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from "recharts";

interface MonthlyData {
  month: string;
  totalPnL: number;
  trades: number;
  winRate: number;
}

interface MonthlyComparisonProps {
  monthlyData: MonthlyData[];
}

export function MonthlyComparison({ monthlyData }: MonthlyComparisonProps) {
  const getColor = (pnl: number) => {
    if (pnl > 0) return "hsl(var(--profit))";
    if (pnl < 0) return "hsl(var(--loss))";
    return "hsl(var(--muted-foreground))";
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          Porównanie Miesięczne
        </CardTitle>
      </CardHeader>
      <CardContent>
        {monthlyData.length > 0 ? (
          <div className="space-y-6">
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={monthlyData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis
                    dataKey="month"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    angle={-45}
                    textAnchor="end"
                    height={80}
                  />
                  <YAxis
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === "totalPnL") return [`$${value.toFixed(2)}`, "PnL"];
                      if (name === "winRate") return [`${value.toFixed(1)}%`, "Win Rate"];
                      return [value, name];
                    }}
                  />
                  <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                  <Bar dataKey="totalPnL" radius={[8, 8, 0, 0]}>
                    {monthlyData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={getColor(entry.totalPnL)} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {monthlyData.map((month) => (
                <div
                  key={month.month}
                  className="p-4 rounded-lg border border-border bg-card"
                >
                  <div className="font-semibold mb-3">{month.month}</div>
                  <div className="space-y-2 text-sm">
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">PnL:</span>
                      <span className={`font-bold ${month.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                        ${month.totalPnL.toFixed(2)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Trade'y:</span>
                      <span className="font-medium">{month.trades}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-muted-foreground">Win Rate:</span>
                      <span className={month.winRate >= 50 ? "text-profit" : "text-loss"}>
                        {month.winRate.toFixed(1)}%
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">Brak danych miesięcznych</p>
        )}
      </CardContent>
    </Card>
  );
}
