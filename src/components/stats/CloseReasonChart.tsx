import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target, AlertTriangle, Hand } from "lucide-react";
import { PieChart, Pie, Cell, ResponsiveContainer, Legend, Tooltip } from "recharts";

interface CloseReasonStats {
  reason: string;
  count: number;
  percentage: number;
}

interface CloseReasonChartProps {
  closeReasons: CloseReasonStats[];
}

const COLORS = {
  tp1: "hsl(var(--profit))",
  tp2: "hsl(var(--primary))",
  tp3: "hsl(var(--accent))",
  sl: "hsl(var(--loss))",
  manual: "hsl(var(--warning))",
  other: "hsl(var(--muted-foreground))",
};

const ICONS = {
  tp1: "✓",
  tp2: "✓✓",
  tp3: "✓✓✓",
  sl: "✕",
  manual: "⚙",
  other: "•",
};

export function CloseReasonChart({ closeReasons }: CloseReasonChartProps) {
  const chartData = closeReasons.map((item) => ({
    name: item.reason,
    value: item.count,
    percentage: item.percentage,
  }));

  const renderCustomLabel = (entry: any) => {
    return `${entry.percentage.toFixed(0)}%`;
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          Close Reason Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        {closeReasons.length > 0 ? (
          <div className="space-y-6">
            <div className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={chartData}
                    cx="50%"
                    cy="50%"
                    labelLine={false}
                    label={renderCustomLabel}
                    outerRadius={100}
                    fill="#8884d8"
                    dataKey="value"
                  >
                    {chartData.map((entry, index) => {
                      const key = entry.name.toLowerCase().replace(" ", "_");
                      const color = COLORS[key as keyof typeof COLORS] || COLORS.other;
                      return <Cell key={`cell-${index}`} fill={color} />;
                    })}
                  </Pie>
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "hsl(var(--card))",
                      border: "1px solid hsl(var(--border))",
                      borderRadius: "8px",
                    }}
                    formatter={(value: number, name: string) => [
                      `${value} trade${value !== 1 ? "s" : ""}`,
                      name,
                    ]}
                  />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {closeReasons.map((reason) => {
                const key = reason.reason.toLowerCase().replace(" ", "_");
                const icon = ICONS[key as keyof typeof ICONS] || ICONS.other;
                const isProfit = key.includes("tp");
                return (
                  <div
                    key={reason.reason}
                    className="flex items-center gap-3 p-3 rounded-lg border border-border bg-muted/30"
                  >
                    <div className={`text-2xl ${isProfit ? "text-profit" : "text-loss"}`}>
                      {icon}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{reason.reason}</div>
                      <div className="text-xs text-muted-foreground">
                        {reason.count} ({reason.percentage.toFixed(1)}%)
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">Brak danych close reason do analizy</p>
        )}
      </CardContent>
    </Card>
  );
}
