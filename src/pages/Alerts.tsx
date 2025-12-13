import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { format } from "date-fns";
import { Info, AlertCircle, TestTube } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useState, useEffect, useRef } from "react";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { cn } from "@/lib/utils";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
export default function Alerts() {
  const [selectedAlert, setSelectedAlert] = useState<any>(null);
  const [showOnlyMyAlerts, setShowOnlyMyAlerts] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [versionFilter, setVersionFilter] = useState<string>("all");
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { isAdmin, user } = useAuth();
  const tableRef = useRef<HTMLTableElement>(null);
  const topScrollRef = useRef<HTMLDivElement>(null);
  const bottomScrollRef = useRef<HTMLDivElement>(null);
  const [tableWidth, setTableWidth] = useState(1800);
  
  const { data: alerts, isLoading } = useQuery({
    queryKey: ["alerts", showOnlyMyAlerts, statusFilter, versionFilter, user?.id],
    queryFn: async () => {
      let query = supabase
        .from("alerts")
        .select("*");
      
      // Filter by user_id when "only my alerts" is enabled
      if (showOnlyMyAlerts && user?.id) {
        query = query.eq("user_id", user.id);
      }
      
      // Filter by status
      if (statusFilter !== "all") {
        query = query.eq("status", statusFilter as "executed" | "ignored" | "error" | "pending");
      }
      
      // Filter by indicator version
      if (versionFilter !== "all") {
        query = query.eq("indicator_version", versionFilter);
      }
      
      query = query.order("created_at", { ascending: false });
      
      const { data, error } = await query;
      
      if (error) throw error;
      return data || [];
    },
  });

  const toggleTestMutation = useMutation({
    mutationFn: async ({ alertId, isTest }: { alertId: string; isTest: boolean }) => {
      const { error } = await supabase
        .from("alerts")
        .update({ is_test: !isTest })
        .eq("id", alertId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["alerts"] });
      toast({
        title: "Status zaktualizowany",
        description: "Alert został oznaczony jako testowy/produkcyjny",
      });
    },
    onError: () => {
      toast({
        title: "Błąd",
        description: "Nie udało się zaktualizować statusu alertu",
        variant: "destructive",
      });
    },
  });

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
  }, [alerts]);

  const stats = alerts ? {
    total: alerts.length,
    buy: alerts.filter(a => a.side === "BUY").length,
    sell: alerts.filter(a => a.side === "SELL").length,
    executed: alerts.filter(a => a.status === "executed").length,
    ignored: alerts.filter(a => a.status === "ignored").length,
    error: alerts.filter(a => a.status === "error").length,
    test: alerts.filter(a => a.is_test).length,
  } : null;

  const getStatusColor = (status: string) => {
    switch (status) {
      case "executed": return "default";
      case "ignored": return "secondary";
      case "error": return "destructive";
      default: return "outline";
    }
  };

  const exportToCSV = () => {
    if (!alerts || alerts.length === 0) {
      toast({
        title: "Brak danych",
        description: "Nie ma alertów do eksportu",
        variant: "destructive",
      });
      return;
    }

    const headers = [
      // Basic alert data
      "ID", "Data", "Symbol", "Side", "Entry Price", "SL", "Main TP", 
      "TP1", "TP2", "TP3", "Mode", "Tier", "Strength", "Leverage", "ATR",
      // Timestamps & Latencies
      "TV Timestamp", "Webhook Received", "Exchange Executed", "Executed At",
      "Latencja TV→Webhook (ms)", "Latencja Processing (ms)", "Latencja Total (ms)",
      // Status
      "Status", "Position ID", "Error Message", "Testowy",
      // Technical Indicators
      "ADX", "ADX Rising", "MFI", "EMA Alignment", "MACD Signal", "VWAP Position", "MTF Agreement",
      // Filters
      "Volume Multiplier", "Regime Multiplier", "Room to Target", "Fake Breakout Penalty", 
      "Opposite Zone Distance", "Market Condition", "Wave Multiplier",
      // SMC Context
      "BOS Age", "BOS Direction", "BTC Correlation", "Liquidity Sweep", "CVD Divergence", 
      "Regime", "Regime Confidence",
      // Zone Details
      "Zone Age", "Zone Retests", "Zone Type", "Zone Top", "Zone Bottom",
      // FVG/OB
      "In FVG", "In OB", "FVG Score", "OB Score",
      // Volume
      "Volume Climax", "Volume Ratio",
      // Timing
      "Session", "Bars Since Last Signal",
      // Diagnostics
      "Health", "Zones", "Buy Strength", "Sell Strength", "Inst Flow", "Acc Ratio",
      // Other
      "Distribution", "Institutional Flow", "Tier Numeric", "SL Distance", "Risk Per Unit", "Version"
    ];

    const rows = alerts.map((alert) => {
      const raw = alert.raw_data as any || {};
      const technical = raw.technical || {};
      const filters = raw.filters || {};
      const smcContext = raw.smc_context || {};
      const zoneDetails = raw.zone_details || {};
      const timing = raw.timing || {};
      const diagnostics = raw.diagnostics || {};
      const v93 = raw.v93_intelligence || {};

      return [
        // Basic alert data
        alert.id,
        format(new Date(alert.created_at), "dd.MM.yyyy HH:mm"),
        alert.symbol,
        alert.side,
        Number(alert.entry_price).toFixed(8),
        Number(alert.sl).toFixed(8),
        Number(alert.main_tp).toFixed(8),
        alert.tp1 ? Number(alert.tp1).toFixed(8) : "-",
        alert.tp2 ? Number(alert.tp2).toFixed(8) : "-",
        alert.tp3 ? Number(alert.tp3).toFixed(8) : "-",
        alert.mode || "-",
        alert.tier || "-",
        Number(alert.strength || 0).toFixed(4),
        alert.leverage,
        alert.atr ? Number(alert.atr).toFixed(8) : "-",
        // Timestamps & Latencies
        alert.tv_timestamp || "-",
        alert.webhook_received_at ? format(new Date(alert.webhook_received_at), "dd.MM.yyyy HH:mm:ss") : "-",
        alert.exchange_executed_at || "-",
        alert.executed_at ? format(new Date(alert.executed_at), "dd.MM.yyyy HH:mm:ss") : "-",
        alert.latency_webhook_ms || "-",
        alert.latency_execution_ms || "-",
        alert.latency_ms || "-",
        // Status
        alert.status,
        alert.position_id || "-",
        alert.error_message ? alert.error_message.substring(0, 200) : "-",
        alert.is_test ? "Tak" : "Nie",
        // Technical Indicators
        technical.adx != null ? Number(technical.adx).toFixed(2) : "-",
        technical.adx_rising != null ? (technical.adx_rising ? "TAK" : "NIE") : "-",
        technical.mfi != null ? Number(technical.mfi).toFixed(2) : "-",
        technical.ema_alignment || "-",
        technical.macd_signal || "-",
        technical.vwap_position || "-",
        technical.mtf_agreement != null ? Number(technical.mtf_agreement).toFixed(2) : "-",
        // Filters
        filters.volume_multiplier != null ? Number(filters.volume_multiplier).toFixed(4) : "-",
        filters.regime_multiplier != null ? Number(filters.regime_multiplier).toFixed(4) : "-",
        filters.room_to_target != null ? Number(filters.room_to_target).toFixed(4) : "-",
        filters.fake_breakout_penalty != null ? Number(filters.fake_breakout_penalty).toFixed(2) : "-",
        filters.opposite_zone_distance != null ? Number(filters.opposite_zone_distance).toFixed(4) : "-",
        filters.market_condition || "-",
        filters.wave_multiplier != null ? Number(filters.wave_multiplier).toFixed(2) : "-",
        // SMC Context
        smcContext.bos_age != null ? smcContext.bos_age : "-",
        smcContext.bos_direction != null ? (typeof smcContext.bos_direction === 'number' ? (smcContext.bos_direction > 0 ? "BULLISH" : smcContext.bos_direction < 0 ? "BEARISH" : "NEUTRAL") : smcContext.bos_direction) : "-",
        smcContext.btc_correlation != null ? Number(smcContext.btc_correlation).toFixed(4) : "-",
        smcContext.liquidity_sweep != null ? (smcContext.liquidity_sweep ? "TAK" : "NIE") : "-",
        smcContext.cvd_divergence || "-",
        smcContext.regime || "-",
        smcContext.regime_confidence != null ? Number(smcContext.regime_confidence).toFixed(4) : "-",
        // Zone Details
        zoneDetails.zone_age != null ? zoneDetails.zone_age : "-",
        zoneDetails.zone_retests != null ? zoneDetails.zone_retests : "-",
        zoneDetails.zone_type || "-",
        zoneDetails.zone_top != null ? Number(zoneDetails.zone_top).toFixed(8) : "-",
        zoneDetails.zone_bottom != null ? Number(zoneDetails.zone_bottom).toFixed(8) : "-",
        // FVG/OB
        raw.in_fvg != null ? (raw.in_fvg ? "TAK" : "NIE") : "-",
        raw.in_ob != null ? (raw.in_ob ? "TAK" : "NIE") : "-",
        raw.fvg_score != null ? raw.fvg_score : "-",
        raw.ob_score != null ? raw.ob_score : "-",
        // Volume
        raw.volume_climax != null ? (raw.volume_climax ? "TAK" : "NIE") : "-",
        raw.volume_ratio != null ? Number(raw.volume_ratio).toFixed(4) : "-",
        // Timing
        timing.session || "-",
        timing.bars_since_last_signal != null ? timing.bars_since_last_signal : "-",
        // Diagnostics
        diagnostics.health != null ? diagnostics.health : "-",
        diagnostics.zones != null ? diagnostics.zones : "-",
        diagnostics.buy_str != null ? Number(diagnostics.buy_str).toFixed(4) : "-",
        diagnostics.sell_str != null ? Number(diagnostics.sell_str).toFixed(4) : "-",
        diagnostics.inst_flow != null ? Number(diagnostics.inst_flow).toFixed(4) : "-",
        diagnostics.acc_ratio != null ? Number(diagnostics.acc_ratio).toFixed(4) : "-",
        // Other
        raw.distribution != null ? raw.distribution : "-",
        raw.institutional_flow != null ? Number(raw.institutional_flow).toFixed(4) : "-",
        raw.tier_numeric != null ? raw.tier_numeric : "-",
        raw.sl_distance != null ? Number(raw.sl_distance).toFixed(8) : "-",
        raw.risk_per_unit != null ? Number(raw.risk_per_unit).toFixed(8) : "-",
        raw.version || "-"
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
    link.setAttribute("download", `alerts_${format(new Date(), "yyyy-MM-dd_HH-mm")}.csv`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Eksport zakończony",
      description: `Wyeksportowano ${alerts.length} alertów do CSV (${headers.length} kolumn)`,
    });
  };

  const exportToJSON = () => {
    if (!alerts || alerts.length === 0) {
      toast({
        title: "Brak danych",
        description: "Nie ma alertów do eksportu",
        variant: "destructive",
      });
      return;
    }

    // Enhance alerts with latency breakdown
    const enhancedAlerts = alerts.map(alert => ({
      ...alert,
      latency: {
        tv_timestamp: alert.tv_timestamp,
        webhook_received_at: alert.webhook_received_at,
        exchange_executed_at: alert.exchange_executed_at,
        tv_to_webhook_ms: alert.latency_webhook_ms,
        processing_ms: alert.latency_execution_ms,
        total_ms: alert.latency_ms,
      }
    }));

    const jsonContent = JSON.stringify(enhancedAlerts, null, 2);
    const blob = new Blob([jsonContent], { type: "application/json;charset=utf-8;" });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `alerts_${format(new Date(), "yyyy-MM-dd_HH-mm")}.json`);
    link.style.visibility = "hidden";
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    toast({
      title: "Eksport zakończony",
      description: `Wyeksportowano ${alerts.length} alertów do JSON`,
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Historia Alertów</h1>
          <p className="text-muted-foreground">
            {showOnlyMyAlerts ? "Twoje alerty" : "Wszystkie alerty"} otrzymane z TradingView
            {statusFilter !== "all" && ` (${statusFilter})`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Select value={versionFilter} onValueChange={setVersionFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Wersja" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wszystkie</SelectItem>
              <SelectItem value="9.1">v9.1</SelectItem>
              <SelectItem value="9.3">v9.3</SelectItem>
            </SelectContent>
          </Select>
          {isAdmin && (
            <Button
              variant={showOnlyMyAlerts ? "default" : "outline"}
              size="sm"
              onClick={() => setShowOnlyMyAlerts(!showOnlyMyAlerts)}
            >
              {showOnlyMyAlerts ? "Tylko moje" : "Wszystkie"}
            </Button>
          )}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[140px]">
              <SelectValue placeholder="Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Wszystkie</SelectItem>
              <SelectItem value="executed">Wykonane</SelectItem>
              <SelectItem value="ignored">Odrzucone</SelectItem>
              <SelectItem value="error">Błędy</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {stats && (
        <div className="grid gap-4 md:grid-cols-4 lg:grid-cols-7">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Łącznie</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">{stats.total}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">BUY</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-profit">{stats.buy}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">SELL</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-loss">{stats.sell}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Wykonane</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-profit">{stats.executed}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Odrzucone</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-muted-foreground">{stats.ignored}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Błędy</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-destructive">{stats.error}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Testowe</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-muted-foreground">{stats.test}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Alerty ({alerts?.length || 0})</CardTitle>
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
                  <TableHead>Data</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>SL</TableHead>
                  <TableHead>TP</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Strength</TableHead>
                  <TableHead>Leverage</TableHead>
                  <TableHead>Wersja</TableHead>
                  <TableHead>Latencja (TV→Bot)</TableHead>
                  <TableHead>Status</TableHead>
                  {isAdmin && <TableHead>Test</TableHead>}
                  {isAdmin && <TableHead>Akcje</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={isAdmin ? 15 : 12} className="text-center py-8">
                      Ładowanie...
                    </TableCell>
                  </TableRow>
                ) : alerts && alerts.length > 0 ? (
                  alerts.map((alert) => (
                    <TableRow key={alert.id} className={alert.is_test && isAdmin ? "opacity-50" : ""}>
                      <TableCell className="text-xs">
                        {format(new Date(alert.created_at), "dd.MM.yyyy HH:mm")}
                      </TableCell>
                      <TableCell className="font-medium">{alert.symbol}</TableCell>
                      <TableCell>
                        <Badge variant={alert.side === "BUY" ? "default" : "destructive"}>
                          {alert.side}
                        </Badge>
                      </TableCell>
                      <TableCell>${Number(alert.entry_price).toFixed(4)}</TableCell>
                      <TableCell className="text-loss">${Number(alert.sl).toFixed(4)}</TableCell>
                      <TableCell className="text-profit">${Number(alert.main_tp).toFixed(4)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{alert.tier}</Badge>
                      </TableCell>
                      <TableCell>{Number(alert.strength || 0).toFixed(2)}</TableCell>
                      <TableCell>{alert.leverage}x</TableCell>
                      <TableCell>
                        <Badge 
                          variant={(alert as any).indicator_version === '9.3' ? 'default' : 'secondary'}
                          className="text-xs"
                        >
                          v{(alert as any).indicator_version || '9.1'}
                        </Badge>
                      </TableCell>
                      <TableCell className={cn("text-xs", {
                        "text-profit": alert.latency_webhook_ms && alert.latency_webhook_ms < 2000,
                        "text-warning": alert.latency_webhook_ms && alert.latency_webhook_ms >= 2000 && alert.latency_webhook_ms < 5000,
                        "text-loss": alert.latency_webhook_ms && alert.latency_webhook_ms >= 5000
                      })}>
                        {alert.latency_webhook_ms 
                          ? `${(alert.latency_webhook_ms / 1000).toFixed(1)}s` 
                          : "-"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={getStatusColor(alert.status)}>
                          {alert.status}
                        </Badge>
                      </TableCell>
                      {isAdmin && (
                        <TableCell>
                          <Button
                            variant={alert.is_test ? "default" : "outline"}
                            size="sm"
                            onClick={() => toggleTestMutation.mutate({ alertId: alert.id, isTest: alert.is_test })}
                          >
                            <TestTube className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      )}
                      {isAdmin && (
                        <TableCell>
                          <Dialog>
                            <DialogTrigger asChild>
                              <Button 
                                variant="outline" 
                                size="sm"
                                onClick={() => setSelectedAlert(alert)}
                              >
                                <Info className="h-4 w-4" />
                              </Button>
                            </DialogTrigger>
                            <DialogContent className="max-w-4xl max-h-[80vh]">
                              <DialogHeader>
                                <DialogTitle>Szczegóły Alertu - {alert.symbol}</DialogTitle>
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
                      </TableCell>
                      )}
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={isAdmin ? 15 : 12} className="text-center py-8 text-muted-foreground">
                      Brak alertów
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
