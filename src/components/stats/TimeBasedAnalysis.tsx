import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Calendar } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";

interface HourlyStats {
  hour: number;
  trades: number;
  winRate: number;
  avgPnL: number;
}

interface DailyStats {
  day: string;
  trades: number;
  winRate: number;
  avgPnL: number;
}

interface TimeBasedAnalysisProps {
  hourlyStats: HourlyStats[];
  dailyStats: DailyStats[];
}

const dayOrder = ["Poniedziałek", "Wtorek", "Środa", "Czwartek", "Piątek", "Sobota", "Niedziela"];

export function TimeBasedAnalysis({ hourlyStats, dailyStats }: TimeBasedAnalysisProps) {
  const getColor = (avgPnL: number) => {
    if (avgPnL > 0) return "hsl(var(--profit))";
    if (avgPnL < 0) return "hsl(var(--loss))";
    return "hsl(var(--muted-foreground))";
  };

  // Sort daily stats by day order
  const sortedDailyStats = [...dailyStats].sort((a, b) => {
    const indexA = dayOrder.indexOf(a.day);
    const indexB = dayOrder.indexOf(b.day);
    return indexA - indexB;
  });

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calendar className="h-5 w-5 text-primary" />
          Time-based Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs defaultValue="hourly" className="space-y-4">
          <TabsList className="grid w-full grid-cols-2">
            <TabsTrigger value="hourly">Według godziny</TabsTrigger>
            <TabsTrigger value="daily">Według dnia tygodnia</TabsTrigger>
          </TabsList>

          <TabsContent value="hourly" className="space-y-4">
            {hourlyStats.length > 0 ? (
              <>
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={hourlyStats}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                      <XAxis
                        dataKey="hour"
                        stroke="hsl(var(--muted-foreground))"
                        fontSize={11}
                        tickLine={false}
                        axisLine={false}
                        tickFormatter={(value) => `${value}:00`}
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
                          if (name === "avgPnL") return [`$${value.toFixed(2)}`, "Śr. PnL"];
                          if (name === "winRate") return [`${value.toFixed(1)}%`, "Win Rate"];
                          return [value, name];
                        }}
                        labelFormatter={(label) => `Godzina ${label}:00`}
                      />
                      <Bar dataKey="avgPnL" radius={[8, 8, 0, 0]}>
                        {hourlyStats.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={getColor(entry.avgPnL)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2">
                  {hourlyStats.map((stat) => (
                    <div
                      key={stat.hour}
                      className="p-3 rounded-lg border border-border bg-muted/30 text-center"
                    >
                      <div className="text-xs text-muted-foreground mb-1">
                        {stat.hour}:00
                      </div>
                      <div className="text-sm font-semibold mb-1">
                        {stat.trades} trades
                      </div>
                      <div className={`text-xs ${stat.avgPnL >= 0 ? "text-profit" : "text-loss"}`}>
                        ${stat.avgPnL.toFixed(2)}
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-center text-muted-foreground py-8">Brak danych godzinowych</p>
            )}
          </TabsContent>

          <TabsContent value="daily" className="space-y-4">
            {sortedDailyStats.length > 0 ? (
              <>
                <div className="h-[350px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={sortedDailyStats}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" opacity={0.3} />
                      <XAxis
                        dataKey="day"
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
                          if (name === "avgPnL") return [`$${value.toFixed(2)}`, "Śr. PnL"];
                          if (name === "winRate") return [`${value.toFixed(1)}%`, "Win Rate"];
                          return [value, name];
                        }}
                      />
                      <Bar dataKey="avgPnL" radius={[8, 8, 0, 0]}>
                        {sortedDailyStats.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={getColor(entry.avgPnL)} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-3">
                  {sortedDailyStats.map((stat) => (
                    <div
                      key={stat.day}
                      className="p-4 rounded-lg border border-border bg-card"
                    >
                      <div className="font-medium mb-2">{stat.day}</div>
                      <div className="space-y-1 text-sm">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Trade'y:</span>
                          <span className="font-medium">{stat.trades}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Win Rate:</span>
                          <span className={stat.winRate >= 50 ? "text-profit" : "text-loss"}>
                            {stat.winRate.toFixed(0)}%
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Śr. PnL:</span>
                          <span className={`font-semibold ${stat.avgPnL >= 0 ? "text-profit" : "text-loss"}`}>
                            ${stat.avgPnL.toFixed(2)}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </>
            ) : (
              <p className="text-center text-muted-foreground py-8">Brak danych dziennych</p>
            )}
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
