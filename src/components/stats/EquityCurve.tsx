import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp } from "lucide-react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import { format } from "date-fns";
import { pl } from "date-fns/locale";

interface EquityPoint {
  date: string;
  cumulativePnL: number;
  displayDate: string;
}

interface EquityCurveProps {
  equityData: EquityPoint[];
  maxDrawdown: number;
  maxDrawdownDate?: string;
}

export function EquityCurve({ equityData, maxDrawdown, maxDrawdownDate }: EquityCurveProps) {
  const formatTooltipDate = (dateStr: string) => {
    try {
      return format(new Date(dateStr), "dd MMM yyyy, HH:mm", { locale: pl });
    } catch {
      return dateStr;
    }
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5 text-primary" />
            Equity Curve
          </div>
          {maxDrawdown !== 0 && (
            <div className="text-sm font-normal">
              <span className="text-muted-foreground">Max Drawdown: </span>
              <span className="text-loss font-bold">${maxDrawdown.toFixed(2)}</span>
            </div>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent>
        {equityData.length > 0 ? (
          <div className="h-[400px]">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={equityData}>
                <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                <XAxis
                  dataKey="displayDate"
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
                  tickFormatter={(value) => `$${value}`}
                />
                <Tooltip
                  contentStyle={{
                    backgroundColor: "hsl(var(--card))",
                    border: "1px solid hsl(var(--border))",
                    borderRadius: "8px",
                  }}
                  labelFormatter={(label) => formatTooltipDate(equityData.find(d => d.displayDate === label)?.date || "")}
                  formatter={(value: number) => [`$${value.toFixed(2)}`, "PnL"]}
                />
                <ReferenceLine y={0} stroke="hsl(var(--muted-foreground))" strokeDasharray="3 3" />
                <Line
                  type="monotone"
                  dataKey="cumulativePnL"
                  stroke="hsl(var(--primary))"
                  strokeWidth={2}
                  dot={false}
                  activeDot={{ r: 6, fill: "hsl(var(--primary))" }}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">Brak danych do wykresu equity</p>
        )}
      </CardContent>
    </Card>
  );
}
