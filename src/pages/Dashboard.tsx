import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { TrendingUp, Activity, DollarSign, Wallet, TrendingDown, Target } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { Progress } from "@/components/ui/progress";

export default function Dashboard() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: positions, refetch: refetchPositions } = useQuery({
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
    refetchOnMount: true,
    refetchOnWindowFocus: true,
    staleTime: 0, // Always treat data as stale
  });

  const { data: liveData } = useQuery({
    queryKey: ["live-data", positions?.map(p => p.symbol).join(',')],
    queryFn: async () => {
      if (!positions || positions.length === 0) return {};
      
      const dataMap: Record<string, any> = {};
      
      for (const pos of positions) {
        try {
          const { data: tickerData } = await supabase.functions.invoke('bitget-api', {
            body: { 
              action: 'get_ticker',
              params: { symbol: pos.symbol }
            }
          });
          
          const { data: ordersData } = await supabase.functions.invoke('bitget-api', {
            body: { 
              action: 'get_plan_orders',
              params: { symbol: pos.symbol }
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
    refetchInterval: 3000,
  });

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
    
    const slOrders = liveInfo?.slOrders || [];
    const tpOrders = liveInfo?.tpOrders || [];
    
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
      gradient: "from-primary to-accent",
      iconBg: "bg-primary/10",
    },
    {
      title: "Dostępne Saldo",
      value: `$${(accountBalance?.available || 0).toFixed(2)}`,
      icon: DollarSign,
      gradient: "from-accent to-accent-pink",
      iconBg: "bg-accent/10",
    },
    {
      title: "Używane Saldo",
      value: `$${usedMargin.toFixed(2)}`,
      subtitle: `${usedMarginPercent.toFixed(1)}%`,
      icon: Activity,
      gradient: "from-info to-primary",
      iconBg: "bg-info/10",
    },
    {
      title: "Unrealized PnL",
      value: `$${totalUnrealizedPnL.toFixed(2)}`,
      subtitle: `${unrealizedPnLPercent >= 0 ? '+' : ''}${unrealizedPnLPercent.toFixed(2)}%`,
      icon: totalUnrealizedPnL >= 0 ? TrendingUp : TrendingDown,
      gradient: totalUnrealizedPnL >= 0 ? "from-profit to-profit-glow" : "from-loss to-loss-glow",
      iconBg: totalUnrealizedPnL >= 0 ? "bg-profit/10" : "bg-loss/10",
      textColor: totalUnrealizedPnL >= 0 ? "text-profit" : "text-loss",
    },
    {
      title: "Otwarte Pozycje",
      value: positionsWithLivePnL?.length || 0,
      icon: Target,
      gradient: "from-accent-pink to-destructive",
      iconBg: "bg-accent-pink/10",
    },
  ];

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="space-y-2">
        <h1 className="text-4xl font-bold tracking-tight">
          <span className="text-gradient">Dashboard</span>
        </h1>
        <p className="text-muted-foreground text-lg">Przegląd aktywności bota tradingowego w czasie rzeczywistym</p>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-5">
        {kpis.map((kpi, index) => (
          <Card 
            key={kpi.title} 
            className="glass-card glass-card-hover gradient-border animate-fade-in-up relative overflow-hidden group"
            style={{ animationDelay: `${index * 0.1}s` }}
          >
            <div className={`absolute inset-0 bg-gradient-to-br ${kpi.gradient} opacity-0 group-hover:opacity-5 transition-opacity duration-500`} />
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="text-sm font-medium text-muted-foreground">{kpi.title}</CardTitle>
              <div className={`${kpi.iconBg} p-2 rounded-lg`}>
                <kpi.icon className="h-4 w-4 text-primary" />
              </div>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${kpi.textColor || ''}`}>
                {kpi.value}
              </div>
              {kpi.subtitle && (
                <p className={`text-xs mt-1 ${kpi.textColor || 'text-muted-foreground'}`}>
                  {kpi.subtitle}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Open Positions */}
      <Card className="glass-card glass-card-hover gradient-border">
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="text-2xl font-bold">Otwarte Pozycje</CardTitle>
            <Badge variant="outline" className="text-sm">
              {positionsWithLivePnL?.length || 0} pozycji
            </Badge>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[450px] pr-4">
            <div className="space-y-4">
              {positionsWithLivePnL && positionsWithLivePnL.length > 0 ? (
                positionsWithLivePnL.map((pos, index) => {
                  const positionValue = Number(pos.quantity) * Number(pos.entry_price);
                  const marginUsed = positionValue / Number(pos.leverage);
                  const pnlPercent = marginUsed !== 0 
                    ? ((Number(pos.unrealized_pnl) || 0) / marginUsed) * 100 
                    : 0;
                  const notionalValue = Number(pos.quantity) * Number(pos.entry_price);
                  
                  const displaySlPrice = pos.real_sl_price || Number(pos.sl_price);
                  const displayTpPrices = pos.real_tp_prices && pos.real_tp_prices.length > 0 
                    ? pos.real_tp_prices 
                    : [pos.tp1_price, pos.tp2_price, pos.tp3_price].filter(Boolean).map(Number);
                  
                  // Calculate progress to TP/SL
                  const currentPrice = Number(pos.current_price);
                  const entryPrice = Number(pos.entry_price);
                  const slPrice = displaySlPrice;
                  const tpPrice = displayTpPrices[0] || 0;
                  
                  let progressToTP = 0;
                  if (pos.side === 'BUY' && tpPrice > entryPrice) {
                    progressToTP = ((currentPrice - entryPrice) / (tpPrice - entryPrice)) * 100;
                  } else if (pos.side === 'SELL' && tpPrice < entryPrice) {
                    progressToTP = ((entryPrice - currentPrice) / (entryPrice - tpPrice)) * 100;
                  }
                  progressToTP = Math.max(0, Math.min(100, progressToTP));
                  
                  return (
                    <div 
                      key={pos.id} 
                      className="glass-card p-4 relative overflow-hidden group animate-fade-in"
                      style={{ animationDelay: `${index * 0.05}s` }}
                    >
                      {/* Side accent bar */}
                      <div className={`absolute left-0 top-0 bottom-0 w-1 ${pos.side === 'BUY' ? 'bg-gradient-to-b from-profit to-profit-glow' : 'bg-gradient-to-b from-loss to-loss-glow'}`} />
                      
                      {/* Header */}
                      <div className="flex items-center justify-between mb-4 pl-3">
                        <div className="flex items-center gap-3">
                          <div>
                            <h3 className="text-xl font-bold">{pos.symbol}</h3>
                            <p className="text-xs text-muted-foreground">
                              {new Date(pos.created_at).toLocaleString('pl-PL')}
                            </p>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <Badge 
                            variant={pos.side === "BUY" ? "default" : "destructive"}
                            className={pos.side === "BUY" ? "bg-profit/20 text-profit border-profit/30" : "bg-loss/20 text-loss border-loss/30"}
                          >
                            {pos.side} {pos.leverage}x
                          </Badge>
                          {!pos.has_sl_order && (
                            <Badge variant="destructive" className="text-xs animate-pulse">
                              ⚠️ NO SL
                            </Badge>
                          )}
                          {!pos.has_tp_orders && displayTpPrices.length > 0 && (
                            <Badge variant="outline" className="text-xs">
                              ⚠️ NO TP
                            </Badge>
                          )}
                          <Button
                            size="sm"
                            variant="destructive"
                            onClick={async () => {
                              if (!confirm(`Zamknąć pozycję ${pos.symbol}?`)) return;
                              try {
                                // 1. Close position on exchange
                                const closeSide = pos.side === 'BUY' ? 'close_long' : 'close_short';
                                const { data, error } = await supabase.functions.invoke('bitget-api', {
                                  body: {
                                    action: 'place_order',
                                    params: {
                                      symbol: pos.symbol,
                                      size: pos.quantity.toString(),
                                      side: closeSide,
                                    }
                                  }
                                });
                                
                                if (error || !data?.success) {
                                  throw new Error('Nie udało się zamknąć pozycji na giełdzie');
                                }
                                
                                console.log('Position closed on exchange, updating database...');
                                
                                // 2. Update database
                                const updateResult = await supabase
                                  .from('positions')
                                  .update({
                                    status: 'closed',
                                    close_reason: 'Manual close from dashboard',
                                    closed_at: new Date().toISOString(),
                                    close_price: Number(pos.current_price),
                                    realized_pnl: Number(pos.unrealized_pnl)
                                  })
                                  .eq('id', pos.id)
                                  .select();
                                
                                if (updateResult.error) {
                                  console.error('Database update error:', updateResult.error);
                                  throw new Error('Nie udało się zaktualizować pozycji w bazie');
                                }
                                
                                console.log('Database updated:', updateResult.data);
                                
                                // 3. Aggressively clear cache and refetch
                                queryClient.removeQueries({ queryKey: ["open-positions"] });
                                queryClient.removeQueries({ queryKey: ["live-data"] });
                                
                                // Wait a bit for database to propagate
                                await new Promise(resolve => setTimeout(resolve, 500));
                                
                                // Force refetch
                                await refetchPositions();
                                
                                toast({ 
                                  title: 'Pozycja zamknięta', 
                                  description: `${pos.symbol} zamknięta pomyślnie` 
                                });
                              } catch (err: any) {
                                console.error('Close position error:', err);
                                toast({ 
                                  title: 'Błąd', 
                                  description: err.message || 'Nie udało się zamknąć pozycji', 
                                  variant: 'destructive' 
                                });
                              }
                            }}
                            className="gap-1"
                          >
                            Zamknij
                          </Button>
                        </div>
                      </div>
                      
                      {/* Price Info Grid */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 mb-4 pl-3">
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Entry Price</p>
                          <p className="text-sm font-semibold">${Number(pos.entry_price).toFixed(4)}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Current Price</p>
                          <p className="text-sm font-semibold">${Number(pos.current_price).toFixed(4)}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Quantity</p>
                          <p className="text-sm font-semibold">{Number(pos.quantity).toFixed(4)}</p>
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Notional</p>
                          <p className="text-sm font-semibold">${notionalValue.toFixed(2)}</p>
                        </div>
                      </div>

                      {/* SL/TP Section */}
                      <div className="grid grid-cols-2 gap-3 mb-4 pl-3 pt-3 border-t border-border/50">
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Stop Loss</p>
                          {pos.has_sl_order ? (
                            <p className="text-sm font-semibold text-loss">
                              ${(pos.real_sl_price || Number(pos.sl_price)).toFixed(4)}
                            </p>
                          ) : (
                            <p className="text-sm text-muted-foreground">-</p>
                          )}
                        </div>
                        <div className="space-y-1">
                          <p className="text-xs text-muted-foreground">Take Profit</p>
                          {pos.has_tp_orders && pos.real_tp_prices && pos.real_tp_prices.length > 0 ? (
                            <div className="flex gap-2">
                              {pos.real_tp_prices.slice(0, 3).map((tp, i) => (
                                <p key={i} className="text-xs font-semibold text-profit">
                                  TP{i+1}: ${tp.toFixed(4)}
                                </p>
                              ))}
                            </div>
                          ) : (
                            <p className="text-sm text-muted-foreground">-</p>
                          )}
                        </div>
                      </div>

                      {/* Progress bar to TP */}
                      {tpPrice > 0 && (
                        <div className="space-y-2 mb-4 pl-3">
                          <div className="flex items-center justify-between text-xs">
                            <span className="text-muted-foreground">Postęp do TP1</span>
                            <span className="font-medium">{progressToTP.toFixed(1)}%</span>
                          </div>
                          <Progress 
                            value={progressToTP} 
                            className={`h-2 ${pos.side === 'BUY' ? '[&>div]:bg-profit' : '[&>div]:bg-loss'}`}
                          />
                        </div>
                      )}

                      {/* PnL Display */}
                      <div className={`text-right pl-3 pt-3 border-t border-border/50`}>
                        <p className="text-xs text-muted-foreground mb-1">Unrealized P&L</p>
                        <p className={`text-2xl font-bold ${Number(pos.unrealized_pnl || 0) >= 0 ? "text-profit glow-text" : "text-loss glow-text"}`}>
                          ${Number(pos.unrealized_pnl || 0).toFixed(2)}
                          <span className="text-sm ml-2">
                            ({pnlPercent >= 0 ? '+' : ''}{pnlPercent.toFixed(2)}%)
                          </span>
                        </p>
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="text-center py-12">
                  <Target className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                  <p className="text-muted-foreground">Brak otwartych pozycji</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Recent Alerts */}
      <Card className="glass-card glass-card-hover gradient-border">
        <CardHeader>
          <CardTitle className="text-2xl font-bold">Ostatnie Alerty</CardTitle>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[300px]">
            <div className="space-y-3">
              {recentAlerts && recentAlerts.length > 0 ? (
                recentAlerts.map((alert, index) => (
                  <div 
                    key={alert.id} 
                    className="flex items-center justify-between p-3 rounded-lg bg-secondary/30 border border-border/50 hover:border-primary/30 transition-all animate-fade-in"
                    style={{ animationDelay: `${index * 0.05}s` }}
                  >
                    <div className="flex items-center gap-3">
                      <div className={`w-1 h-12 rounded-full ${
                        alert.status === "executed" ? "bg-profit" :
                        alert.status === "ignored" ? "bg-muted" :
                        alert.status === "error" ? "bg-loss" :
                        "bg-info"
                      }`} />
                      <div>
                        <div className="font-semibold text-lg">{alert.symbol}</div>
                        <div className="text-sm text-muted-foreground">
                          {alert.tier} • Siła: {Number(alert.strength || 0).toFixed(2)}
                        </div>
                      </div>
                    </div>
                    <Badge 
                      variant={
                        alert.status === "executed" ? "default" :
                        alert.status === "ignored" ? "secondary" :
                        alert.status === "error" ? "destructive" :
                        "outline"
                      }
                      className={
                        alert.status === "executed" ? "bg-profit/20 text-profit border-profit/30" :
                        alert.status === "error" ? "bg-loss/20 text-loss border-loss/30" :
                        ""
                      }
                    >
                      {alert.status}
                    </Badge>
                  </div>
                ))
              ) : (
                <div className="text-center py-12">
                  <Activity className="h-12 w-12 mx-auto text-muted-foreground/50 mb-3" />
                  <p className="text-muted-foreground">Brak alertów</p>
                </div>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
