import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Settings } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface ModeStats {
  mode: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
}

interface ModeAnalysisCardProps {
  modeStats: ModeStats[];
}

const modeColors: Record<string, string> = {
  "aggressive": "hsl(var(--loss))",
  "conservative": "hsl(var(--profit))",
  "balanced": "hsl(var(--primary))",
  "scalping": "hsl(var(--warning))",
  "Unknown": "hsl(var(--muted-foreground))",
};

export function ModeAnalysisCard({ modeStats }: ModeAnalysisCardProps) {
  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Settings className="h-5 w-5 text-primary" />
          Mode Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        {modeStats.length > 0 ? (
          <div className="space-y-6">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={modeStats} layout="vertical">
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                  <XAxis 
                    type="number"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
                    tickLine={false}
                    axisLine={false}
                    tickFormatter={(value) => `$${value}`}
                  />
                  <YAxis
                    type="category"
                    dataKey="mode"
                    stroke="hsl(var(--muted-foreground))"
                    fontSize={11}
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
                    {modeStats.map((entry, index) => (
                      <Cell 
                        key={`cell-${index}`} 
                        fill={modeColors[entry.mode.toLowerCase()] || modeColors.Unknown}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {modeStats.map((stat) => (
                <div
                  key={stat.mode}
                  className="p-4 rounded-lg border border-border bg-card"
                >
                  <div className="font-semibold mb-3 capitalize">{stat.mode}</div>
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
                      <span className="text-muted-foreground">Total PnL:</span>
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
          <p className="text-center text-muted-foreground py-8">Brak danych mode</p>
        )}
      </CardContent>
    </Card>
  );
}
