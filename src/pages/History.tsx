import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { format } from "date-fns";
import { Info, AlertCircle } from "lucide-react";

export default function History() {
  const { data: closedPositions, isLoading } = useQuery({
    queryKey: ["closed-positions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select(`
          *,
          alerts (
            id,
            symbol,
            side,
            entry_price,
            sl,
            main_tp,
            tier,
            strength,
            leverage,
            raw_data,
            error_message,
            created_at
          )
        `)
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const stats = closedPositions ? {
    totalPnL: closedPositions.reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0),
    winningTrades: closedPositions.filter(p => Number(p.realized_pnl || 0) > 0).length,
    losingTrades: closedPositions.filter(p => Number(p.realized_pnl || 0) < 0).length,
    avgWin: closedPositions.filter(p => Number(p.realized_pnl || 0) > 0).reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0) / closedPositions.filter(p => Number(p.realized_pnl || 0) > 0).length || 0,
    avgLoss: closedPositions.filter(p => Number(p.realized_pnl || 0) < 0).reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0) / closedPositions.filter(p => Number(p.realized_pnl || 0) < 0).length || 0,
  } : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Historia Pozycji</h1>
        <p className="text-muted-foreground">Wszystkie zamknięte pozycje</p>
      </div>

      {stats && (
        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Całkowity PnL</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${stats.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                ${stats.totalPnL.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Winning Trades</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-profit">{stats.winningTrades}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Losing Trades</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-loss">{stats.losingTrades}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Avg Win</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-profit">${stats.avgWin.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Avg Loss</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-loss">${stats.avgLoss.toFixed(2)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Zamknięte Pozycje ({closedPositions?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Close</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Leverage</TableHead>
                  <TableHead>Wartość</TableHead>
                  <TableHead>Margin</TableHead>
                  <TableHead>PnL</TableHead>
                  <TableHead>PnL %</TableHead>
                  <TableHead>Powód zamknięcia</TableHead>
                  <TableHead>Otwarcie</TableHead>
                  <TableHead>Zamknięcie</TableHead>
                  <TableHead>Czas</TableHead>
                  <TableHead>Alert</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={15} className="text-center py-8">
                      Ładowanie...
                    </TableCell>
                  </TableRow>
                ) : closedPositions && closedPositions.length > 0 ? (
                  closedPositions.map((position) => {
                    const pnl = Number(position.realized_pnl || 0);
                    const pnlPercent = position.entry_price && position.close_price
                      ? ((Number(position.close_price) - Number(position.entry_price)) / Number(position.entry_price)) * 100 * (position.side === 'BUY' ? 1 : -1)
                      : 0;
                    
                    const duration = position.closed_at && position.created_at
                      ? Math.floor((new Date(position.closed_at).getTime() - new Date(position.created_at).getTime()) / 1000 / 60)
                      : 0;
                    
                    const notionalValue = Number(position.entry_price) * Number(position.quantity);
                    const marginUsed = position.leverage ? notionalValue / Number(position.leverage) : 0;
                    
                    const alert = Array.isArray(position.alerts) ? position.alerts[0] : position.alerts;
                    
                    // Close reason translation
                    const closeReasonMap: Record<string, string> = {
                      'imported_from_bitget': 'Import z Bitget',
                      'tp_hit': 'TP osiągnięty',
                      'sl_hit': 'SL osiągnięty',
                      'manual_close': 'Zamknięcie ręczne',
                      'trailing_stop': 'Trailing Stop',
                      'breakeven_stop': 'Breakeven',
                      'error': 'Błąd'
                    };
                    
                    return (
                      <TableRow key={position.id}>
                        <TableCell className="font-medium">{position.symbol}</TableCell>
                        <TableCell>
                          <Badge variant={position.side === "BUY" ? "default" : "destructive"}>
                            {position.side === "BUY" ? "LONG" : "SHORT"}
                          </Badge>
                        </TableCell>
                        <TableCell>${Number(position.entry_price).toFixed(4)}</TableCell>
                        <TableCell>${Number(position.close_price).toFixed(4)}</TableCell>
                        <TableCell>{Number(position.quantity).toFixed(4)}</TableCell>
                        <TableCell className="font-medium">{position.leverage}x</TableCell>
                        <TableCell className="font-medium">${notionalValue.toFixed(2)}</TableCell>
                        <TableCell className="text-muted-foreground">${marginUsed.toFixed(2)}</TableCell>
                        <TableCell className={pnl >= 0 ? "text-profit font-medium" : "text-loss font-medium"}>
                          ${pnl.toFixed(2)}
                        </TableCell>
                        <TableCell className={pnlPercent >= 0 ? "text-profit" : "text-loss"}>
                          {pnlPercent.toFixed(2)}%
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {closeReasonMap[position.close_reason || ''] || position.close_reason || "Unknown"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {format(new Date(position.created_at), "dd.MM.yyyy HH:mm")}
                        </TableCell>
                        <TableCell className="text-xs">
                          {position.closed_at ? format(new Date(position.closed_at), "dd.MM.yyyy HH:mm") : "-"}
                        </TableCell>
                        <TableCell className="text-xs">{duration}min</TableCell>
                        <TableCell>
                          {alert ? (
                            <Dialog>
                              <DialogTrigger asChild>
                                <Button variant="outline" size="sm">
                                  <Info className="h-4 w-4" />
                                </Button>
                              </DialogTrigger>
                              <DialogContent className="max-w-4xl max-h-[80vh]">
                                <DialogHeader>
                                  <DialogTitle>Alert dla pozycji - {position.symbol}</DialogTitle>
                                </DialogHeader>
                                <ScrollArea className="h-[60vh]">
                                  <Tabs defaultValue="market" className="w-full">
                                    <TabsList className="grid w-full grid-cols-3">
                                      <TabsTrigger value="market">Warunki Rynkowe</TabsTrigger>
                                      <TabsTrigger value="raw">Raw JSON</TabsTrigger>
                                      <TabsTrigger value="error">
                                        Błąd
                                        {alert.error_message && <AlertCircle className="h-3 w-3 ml-1" />}
                                      </TabsTrigger>
                                    </TabsList>
                                    
                                    <TabsContent value="market" className="space-y-4 mt-4">
                                      {alert.raw_data && typeof alert.raw_data === 'object' && !Array.isArray(alert.raw_data) && (
                                        <>
                                          {/* Technical Indicators */}
                                          {(alert.raw_data as any).technical && (
                                            <Card>
                                              <CardHeader>
                                                <CardTitle className="text-sm">Wskaźniki Techniczne</CardTitle>
                                              </CardHeader>
                                              <CardContent className="text-sm space-y-2">
                                                <div className="grid grid-cols-2 gap-2">
                                                  <div><span className="font-medium">ADX:</span> {(alert.raw_data as any).technical.adx}</div>
                                                  <div><span className="font-medium">MFI:</span> {(alert.raw_data as any).technical.mfi}</div>
                                                  <div><span className="font-medium">MACD Signal:</span> {(alert.raw_data as any).technical.macd_signal}</div>
                                                  <div><span className="font-medium">EMA Alignment:</span> {(alert.raw_data as any).technical.ema_alignment}</div>
                                                  <div><span className="font-medium">MTF Agreement:</span> {(alert.raw_data as any).technical.mtf_agreement}</div>
                                                  <div><span className="font-medium">VWAP Position:</span> {(alert.raw_data as any).technical.vwap_position}</div>
                                                </div>
                                              </CardContent>
                                            </Card>
                                          )}
                                          
                                          {/* Market Filters */}
                                          {(alert.raw_data as any).filters && (
                                            <Card>
                                              <CardHeader>
                                                <CardTitle className="text-sm">Filtry Rynkowe</CardTitle>
                                              </CardHeader>
                                              <CardContent className="text-sm space-y-2">
                                                <div className="grid grid-cols-2 gap-2">
                                                  <div><span className="font-medium">Market Condition:</span> {(alert.raw_data as any).filters.market_condition}</div>
                                                  <div><span className="font-medium">Room to Target:</span> {(alert.raw_data as any).filters.room_to_target}%</div>
                                                  <div><span className="font-medium">Wave Multiplier:</span> {(alert.raw_data as any).filters.wave_multiplier}</div>
                                                  <div><span className="font-medium">Volume Multiplier:</span> {(alert.raw_data as any).filters.volume_multiplier}</div>
                                                  <div><span className="font-medium">Regime Multiplier:</span> {(alert.raw_data as any).filters.regime_multiplier}</div>
                                                </div>
                                              </CardContent>
                                            </Card>
                                          )}
                                          
                                          {/* SMC Context */}
                                          {(alert.raw_data as any).smc_context && (
                                            <Card>
                                              <CardHeader>
                                                <CardTitle className="text-sm">SMC Context</CardTitle>
                                              </CardHeader>
                                              <CardContent className="text-sm space-y-2">
                                                <div className="grid grid-cols-2 gap-2">
                                                  <div><span className="font-medium">Regime:</span> {(alert.raw_data as any).smc_context.regime}</div>
                                                  <div><span className="font-medium">BOS Direction:</span> {(alert.raw_data as any).smc_context.bos_direction}</div>
                                                  <div><span className="font-medium">BTC Correlation:</span> {(alert.raw_data as any).smc_context.btc_correlation}</div>
                                                  <div><span className="font-medium">Liquidity Sweep:</span> {(alert.raw_data as any).smc_context.liquidity_sweep ? 'Yes' : 'No'}</div>
                                                </div>
                                              </CardContent>
                                            </Card>
                                          )}
                                          
                                          {/* Diagnostics */}
                                          {(alert.raw_data as any).diagnostics && (
                                            <Card>
                                              <CardHeader>
                                                <CardTitle className="text-sm">Diagnostyka</CardTitle>
                                              </CardHeader>
                                              <CardContent className="text-sm space-y-2">
                                                <div className="grid grid-cols-2 gap-2">
                                                  <div><span className="font-medium">Health:</span> {(alert.raw_data as any).diagnostics.health}</div>
                                                  <div><span className="font-medium">Regime:</span> {(alert.raw_data as any).diagnostics.regime}</div>
                                                  <div><span className="font-medium">Buy Strength:</span> {(alert.raw_data as any).diagnostics.buy_str}</div>
                                                  <div><span className="font-medium">Sell Strength:</span> {(alert.raw_data as any).diagnostics.sell_str}</div>
                                                  <div><span className="font-medium">Institutional Flow:</span> {(alert.raw_data as any).diagnostics.inst_flow}</div>
                                                  <div><span className="font-medium">MTF Agreement:</span> {(alert.raw_data as any).diagnostics.mtf_agree}</div>
                                                </div>
                                              </CardContent>
                                            </Card>
                                          )}
                                        </>
                                      )}
                                    </TabsContent>
                                    
                                    <TabsContent value="raw" className="mt-4">
                                      <Card>
                                        <CardContent className="pt-4">
                                          <pre className="text-xs overflow-auto bg-muted p-4 rounded">
                                            {JSON.stringify(alert.raw_data, null, 2)}
                                          </pre>
                                        </CardContent>
                                      </Card>
                                    </TabsContent>
                                    
                                    <TabsContent value="error" className="mt-4">
                                      {alert.error_message ? (
                                        <Card className="border-destructive">
                                          <CardHeader>
                                            <CardTitle className="text-sm text-destructive flex items-center gap-2">
                                              <AlertCircle className="h-4 w-4" />
                                              Błąd wykonania
                                            </CardTitle>
                                          </CardHeader>
                                          <CardContent>
                                            <p className="text-sm">{alert.error_message}</p>
                                          </CardContent>
                                        </Card>
                                      ) : (
                                        <Card>
                                          <CardContent className="pt-6 text-center text-muted-foreground">
                                            Brak błędów dla tego alertu
                                          </CardContent>
                                        </Card>
                                      )}
                                    </TabsContent>
                                  </Tabs>
                                </ScrollArea>
                              </DialogContent>
                            </Dialog>
                          ) : (
                            <span className="text-xs text-muted-foreground">-</span>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={15} className="text-center py-8 text-muted-foreground">
                      Brak zamkniętych pozycji
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
