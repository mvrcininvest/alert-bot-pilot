import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Minus } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface RegimeStats {
  regime: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
}

interface RegimeAnalysisCardProps {
  regimeStats: RegimeStats[];
}

const regimeIcons = {
  UPTREND: TrendingUp,
  DOWNTREND: TrendingDown,
  NEUTRAL: Minus,
  RANGING: Minus,
  Unknown: Minus,
};

const regimeColors = {
  UPTREND: "hsl(var(--profit))",
  DOWNTREND: "hsl(var(--loss))",
  NEUTRAL: "hsl(var(--warning))",
  RANGING: "hsl(var(--muted-foreground))",
  Unknown: "hsl(var(--muted-foreground))",
};

export function RegimeAnalysisCard({ regimeStats }: RegimeAnalysisCardProps) {
  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <TrendingUp className="h-5 w-5 text-primary" />
          Regime Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        {regimeStats.length > 0 ? (
          <div className="space-y-6">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={regimeStats} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis 
                    type="number"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="regime"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={12}
                    tickLine={false}
                    axisLine={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number, name: string) => {
                      if (name === "totalPnL") return [`$${value.toFixed(2)}`, "Total PnL"];
                      return [value, name];
                    }}
                  />
                  <Bar dataKey="totalPnL" radius={[0, 8, 8, 0]}>
                    {regimeStats.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={regimeColors[entry.regime as keyof typeof regimeColors] || regimeColors.Unknown}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              {regimeStats.map((stat) => {
                const Icon = regimeIcons[stat.regime as keyof typeof regimeIcons] || regimeIcons.Unknown;
                const color = stat.regime === "UPTREND" ? "text-profit" : 
                             stat.regime === "DOWNTREND" ? "text-loss" : 
                             "text-warning";
                
                return (
                  <div
                    key={stat.regime}
                    className="p-4 rounded-lg border border-border bg-card"
                  >
                    <div className="flex items-center gap-2 mb-3">
                      <Icon className={`h-5 w-5 ${color}`} />
                      <div className="font-semibold">{stat.regime}</div>
                    </div>
                    <div className="space-y-2 text-sm">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Trade'y:</span>
                        <span className="font-medium">{stat.trades} ({stat.wins}W/{stat.losses}L)</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Win Rate:</span>
                        <span className={stat.winRate >= 50 ? "text-profit font-semibold" : "text-loss"}>
                          {stat.winRate.toFixed(1)}%
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Total PnL:</span>
                        <span className={`font-bold ${stat.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                          ${stat.totalPnL.toFixed(2)}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">Śr. PnL:</span>
                        <span className={stat.avgPnL >= 0 ? "text-profit" : "text-loss"}>
                          ${stat.avgPnL.toFixed(2)}
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">Brak danych regime do analizy</p>
        )}
      </CardContent>
    </Card>
  );
}
