import { useState, useEffect, useRef, useMemo } from "react";
import { useInfiniteQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const PAGE_SIZE = 50;
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { format } from "date-fns";
import { Info, AlertCircle, Calendar as CalendarIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { useToast } from "@/hooks/use-toast";

// Helper function to format prices with appropriate precision
const formatPrice = (price: number) => {
  if (price >= 1000) return price.toFixed(2);
  if (price >= 100) return price.toFixed(3);
  if (price >= 1) return price.toFixed(5);
  // For small prices - max 6 decimal places, remove trailing zeros
  return parseFloat(price.toFixed(6)).toString();
};

export default function History() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [dateFrom, setDateFrom] = useState<Date>();
  const [dateTo, setDateTo] = useState<Date>();
  const [isRepairing, setIsRepairing] = useState(false);
  const tableRef = useRef<HTMLTableElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const [tableWidth, setTableWidth] = useState(1800);

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
  } = useInfiniteQuery({
    queryKey: ["closed-positions"],
    queryFn: async ({ pageParam = 0 }) => {
      const from = pageParam * PAGE_SIZE;
      const to = from + PAGE_SIZE - 1;

      const { data, error, count } = await supabase
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
            tp1,
            tp2,
            tp3,
            tier,
            strength,
            leverage,
            mode,
            raw_data,
            atr,
            error_message,
            status,
            created_at,
            executed_at,
            tv_timestamp,
            webhook_received_at,
            exchange_executed_at,
            latency_webhook_ms,
            latency_execution_ms,
            latency_ms,
            position_id
          )
        `, { count: 'exact' })
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .range(from, to);

      if (error) throw error;
      return { positions: data || [], count: count || 0, pageParam };
    },
    getNextPageParam: (lastPage, allPages) => {
      const totalLoaded = allPages.reduce((sum, page) => sum + page.positions.length, 0);
      return totalLoaded < lastPage.count ? allPages.length : undefined;
    },
    initialPageParam: 0,
    refetchInterval: 30000,
  });

  const closedPositions = useMemo(() => {
    return data?.pages.flatMap(page => page.positions) || [];
  }, [data]);

  const totalCount = data?.pages[0]?.count || 0;


  // Update scrollbar width when table renders using ResizeObserver
  useEffect(() => {
    if (tableRef.current) {
      const updateWidth = () => {
        const width = tableRef.current?.scrollWidth || 1800;
        setTableWidth(width);
      };
      
      // Initial update
      updateWidth();
      
      // Observe table size changes
      const resizeObserver = new ResizeObserver(() => {
        updateWidth();
      });
      
      resizeObserver.observe(tableRef.current);
      
      return () => {
        resizeObserver.disconnect();
      };
    }
  }, [closedPositions]);

  // Filter positions by date range
  const filteredPositions = closedPositions?.filter((position) => {
    if (!dateFrom && !dateTo) return true;
    const closedDate = position.closed_at ? new Date(position.closed_at) : null;
    if (!closedDate) return false;
    
    if (dateFrom && closedDate < dateFrom) return false;
    if (dateTo) {
      const endOfDay = new Date(dateTo);
      endOfDay.setHours(23, 59, 59, 999);
      if (closedDate > endOfDay) return false;
    }
    return true;
  });

  const stats = filteredPositions ? {
    totalPnL: filteredPositions.reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0),
    winningTrades: filteredPositions.filter(p => Number(p.realized_pnl || 0) > 0).length,
    losingTrades: filteredPositions.filter(p => Number(p.realized_pnl || 0) < 0).length,
    avgWin: filteredPositions.filter(p => Number(p.realized_pnl || 0) > 0).reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0) / filteredPositions.filter(p => Number(p.realized_pnl || 0) > 0).length || 0,
    avgLoss: filteredPositions.filter(p => Number(p.realized_pnl || 0) < 0).reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0) / filteredPositions.filter(p => Number(p.realized_pnl || 0) < 0).length || 0,
  } : null;

  const exportToCSV = () => {
    if (!filteredPositions || filteredPositions.length === 0) {
      toast({
        title: "Brak danych",
        description: "Nie ma pozycji do eksportu w wybranym zakresie dat",
        variant: "destructive",
      });
      return;
    }

    const headers = [
      "Symbol", "Side", "Entry Price", "Close Price", "Quantity", "Leverage",
      "Position Value", "Margin Used", "Fees", "Gross PnL", "Net PnL", "ROI %", "Real R:R",
      "Close Reason", "Open Time", "Close Time", "Duration (min)",
      "SL Price", "TP1 Price", "TP1 Quantity", "TP1 Filled",
      "TP2 Price", "TP2 Quantity", "TP2 Filled",
      "TP3 Price", "TP3 Quantity", "TP3 Filled",
      "Bitget Order ID", "SL Order ID", "TP1 Order ID", "TP2 Order ID", "TP3 Order ID",
      "Alert ID", "Alert Tier", "Alert Strength", "Alert Mode", "Alert ATR",
      "Alert Entry Price", "Alert SL", "Alert Main TP", 
      "Alert TP1", "Alert TP2", "Alert TP3", "Alert Status",
      "Alert TV Timestamp", "Alert Webhook Received At", "Alert Exchange Executed At", "Alert Executed At",
      "Alert TV→Webhook (ms)", "Alert Processing (ms)", "Alert Total Latency (ms)",
      "MM Position Sizing Type", "MM Margin Bucket", "MM Symbol Category",
      "Session", "Regime", "Zone Type", "BTC Correlation"
    ];

    const rows = filteredPositions.map((position) => {
      const netPnl = Number(position.realized_pnl || 0);
      const notionalValue = Number(position.entry_price) * Number(position.quantity);
      const marginUsed = position.leverage ? notionalValue / Number(position.leverage) : notionalValue;
      const fees = notionalValue * 0.0012;
      const grossPnl = netPnl + fees;
      const roi = marginUsed > 0 ? (netPnl / marginUsed) * 100 : 0;
      const estimatedLoss = marginUsed > 0 ? marginUsed * 0.02 : 1;
      const realRR = (estimatedLoss + fees) > 0 ? netPnl / (estimatedLoss + fees) : 0;
      const duration = position.closed_at && position.created_at
        ? Math.floor((new Date(position.closed_at).getTime() - new Date(position.created_at).getTime()) / 1000 / 60)
        : 0;
      const alert = Array.isArray(position.alerts) ? position.alerts[0] : position.alerts;
      const metadata = position.metadata as any;

      return [
        position.symbol,
        position.side === 'BUY' ? 'LONG' : 'SHORT',
        Number(position.entry_price).toFixed(8),
        Number(position.close_price).toFixed(8),
        Number(position.quantity).toFixed(8),
        position.leverage,
        notionalValue.toFixed(2),
        marginUsed.toFixed(2),
        fees.toFixed(4),
        grossPnl.toFixed(4),
        netPnl.toFixed(4),
        roi.toFixed(2),
        realRR.toFixed(2),
        position.close_reason || "Unknown",
        format(new Date(position.created_at), "dd.MM.yyyy HH:mm:ss"),
        position.closed_at ? format(new Date(position.closed_at), "dd.MM.yyyy HH:mm:ss") : "-",
        duration,
        position.sl_price || "-",
        position.tp1_price || "-",
        position.tp1_quantity || "-",
        position.tp1_filled ? "YES" : "NO",
        position.tp2_price || "-",
        position.tp2_quantity || "-",
        position.tp2_filled ? "YES" : "NO",
        position.tp3_price || "-",
        position.tp3_quantity || "-",
        position.tp3_filled ? "YES" : "NO",
        position.bitget_order_id || "-",
        position.sl_order_id || "-",
        position.tp1_order_id || "-",
        position.tp2_order_id || "-",
        position.tp3_order_id || "-",
        alert?.id || "-",
        alert?.tier || "-",
        alert?.strength || "-",
        alert?.mode || "-",
        alert?.atr || "-",
        alert?.entry_price || "-",
        alert?.sl || "-",
        alert?.main_tp || "-",
        alert?.tp1 || "-",
        alert?.tp2 || "-",
        alert?.tp3 || "-",
        alert?.status || "-",
        alert?.tv_timestamp || "-",
        alert?.webhook_received_at ? format(new Date(alert.webhook_received_at), "dd.MM.yyyy HH:mm:ss") : "-",
        alert?.exchange_executed_at || "-",
        alert?.executed_at ? format(new Date(alert.executed_at), "dd.MM.yyyy HH:mm:ss") : "-",
        alert?.latency_webhook_ms || "-",
        alert?.latency_execution_ms || "-",
        alert?.latency_ms || "-",
        metadata?.settings_snapshot?.position_sizing_type || metadata?.mm_data?.position_sizing_type || "-",
        metadata?.mm_data?.margin_bucket || "-",
        metadata?.mm_data?.symbol_category || "-",
        metadata?.session || "-",
        metadata?.regime || "-",
        metadata?.zone_type || "-",
        metadata?.btc_correlation || "-"
      ];
    });

    const csvContent = [
      headers.join(","),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(","))
    ].join("\n");

    const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `positions_history_${format(new Date(), "yyyy-MM-dd_HH-mm")}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Eksport zakończony",
      description: `Wyeksportowano ${filteredPositions.length} pozycji do CSV`,
    });
  };

  const exportToJSON = () => {
    if (!filteredPositions || filteredPositions.length === 0) {
      toast({
        title: "Brak danych",
        description: "Nie ma pozycji do eksportu w wybranym zakresie dat",
        variant: "destructive",
      });
      return;
    }

    const exportData = filteredPositions.map((position) => {
      const alert = Array.isArray(position.alerts) ? position.alerts[0] : position.alerts;
      const netPnl = Number(position.realized_pnl || 0);
      const notionalValue = Number(position.entry_price) * Number(position.quantity);
      const marginUsed = position.leverage ? notionalValue / Number(position.leverage) : notionalValue;
      const fees = notionalValue * 0.0012;
      const grossPnl = netPnl + fees;
      const roi = marginUsed > 0 ? (netPnl / marginUsed) * 100 : 0;
      const estimatedLoss = marginUsed > 0 ? marginUsed * 0.02 : 1;
      const realRR = (estimatedLoss + fees) > 0 ? netPnl / (estimatedLoss + fees) : 0;
      
      return {
        position: {
          id: position.id,
          symbol: position.symbol,
          side: position.side,
          entry_price: Number(position.entry_price),
          close_price: Number(position.close_price),
          quantity: Number(position.quantity),
          leverage: position.leverage,
          sl_price: position.sl_price,
          tp1_price: position.tp1_price,
          tp1_quantity: position.tp1_quantity,
          tp1_filled: position.tp1_filled,
          tp2_price: position.tp2_price,
          tp2_quantity: position.tp2_quantity,
          tp2_filled: position.tp2_filled,
          tp3_price: position.tp3_price,
          tp3_quantity: position.tp3_quantity,
          tp3_filled: position.tp3_filled,
          bitget_order_id: position.bitget_order_id,
          sl_order_id: position.sl_order_id,
          tp1_order_id: position.tp1_order_id,
          tp2_order_id: position.tp2_order_id,
          tp3_order_id: position.tp3_order_id,
          realized_pnl: netPnl,
          close_reason: position.close_reason,
          created_at: position.created_at,
          closed_at: position.closed_at,
          status: position.status,
          metadata: position.metadata,
        },
        calculated: {
          position_value: notionalValue,
          margin_used: marginUsed,
          fees: fees,
          gross_pnl: grossPnl,
          net_pnl: netPnl,
          roi_percent: roi,
          real_rr: realRR,
          duration_minutes: position.closed_at && position.created_at
            ? Math.floor((new Date(position.closed_at).getTime() - new Date(position.created_at).getTime()) / 1000 / 60)
            : 0,
        },
        alert: alert ? {
          id: alert.id,
          symbol: alert.symbol,
          side: alert.side,
          entry_price: alert.entry_price,
          sl: alert.sl,
          main_tp: alert.main_tp,
          tp1: alert.tp1,
          tp2: alert.tp2,
          tp3: alert.tp3,
          tier: alert.tier,
          strength: alert.strength,
          mode: alert.mode,
          atr: alert.atr,
          leverage: alert.leverage,
          status: alert.status,
          created_at: alert.created_at,
          executed_at: alert.executed_at,
          tv_timestamp: alert.tv_timestamp,
          webhook_received_at: alert.webhook_received_at,
          exchange_executed_at: alert.exchange_executed_at,
          position_id: alert.position_id,
          raw_data: alert.raw_data,
          latency: {
            tv_to_webhook_ms: alert.latency_webhook_ms,
            processing_ms: alert.latency_execution_ms,
            total_ms: alert.latency_ms,
          }
        } : null,
        money_management: position.metadata ? {
          settings_snapshot: (position.metadata as any).settings_snapshot,
          mm_data: (position.metadata as any).mm_data,
        } : null,
      };
    });

    const jsonContent = JSON.stringify(exportData, null, 2);
    const blob = new Blob([jsonContent], { type: "application/json;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `positions_history_${format(new Date(), "yyyy-MM-dd_HH-mm")}.json`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Eksport zakończony",
      description: `Wyeksportowano ${filteredPositions.length} pozycji do JSON`,
    });
  };

  const repairHistory = async () => {
    setIsRepairing(true);
    try {
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const { data, error } = await supabase.functions.invoke("repair-positions-history", {
        headers: {
          Authorization: `Bearer ${session.access_token}`,
        },
      });

      if (error) throw error;

      toast({
        title: "Historia naprawiona",
        description: `Zweryfikowano ${data.summary.verified} pozycji, zaktualizowano ${data.summary.updated}, usunięto ${data.summary.deleted} duplikatów`,
      });

      // Refresh positions
      queryClient.invalidateQueries({ queryKey: ["closed-positions"] });
    } catch (error: any) {
      toast({
        title: "Błąd naprawy historii",
        description: error.message,
        variant: "destructive",
      });
    } finally {
      setIsRepairing(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Historia Pozycji</h1>
          <p className="text-muted-foreground">Wszystkie zamknięte pozycje</p>
        </div>
      </div>
      
      <div className="flex gap-2">
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("justify-start text-left font-normal", !dateFrom && "text-muted-foreground")}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateFrom ? format(dateFrom, "dd.MM.yyyy") : "Data od"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={dateFrom} onSelect={setDateFrom} initialFocus />
          </PopoverContent>
        </Popover>
        <Popover>
          <PopoverTrigger asChild>
            <Button variant="outline" className={cn("justify-start text-left font-normal", !dateTo && "text-muted-foreground")}>
              <CalendarIcon className="mr-2 h-4 w-4" />
              {dateTo ? format(dateTo, "dd.MM.yyyy") : "Data do"}
            </Button>
          </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            <Calendar mode="single" selected={dateTo} onSelect={setDateTo} initialFocus />
          </PopoverContent>
        </Popover>
        {(dateFrom || dateTo) && (
          <Button variant="ghost" onClick={() => { setDateFrom(undefined); setDateTo(undefined); }}>
            Wyczyść
          </Button>
        )}
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
          <CardTitle>
            Zamknięte Pozycje ({filteredPositions?.length || 0}
            {dateFrom || dateTo 
              ? ` filtrowane z ${closedPositions?.length || 0} załadowanych` 
              : totalCount > closedPositions.length 
                ? ` z ${totalCount} w bazie`
                : ""})
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {/* Top scrollbar - identical copy for width sync */}
            <div 
              ref={topScrollRef}
              className="overflow-x-auto"
              onScroll={(e) => {
                if (bottomScrollRef.current) {
                  bottomScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
              }}
            >
              <div style={{ width: `${tableWidth}px`, height: '12px' }} />
            </div>
            
            {/* Main table with bottom scrollbar synced */}
            <div 
              ref={bottomScrollRef}
              className="overflow-x-auto"
              onScroll={(e) => {
                if (topScrollRef.current) {
                  topScrollRef.current.scrollLeft = e.currentTarget.scrollLeft;
                }
              }}
            >
            <Table ref={tableRef}>
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
                  <TableHead>Fees</TableHead>
                  <TableHead>Gross PnL</TableHead>
                  <TableHead>Net PnL</TableHead>
                  <TableHead>ROI %</TableHead>
                  <TableHead>Real R:R</TableHead>
                  <TableHead>Powód zamknięcia</TableHead>
                  <TableHead>Otwarcie</TableHead>
                  <TableHead>Zamknięcie</TableHead>
                  <TableHead>Czas</TableHead>
                  <TableHead>Latencja Total</TableHead>
                  <TableHead>Alert</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={19} className="text-center py-8">
                      Ładowanie...
                    </TableCell>
                  </TableRow>
                ) : filteredPositions && filteredPositions.length > 0 ? (
                  filteredPositions.map((position) => {
                    const netPnl = Number(position.realized_pnl || 0);
                    const notionalValue = Number(position.entry_price) * Number(position.quantity);
                    const marginUsed = position.leverage ? notionalValue / Number(position.leverage) : notionalValue;
                    
                    // Calculate fees (round-trip 0.12%)
                    const fees = notionalValue * 0.0012;
                    const grossPnl = netPnl + fees;
                    
                    // Calculate ROI based on net PnL
                    const roi = marginUsed > 0 ? (netPnl / marginUsed) * 100 : 0;
                    
                    // Calculate Real R:R (net profit / estimated loss including fees)
                    const estimatedLoss = marginUsed > 0 ? marginUsed * 0.02 : 1; // Estimate 2% loss if not available
                    const realRR = (estimatedLoss + fees) > 0 ? netPnl / (estimatedLoss + fees) : 0;
                    
                    const duration = position.closed_at && position.created_at
                      ? Math.floor((new Date(position.closed_at).getTime() - new Date(position.created_at).getTime()) / 1000 / 60)
                      : 0;
                    
                    const alert = Array.isArray(position.alerts) ? position.alerts[0] : position.alerts;
                    
                    // Close reason translation
                    const closeReasonMap: Record<string, string> = {
                      'imported_from_bitget': 'Import z Bitget',
                      'tp_hit': 'TP osiągnięty',
                      'tp1_hit': 'TP1 osiągnięty',
                      'tp2_hit': 'TP2 osiągnięty',
                      'tp3_hit': 'TP3 osiągnięty',
                      'sl_hit': 'SL wybity',
                      'manual_close': 'Zamknięcie ręczne',
                      'trailing_stop': 'Trailing Stop',
                      'breakeven_stop': 'Breakeven',
                      'unknown': 'Nieznany',
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
                        <TableCell>${formatPrice(Number(position.entry_price))}</TableCell>
                        <TableCell>${formatPrice(Number(position.close_price))}</TableCell>
                        <TableCell>{parseFloat(Number(position.quantity).toFixed(6)).toString()}</TableCell>
                        <TableCell className="font-medium">{position.leverage}x</TableCell>
                        <TableCell className="font-medium">${notionalValue.toFixed(2)}</TableCell>
                        <TableCell className="text-muted-foreground">${marginUsed.toFixed(2)}</TableCell>
                        <TableCell className="text-muted-foreground">
                          ${fees.toFixed(4)}
                        </TableCell>
                        <TableCell className={grossPnl >= 0 ? "text-profit" : "text-loss"}>
                          ${grossPnl.toFixed(4)}
                        </TableCell>
                        <TableCell className={netPnl >= 0 ? "text-profit font-semibold" : "text-loss font-semibold"}>
                          ${netPnl.toFixed(4)}
                        </TableCell>
                        <TableCell className={roi >= 0 ? "text-profit" : "text-loss"}>
                          {roi.toFixed(2)}%
                        </TableCell>
                        <TableCell className={
                          realRR < 1 
                            ? "text-loss font-semibold" 
                            : realRR < 2 
                            ? "text-warning font-semibold" 
                            : "text-profit font-semibold"
                        }>
                          {realRR.toFixed(2)}:1
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">
                            {closeReasonMap[position.close_reason || ''] || position.close_reason || "Unknown"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {format(new Date(position.created_at), "dd.MM.yyyy HH:mm:ss")}
                        </TableCell>
                        <TableCell className="text-xs">
                          {position.closed_at ? format(new Date(position.closed_at), "dd.MM.yyyy HH:mm:ss") : "-"}
                        </TableCell>
                        <TableCell className="text-xs">{duration}min</TableCell>
                        <TableCell className={cn("text-xs", {
                          "text-profit": alert?.latency_ms && alert.latency_ms < 10000,
                          "text-warning": alert?.latency_ms && alert.latency_ms >= 10000 && alert.latency_ms < 20000,
                          "text-loss": alert?.latency_ms && alert.latency_ms >= 20000
                        })}>
                          {alert?.latency_ms 
                            ? `${(alert.latency_ms / 1000).toFixed(1)}s` 
                            : "-"}
                        </TableCell>
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
            
            {/* Load more button */}
            {hasNextPage && (
              <div className="flex justify-center mt-4 pt-4 border-t">
                <Button 
                  onClick={() => fetchNextPage()} 
                  disabled={isFetchingNextPage}
                  variant="outline"
                >
                  {isFetchingNextPage 
                    ? "Ładowanie..." 
                    : `Załaduj więcej (${closedPositions.length} z ${totalCount})`}
                </Button>
              </div>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
