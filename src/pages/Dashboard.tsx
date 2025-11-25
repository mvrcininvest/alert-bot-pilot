import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Activity, DollarSign, Wallet } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";

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

  const { data: accountBalance } = useQuery({
    queryKey: ["account-balance"],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke('bitget-api', {
        body: { action: 'get_account' }
      });
      
      if (error) throw error;
      
      if (data?.success && data.data?.[0]) {
        const accountInfo = data.data[0];
        return {
          equity: Number(accountInfo.accountEquity || accountInfo.available) || 0,
          available: Number(accountInfo.available || 0) || 0,
        };
      }
      
      return { equity: 0, available: 0 };
    },
    refetchInterval: 30000,
  });

  // Calculate used margin and unrealized PnL
  const usedMargin = positions?.reduce((sum, pos) => {
    const notional = Number(pos.quantity) * Number(pos.entry_price);
    const margin = notional / Number(pos.leverage);
    return sum + margin;
  }, 0) || 0;

  const totalUnrealizedPnL = positions?.reduce((sum, pos) => {
    return sum + (Number(pos.unrealized_pnl) || 0);
  }, 0) || 0;

  const usedMarginPercent = accountBalance?.equity 
    ? (usedMargin / accountBalance.equity) * 100 
    : 0;

  const unrealizedPnLPercent = accountBalance?.equity 
    ? (totalUnrealizedPnL / accountBalance.equity) * 100 
    : 0;

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
    refetchInterval: 5000,
  });


  const kpis = [
    {
      title: "Saldo Portfela",
      value: `$${(accountBalance?.equity || 0).toFixed(2)}`,
      icon: Wallet,
      trend: "neutral",
    },
    {
      title: "Dostępne Saldo",
      value: `$${(accountBalance?.available || 0).toFixed(2)}`,
      icon: DollarSign,
      trend: "neutral",
    },
    {
      title: "Używane Saldo",
      value: `$${usedMargin.toFixed(2)} (${usedMarginPercent.toFixed(1)}%)`,
      icon: Activity,
      trend: "neutral",
    },
    {
      title: "Unrealized PnL",
      value: `$${totalUnrealizedPnL.toFixed(2)} (${unrealizedPnLPercent >= 0 ? '+' : ''}${unrealizedPnLPercent.toFixed(2)}%)`,
      icon: TrendingUp,
      trend: totalUnrealizedPnL >= 0 ? "up" : "down",
      textColor: totalUnrealizedPnL >= 0 ? "text-profit" : "text-loss",
    },
    {
      title: "Otwarte Pozycje",
      value: positions?.length || 0,
      icon: Activity,
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
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {kpis.map((kpi) => (
          <Card key={kpi.title}>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium">{kpi.title}</CardTitle>
              <kpi.icon className="h-4 w-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${kpi.textColor || ''}`}>{kpi.value}</div>
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
            <ScrollArea className="h-[300px]">
              <div className="space-y-4">
                {positions && positions.length > 0 ? (
                  positions.map((pos) => (
                    <div key={pos.id} className="border-b border-border pb-3 last:border-0 last:pb-0">
                      <div className="flex items-center justify-between mb-2">
                        <div className="font-medium">{pos.symbol}</div>
                        <Badge variant={pos.side === "BUY" ? "default" : "destructive"}>
                          {pos.side} {pos.leverage}x
                        </Badge>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-sm">
                        <div>
                          <span className="text-muted-foreground">Entry:</span> ${Number(pos.entry_price).toFixed(4)}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Current:</span> ${Number(pos.current_price || pos.entry_price).toFixed(4)}
                        </div>
                        <div>
                          <span className="text-muted-foreground">Quantity:</span> {Number(pos.quantity).toFixed(4)}
                        </div>
                        <div className={Number(pos.unrealized_pnl || 0) >= 0 ? "text-profit" : "text-loss"}>
                          <span className="text-muted-foreground">PnL:</span> ${Number(pos.unrealized_pnl || 0).toFixed(2)}
                        </div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-center text-muted-foreground py-8">Brak otwartych pozycji</p>
                )}
              </div>
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Ostatnie Alerty */}
        <Card>
          <CardHeader>
            <CardTitle>Ostatnie Alerty</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[300px]">
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
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
