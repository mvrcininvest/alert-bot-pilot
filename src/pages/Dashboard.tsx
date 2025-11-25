import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, TrendingDown, Activity, DollarSign } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function Dashboard() {
  const { data: positions } = useQuery({
    queryKey: ["open-positions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("*")
        .eq("status", "open")
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 5000,
  });

  const { data: stats } = useQuery({
    queryKey: ["performance-stats"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("realized_pnl, status")
        .eq("status", "closed");
      
      if (error) throw error;
      
      const totalPnL = data?.reduce((sum, pos) => sum + (Number(pos.realized_pnl) || 0), 0) || 0;
      const winningTrades = data?.filter(pos => Number(pos.realized_pnl) > 0).length || 0;
      const totalTrades = data?.length || 0;
      const winRate = totalTrades > 0 ? (winningTrades / totalTrades) * 100 : 0;
      
      return { totalPnL, winRate, totalTrades, openPositions: positions?.length || 0 };
    },
  });

  const { data: recentAlerts } = useQuery({
    queryKey: ["recent-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(5);
      
      if (error) throw error;
      return data || [];
    },
  });

  const kpis = [
    {
      title: "Całkowity PnL",
      value: `$${(stats?.totalPnL || 0).toFixed(2)}`,
      icon: DollarSign,
      trend: (stats?.totalPnL || 0) >= 0 ? "up" : "down",
    },
    {
      title: "Win Rate",
      value: `${(stats?.winRate || 0).toFixed(1)}%`,
      icon: TrendingUp,
      trend: "neutral",
    },
    {
      title: "Otwarte Pozycje",
      value: positions?.length || 0,
      icon: Activity,
      trend: "neutral",
    },
    {
      title: "Wszystkie Trade'y",
      value: stats?.totalTrades || 0,
      icon: TrendingDown,
      trend: "neutral",
    },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Dashboard</h1>
        <p className="text-muted-foreground">Przegląd aktywności bota tradingowego</p>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        {kpis.map((kpi) => (
          <Card key={kpi.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{kpi.title}</CardTitle>
              <kpi.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{kpi.value}</div>
            </CardContent>
          </Card>
        ))}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Otwarte Pozycje */}
        <Card>
          <CardHeader>
            <CardTitle>Otwarte Pozycje</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {positions && positions.length > 0 ? (
                positions.slice(0, 5).map((position) => (
                  <div key={position.id} className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
                    <div>
                      <div className="font-medium">{position.symbol}</div>
                      <div className="text-sm text-muted-foreground">
                        <Badge variant={position.side === "BUY" ? "default" : "destructive"}>
                          {position.side}
                        </Badge>
                        {" "}@ ${Number(position.entry_price).toFixed(4)}
                      </div>
                    </div>
                    <div className="text-right">
                      <div className={Number(position.unrealized_pnl || 0) >= 0 ? "text-profit" : "text-loss"}>
                        ${Number(position.unrealized_pnl || 0).toFixed(2)}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        {Number(position.quantity).toFixed(4)}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground py-8">Brak otwartych pozycji</p>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Ostatnie Alerty */}
        <Card>
          <CardHeader>
            <CardTitle>Ostatnie Alerty</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {recentAlerts && recentAlerts.length > 0 ? (
                recentAlerts.map((alert) => (
                  <div key={alert.id} className="flex items-center justify-between border-b border-border pb-3 last:border-0 last:pb-0">
                    <div>
                      <div className="font-medium">{alert.symbol}</div>
                      <div className="text-sm text-muted-foreground">
                        {alert.tier} • Strength: {Number(alert.strength || 0).toFixed(2)}
                      </div>
                    </div>
                    <Badge variant={
                      alert.status === "executed" ? "default" :
                      alert.status === "ignored" ? "secondary" :
                      alert.status === "error" ? "destructive" :
                      "outline"
                    }>
                      {alert.status}
                    </Badge>
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground py-8">Brak alertów</p>
              )}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
