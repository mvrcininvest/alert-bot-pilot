import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";
import { ScatterChart, Scatter, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ZAxis } from "recharts";

interface VolatilityStats {
  range: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
  avgATR: number;
}

interface VolatilityAnalysisCardProps {
  volatilityStats: VolatilityStats[];
}

export function VolatilityAnalysisCard({ volatilityStats }: VolatilityAnalysisCardProps) {
  // Prepare data for scatter plot
  const scatterData = volatilityStats.map(stat => ({
    x: stat.avgATR,
    y: stat.avgPnL,
    z: stat.trades,
    name: stat.range,
    winRate: stat.winRate,
  }));

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Volatility (ATR) Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        {volatilityStats.length > 0 ? (
          <div className="space-y-6">
            <div className="h-[350px]">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis
                    type="number"
                    dataKey="x"
                    name="ATR"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    label={{ value: 'Średni ATR', position: 'insideBottom', offset: -5, fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <YAxis
                    type="number"
                    dataKey="y"
                    name="PnL"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `$${value}`}
                    label={{ value: 'Średni PnL', angle: -90, position: 'insideLeft', fill: 'hsl(var(--muted-foreground))' }}
                  />
                  <ZAxis type="number" dataKey="z" range={[50, 400]} name="Trades" />
                  <Tooltip
                    cursor={{ strokeDasharray: '3 3' }}
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === "ATR") return [value.toFixed(4), "Średni ATR"];
                      if (name === "PnL") return [`$${value.toFixed(2)}`, "Średni PnL"];
                      if (name === "Trades") return [value, "Liczba trade'ów"];
                      return [value, name];
                    }}
                    labelFormatter={(label: any, payload: any) => {
                      if (payload && payload.length > 0) {
                        return `${payload[0].payload.name} (Win Rate: ${payload[0].payload.winRate.toFixed(1)}%)`;
                      }
                      return label;
                    }}
                  />
                  <Scatter 
                    data={scatterData} 
                    fill="hsl(var(--primary))"
                    fillOpacity={0.6}
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
              {volatilityStats.map((stat) => (
                <div
                  key={stat.range}
                  className="p-4 rounded-lg border border-border bg-card"
                >
                  <div className="text-sm font-medium text-muted-foreground mb-2">
                    ATR: {stat.range}
                  </div>
                  <div className="space-y-1.5 text-sm">
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Trade'y:</span>
                      <span className="font-medium text-xs">{stat.trades}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Win Rate:</span>
                      <span className={`text-xs font-semibold ${stat.winRate >= 50 ? "text-profit" : "text-loss"}`}>
                        {stat.winRate.toFixed(0)}%
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-muted-foreground">Śr. PnL:</span>
                      <span className={`text-xs ${stat.avgPnL >= 0 ? "text-profit" : "text-loss"}`}>
                        ${stat.avgPnL.toFixed(2)}
                      </span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">Brak danych volatility</p>
        )}
      </CardContent>
    </Card>
  );
}
