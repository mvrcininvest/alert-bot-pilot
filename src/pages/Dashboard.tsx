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

  // Fetch live prices and orders from Bitget for open positions
  const { data: liveData } = useQuery({
    queryKey: ["live-data", positions?.map(p => p.symbol).join(',')],
    queryFn: async () => {
      if (!positions || positions.length === 0) return {};
      
      const dataMap: Record<string, any> = {};
      
      // Fetch current prices and orders from Bitget for each symbol
      for (const pos of positions) {
        try {
          // Get current price
          const { data: tickerData } = await supabase.functions.invoke('bitget-api', {
            body: { 
              action: 'get_ticker',
              params: { symbol: pos.symbol }
            }
          });
          
  // Get plan orders (SL/TP)
          const { data: ordersData } = await supabase.functions.invoke('bitget-api', {
            body: { 
              action: 'get_plan_orders',
              params: { 
                symbol: pos.symbol
              }
            }
          });
          
          dataMap[pos.symbol] = {
            currentPrice: tickerData?.success && tickerData.data?.[0]?.lastPr 
              ? Number(tickerData.data[0].lastPr) 
              : null,
            slOrders: ordersData?.success && ordersData.data?.entrustedList
              ? ordersData.data.entrustedList.filter((o: any) => 
                  o.symbol.toLowerCase() === pos.symbol.toLowerCase() &&
                  (o.planType === 'pos_loss' || o.planType === 'loss_plan' || 
                   (o.planType === 'profit_loss' && o.stopLossTriggerPrice)) && 
                  o.planStatus === 'live'
                )
              : [],
            tpOrders: ordersData?.success && ordersData.data?.entrustedList
              ? ordersData.data.entrustedList.filter((o: any) => 
                  o.symbol.toLowerCase() === pos.symbol.toLowerCase() &&
                  (o.planType === 'pos_profit' || o.planType === 'profit_plan' || 
                   (o.planType === 'profit_loss' && o.stopSurplusTriggerPrice)) && 
                  o.planStatus === 'live'
                )
              : []
          };
        } catch (err) {
          console.error(`Failed to fetch data for ${pos.symbol}:`, err);
          dataMap[pos.symbol] = { currentPrice: null, slOrders: [], tpOrders: [] };
        }
      }
      
      return dataMap;
    },
    enabled: !!positions && positions.length > 0,
    refetchInterval: 3000, // Update every 3 seconds
  });

  // Calculate live PnL for positions
  const positionsWithLivePnL = positions?.map(pos => {
    const liveInfo = liveData?.[pos.symbol];
    const currentPrice = liveInfo?.currentPrice || Number(pos.current_price) || Number(pos.entry_price);
    const quantity = Number(pos.quantity);
    const entryPrice = Number(pos.entry_price);
    
    let unrealizedPnL = 0;
    if (pos.side === 'BUY') {
      unrealizedPnL = (currentPrice - entryPrice) * quantity;
    } else {
      unrealizedPnL = (entryPrice - currentPrice) * quantity;
    }
    
    // Get SL/TP from exchange orders
    const slOrders = liveInfo?.slOrders || [];
    const tpOrders = liveInfo?.tpOrders || [];
    
    // Extract trigger prices - check both specific fields and general triggerPrice
    const realSlPrice = slOrders.length > 0 
      ? Number(slOrders[0].stopLossTriggerPrice || slOrders[0].triggerPrice) 
      : null;
    const realTpPrices = tpOrders
      .map((o: any) => Number(o.stopSurplusTriggerPrice || o.triggerPrice))
      .filter((price: number) => !isNaN(price))
      .sort((a: number, b: number) => 
        pos.side === 'BUY' ? a - b : b - a
      );
    
    return {
      ...pos,
      current_price: currentPrice,
      unrealized_pnl: unrealizedPnL,
      real_sl_price: realSlPrice,
      real_tp_prices: realTpPrices,
      has_sl_order: slOrders.length > 0,
      has_tp_orders: tpOrders.length > 0
    };
  }) || [];

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
  const usedMargin = positionsWithLivePnL?.reduce((sum, pos) => {
    const notional = Number(pos.quantity) * Number(pos.entry_price);
    const margin = notional / Number(pos.leverage);
    return sum + margin;
  }, 0) || 0;

  const totalUnrealizedPnL = positionsWithLivePnL?.reduce((sum, pos) => {
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
      value: positionsWithLivePnL?.length || 0,
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
                {positionsWithLivePnL && positionsWithLivePnL.length > 0 ? (
                  positionsWithLivePnL.map((pos) => {
                    const positionValue = Number(pos.quantity) * Number(pos.entry_price);
                    const marginUsed = positionValue / Number(pos.leverage);
                    // PnL% relative to margin (ROI with leverage)
                    const pnlPercent = marginUsed !== 0 
                      ? ((Number(pos.unrealized_pnl) || 0) / marginUsed) * 100 
                      : 0;
                    const notionalValue = Number(pos.quantity) * Number(pos.entry_price);
                    
                    // Use real SL/TP from exchange, fallback to DB values
                    const displaySlPrice = pos.real_sl_price || Number(pos.sl_price);
                    const displayTpPrices = pos.real_tp_prices && pos.real_tp_prices.length > 0 
                      ? pos.real_tp_prices 
                      : [pos.tp1_price, pos.tp2_price, pos.tp3_price].filter(Boolean).map(Number);
                    
                    return (
                      <div key={pos.id} className="border border-border rounded-lg p-3">
                        <div className="flex items-center justify-between mb-3">
                          <div className="font-medium text-lg">{pos.symbol}</div>
                          <div className="flex gap-2">
                            <Badge variant={pos.side === "BUY" ? "default" : "destructive"}>
                              {pos.side} {pos.leverage}x
                            </Badge>
                            {!pos.has_sl_order && (
                              <Badge variant="destructive" className="text-xs">
                                ⚠️ NO SL
                              </Badge>
                            )}
                            {!pos.has_tp_orders && displayTpPrices.length > 0 && (
                              <Badge variant="outline" className="text-xs">
                                ⚠️ NO TP
                              </Badge>
                            )}
                          </div>
                        </div>
                        
                        <div className="grid grid-cols-2 gap-2 text-sm mb-3">
                          <div>
                            <span className="text-muted-foreground">Entry:</span>{" "}
                            <span className="font-medium">${Number(pos.entry_price).toFixed(4)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Current:</span>{" "}
                            <span className="font-medium">${Number(pos.current_price).toFixed(4)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Quantity:</span>{" "}
                            <span className="font-medium">{Number(pos.quantity).toFixed(4)}</span>
                          </div>
                          <div>
                            <span className="text-muted-foreground">Notional:</span>{" "}
                            <span className="font-medium">${notionalValue.toFixed(2)}</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2 text-sm mb-3 border-t border-border pt-2">
                          <div>
                            <span className="text-muted-foreground">SL:</span>{" "}
                            {pos.has_sl_order ? (
                              <span className="font-medium text-loss">
                                ${(pos.real_sl_price || Number(pos.sl_price)).toFixed(4)}
                              </span>
                            ) : (
                              <span className="font-medium text-muted-foreground">-</span>
                            )}
                          </div>
                          <div>
                            <span className="text-muted-foreground">TP1:</span>{" "}
                            {pos.has_tp_orders && pos.real_tp_prices && pos.real_tp_prices.length > 0 ? (
                              <span className="font-medium text-profit">
                                ${pos.real_tp_prices[0].toFixed(4)}
                              </span>
                            ) : (
                              <span className="font-medium text-muted-foreground">-</span>
                            )}
                          </div>
                          {pos.has_tp_orders && pos.real_tp_prices && pos.real_tp_prices[1] && (
                            <div>
                              <span className="text-muted-foreground">TP2:</span>{" "}
                              <span className="font-medium text-profit">${pos.real_tp_prices[1].toFixed(4)}</span>
                            </div>
                          )}
                          {pos.has_tp_orders && pos.real_tp_prices && pos.real_tp_prices[2] && (
                            <div>
                              <span className="text-muted-foreground">TP3:</span>{" "}
                              <span className="font-medium text-profit">${pos.real_tp_prices[2].toFixed(4)}</span>
                            </div>
                          )}
                        </div>

                        <div className={`text-right font-bold text-base ${Number(pos.unrealized_pnl || 0) >= 0 ? "text-profit" : "text-loss"}`}>
                          PnL: ${Number(pos.unrealized_pnl || 0).toFixed(2)} ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)
                        </div>
                      </div>
                    );
                  })
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
