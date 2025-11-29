import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Eye, Ban, CheckCircle, XCircle, TrendingUp, Wrench } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import { LatencyAlertsCard } from "@/components/diagnostics/LatencyAlertsCard";
import { useEffect } from "react";

export default function Diagnostics() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: monitoringLogs } = useQuery({
    queryKey: ["oko-saurona-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monitoring_logs")
        .select("*, positions(symbol)")
        .in("check_type", ["sl_repair", "tp_repair", "emergency_close"])
        .order("created_at", { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 5000,
  });

  const { data: deviations } = useQuery({
    queryKey: ["oko-saurona-deviations"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("monitoring_logs")
        .select("*, positions(symbol, side)")
        .eq("check_type", "deviations")
        .order("created_at", { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 5000,
  });

  const { data: scalpingAdjustments } = useQuery({
    queryKey: ["scalping-adjustments"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("bot_logs")
        .select("*")
        .in("level", ["warn", "info"])
        .not("metadata->adjustment", "is", null)
        .order("created_at", { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 5000,
  });

  const { data: errorAlerts } = useQuery({
    queryKey: ["error-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select("*")
        .eq("status", "error")
        .order("created_at", { ascending: false })
        .limit(50);
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 5000,
  });

  const { data: bannedSymbols } = useQuery({
    queryKey: ["banned-symbols"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("banned_symbols")
        .select("*")
        .order("banned_at", { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 5000,
  });

  const { data: latencyAlerts } = useQuery({
    queryKey: ["latency-alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("latency_alerts")
        .select(`
          *,
          alerts (
            symbol,
            side,
            tier
          )
        `)
        .order("created_at", { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 5000,
  });

  // Real-time subscription for new latency alerts
  useEffect(() => {
    const channel = supabase
      .channel('latency-alerts-changes')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'latency_alerts'
        },
        (payload) => {
          console.log('New latency alert:', payload);
          queryClient.invalidateQueries({ queryKey: ["latency-alerts"] });
          
          // Show toast notification
          toast({
            title: "⚠️ Wykryto wysoką latencję!",
            description: `Latencja: ${((payload.new as any).latency_ms / 1000).toFixed(1)}s (próg: 30s)`,
            variant: "destructive",
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient, toast]);

  const unbanMutation = useMutation({
    mutationFn: async (symbolId: string) => {
      const { error } = await supabase
        .from("banned_symbols")
        .delete()
        .eq("id", symbolId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["banned-symbols"] });
      toast({
        title: "Symbol odbanowany",
        description: "Symbol został usunięty z listy zbanowanych",
      });
    },
    onError: (error) => {
      toast({
        title: "Błąd",
        description: error instanceof Error ? error.message : "Nie udało się odbanować symbolu",
        variant: "destructive",
      });
    },
  });

  const clearDeviationsMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("monitoring_logs")
        .delete()
        .eq("check_type", "deviations");
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["oko-saurona-deviations"] });
      toast({
        title: "Odchylenia wyczyszczone",
        description: "Wszystkie logi odchyleń zostały usunięte",
      });
    },
    onError: (error) => {
      toast({
        title: "Błąd",
        description: error instanceof Error ? error.message : "Nie udało się wyczyścić odchyleń",
        variant: "destructive",
      });
    },
  });

  const clearInterventionsMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("monitoring_logs")
        .delete()
        .in("check_type", ["sl_repair", "tp_repair", "emergency_close"]);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["oko-saurona-logs"] });
      toast({
        title: "Interwencje wyczyszczone",
        description: "Wszystkie logi interwencji zostały usunięte",
      });
    },
    onError: (error) => {
      toast({
        title: "Błąd",
        description: error instanceof Error ? error.message : "Nie udało się wyczyścić interwencji",
        variant: "destructive",
      });
    },
  });

  const clearScalpingAdjustmentsMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("bot_logs")
        .delete()
        .eq("level", "warn")
        .not("metadata->adjustment", "is", null);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["scalping-adjustments"] });
      toast({
        title: "Dostosowania scalping wyczyszczone",
        description: "Wszystkie logi dostosowań scalping zostały usunięte",
      });
    },
    onError: (error) => {
      toast({
        title: "Błąd",
        description: error instanceof Error ? error.message : "Nie udało się wyczyścić dostosowań",
        variant: "destructive",
      });
    },
  });

  const clearErrorAlertsMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("alerts")
        .delete()
        .eq("status", "error");
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["error-alerts"] });
      toast({
        title: "Błędne alerty wyczyszczone",
        description: "Wszystkie alerty z błędami zostały usunięte",
      });
    },
    onError: (error) => {
      toast({
        title: "Błąd",
        description: error instanceof Error ? error.message : "Nie udało się wyczyścić alertów",
        variant: "destructive",
      });
    },
  });

  const fixPositionsDataMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("fix-positions-data", {
        body: {},
      });
      
      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Nie udało się naprawić danych");
      return data;
    },
    onSuccess: (data) => {
      toast({
        title: "Dane pozycji naprawione",
        description: `Naprawiono quantity: ${data.summary.quantityFixed}, leverage: ${data.summary.leverageFixed}`,
      });
    },
    onError: (error) => {
      toast({
        title: "Błąd",
        description: error instanceof Error ? error.message : "Nie udało się naprawić danych pozycji",
        variant: "destructive",
      });
    },
  });

  const linkPositionsAlertsMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("link-positions-alerts", {
        body: {},
      });
      
      if (error) throw error;
      if (!data.success) throw new Error(data.error || "Nie udało się połączyć pozycji z alertami");
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["positions"] });
      toast({
        title: "Połączono pozycje z alertami",
        description: `Dopasowano: ${data.matched}, Nie dopasowano: ${data.unmatched}`,
      });
    },
    onError: (error) => {
      toast({
        title: "Błąd",
        description: error instanceof Error ? error.message : "Nie udało się połączyć pozycji z alertami",
        variant: "destructive",
      });
    },
  });

  const acknowledgeLatencyAlertMutation = useMutation({
    mutationFn: async (alertId: string) => {
      const { error } = await supabase
        .from("latency_alerts")
        .update({ 
          acknowledged_at: new Date().toISOString(),
          acknowledged_by: (await supabase.auth.getUser()).data.user?.id 
        })
        .eq("id", alertId);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["latency-alerts"] });
      toast({
        title: "Alert potwierdzony",
        description: "Alert o wysokiej latencji został potwierdzony",
      });
    },
    onError: (error) => {
      toast({
        title: "Błąd",
        description: error instanceof Error ? error.message : "Nie udało się potwierdzić alertu",
        variant: "destructive",
      });
    },
  });

  const clearLatencyAlertsMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("latency_alerts")
        .delete()
        .not("id", "is", null);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["latency-alerts"] });
      toast({
        title: "Alerty wyczyszczone",
        description: "Wszystkie alerty latencji zostały usunięte",
      });
    },
    onError: (error) => {
      toast({
        title: "Błąd",
        description: error instanceof Error ? error.message : "Nie udało się wyczyścić alertów",
        variant: "destructive",
      });
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'success':
        return 'default';
      case 'failed':
        return 'destructive';
      case 'critical':
        return 'destructive';
      case 'warning':
        return 'secondary';
      default:
        return 'secondary';
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="h-4 w-4 text-green-500" />;
      case 'failed':
      case 'critical':
        return <XCircle className="h-4 w-4 text-destructive" />;
      default:
        return <AlertCircle className="h-4 w-4 text-yellow-500" />;
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Diagnostyka</h1>
        <p className="text-muted-foreground">Monitorowanie i diagnostyka bota tradingowego</p>
      </div>

      {/* Latency Alerts Widget */}
      <LatencyAlertsCard
        alerts={latencyAlerts || []}
        onAcknowledge={(alertId) => acknowledgeLatencyAlertMutation.mutate(alertId)}
        onClear={() => clearLatencyAlertsMutation.mutate()}
        isAcknowledging={acknowledgeLatencyAlertMutation.isPending}
        isClearing={clearLatencyAlertsMutation.isPending}
      />

      {/* Data Repair Widget */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wrench className="h-5 w-5" />
            Naprawa Danych Pozycji
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            <div className="space-y-2">
              <p className="text-sm font-medium">Napraw Quantity i Leverage</p>
              <p className="text-sm text-muted-foreground">
                Naprawia quantity (ilość) obliczając ją z PnL oraz leverage pobierając rzeczywistą wartość z historii orderów Bitget.
              </p>
              <Button 
                onClick={() => fixPositionsDataMutation.mutate()}
                disabled={fixPositionsDataMutation.isPending}
                className="w-full sm:w-auto"
              >
                {fixPositionsDataMutation.isPending ? "Naprawiam..." : "🔧 Napraw Quantity i Leverage"}
              </Button>
            </div>
            
            <div className="space-y-2 pt-3 border-t border-border">
              <p className="text-sm font-medium">Połącz Pozycje z Alertami</p>
              <p className="text-sm text-muted-foreground">
                Automatycznie dopasowuje pozycje bez alertu do odpowiednich alertów z historii na podstawie symbolu, strony, czasu i ceny.
              </p>
              <Button 
                onClick={() => linkPositionsAlertsMutation.mutate()}
                disabled={linkPositionsAlertsMutation.isPending}
                variant="secondary"
                className="w-full sm:w-auto"
              >
                {linkPositionsAlertsMutation.isPending ? "Łączę..." : "🔗 Połącz Pozycje z Alertami"}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Deviations Widget */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              Odchylenia Poziomów i Ilości
            </CardTitle>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => clearDeviationsMutation.mutate()}
              disabled={clearDeviationsMutation.isPending}
            >
              Wyczyść
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            <div className="space-y-3">
              {deviations && deviations.length > 0 ? (
                deviations.map((log) => {
                  const issues = Array.isArray(log.issues) ? log.issues as any[] : [];
                  return (
                    <div key={log.id} className="border border-border rounded-lg p-4 space-y-2">
                      <div className="flex items-center gap-2 flex-wrap mb-2">
                        <Badge variant="outline">
                          {log.positions?.symbol || 'N/A'}
                        </Badge>
                        <Badge variant="secondary">
                          {log.positions?.side || 'N/A'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.created_at).toLocaleString()}
                        </span>
                      </div>
                      <div className="space-y-1.5">
                        {issues.map((deviation: any, i: number) => (
                          <div key={i} className="flex items-start gap-2 text-sm">
                            <div className="flex-1 grid grid-cols-2 gap-4 bg-muted/50 p-2 rounded">
                              <div>
                                <span className="text-xs text-muted-foreground uppercase">{deviation.label || deviation.type}</span>
                                <div className="font-medium">
                                  Plan: <span className="text-foreground">{Number(deviation.planned).toFixed(8)}</span>
                                </div>
                              </div>
                              <div>
                                <span className="text-xs text-muted-foreground">Odchylenie</span>
                                <div className="font-medium text-yellow-600">
                                  {Number(deviation.actual).toFixed(8)} ({deviation.deviation_percent}%)
                                </div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-center text-muted-foreground py-8">Brak wykrytych odchyleń</p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Oko Saurona Widget */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <Eye className="h-5 w-5" />
              Oko Saurona - Interwencje
            </CardTitle>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => clearInterventionsMutation.mutate()}
              disabled={clearInterventionsMutation.isPending}
            >
              Wyczyść
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            <div className="space-y-3">
              {monitoringLogs && monitoringLogs.length > 0 ? (
                monitoringLogs.map((log) => (
                  <div key={log.id} className="flex items-start gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                    <div className="mt-0.5">
                      {getStatusIcon(log.status)}
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant={getStatusColor(log.status)}>
                          {log.check_type.replace(/_/g, ' ').toUpperCase()}
                        </Badge>
                        <Badge variant="outline">
                          {log.positions?.symbol || 'N/A'}
                        </Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(log.created_at).toLocaleString()}
                        </span>
                      </div>
                      {log.actions_taken && (
                        <p className="text-sm font-medium">{log.actions_taken}</p>
                      )}
                      {log.issues && Array.isArray(log.issues) && (log.issues as any[]).length > 0 && (
                        <div className="text-xs text-muted-foreground">
                          <span className="font-semibold">Problemy:</span>{' '}
                          {(log.issues as any[]).map((issue: any, i: number) => (
                            <span key={i}>
                              {issue.type || issue.reason || JSON.stringify(issue)}
                              {i < (log.issues as any[]).length - 1 && ', '}
                            </span>
                          ))}
                        </div>
                      )}
                      {log.error_message && (
                        <p className="text-xs text-destructive">{log.error_message}</p>
                      )}
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground py-8">Brak interwencji Oka Saurona</p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Scalping Mode Adjustments Widget */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <TrendingUp className="h-5 w-5" />
              ⚡ Dostosowania Scalping Mode
            </CardTitle>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => clearScalpingAdjustmentsMutation.mutate()}
              disabled={clearScalpingAdjustmentsMutation.isPending}
            >
              Wyczyść
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            <div className="space-y-3">
              {scalpingAdjustments && scalpingAdjustments.length > 0 ? (
                scalpingAdjustments.map((log) => {
                  const metadata = log.metadata as any;
                  const adjustmentType = metadata?.adjustment || 'unknown';
                  const symbol = metadata?.symbol || 'N/A';
                  const reason = metadata?.adjustmentReason || log.message;
                  
                  return (
                    <div key={log.id} className="flex items-start gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                      <div className="mt-0.5">
                        <AlertCircle className="h-4 w-4 text-yellow-500" />
                      </div>
                      <div className="flex-1 space-y-1">
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="secondary">
                            {adjustmentType === 'margin_reduced' ? 'MARGIN REDUCED' : 
                             adjustmentType === 'sl_capped' ? 'SL CAPPED' : 
                             adjustmentType.toUpperCase()}
                          </Badge>
                          <Badge variant="outline">{symbol}</Badge>
                          <span className="text-xs text-muted-foreground">
                            {new Date(log.created_at).toLocaleString()}
                          </span>
                        </div>
                        <p className="text-sm text-muted-foreground">{reason}</p>
                        {metadata?.slPercent && (
                          <div className="text-xs text-muted-foreground">
                            SL%: {metadata.slPercent.toFixed(3)}% | 
                            Margin: {metadata.actualMargin?.toFixed(2)} USDT | 
                            Loss: {metadata.actualLoss?.toFixed(2)} USDT
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              ) : (
                <p className="text-center text-muted-foreground py-8">Brak dostosowań scalping mode</p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Error Alerts Widget */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <CardTitle className="flex items-center gap-2">
              <XCircle className="h-5 w-5" />
              Alerty Odrzucone - Błędy Techniczne
            </CardTitle>
            <Button 
              variant="outline" 
              size="sm"
              onClick={() => clearErrorAlertsMutation.mutate()}
              disabled={clearErrorAlertsMutation.isPending}
            >
              Wyczyść
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[400px]">
            <div className="space-y-3">
              {errorAlerts && errorAlerts.length > 0 ? (
                errorAlerts.map((alert) => (
                  <div key={alert.id} className="flex items-start gap-3 border-b border-border pb-3 last:border-0 last:pb-0">
                    <div className="mt-0.5">
                      <XCircle className="h-4 w-4 text-destructive" />
                    </div>
                    <div className="flex-1 space-y-1">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Badge variant="destructive">ERROR</Badge>
                        <Badge variant="outline">{alert.symbol}</Badge>
                        <Badge variant="secondary">{alert.side}</Badge>
                        <span className="text-xs text-muted-foreground">
                          {new Date(alert.created_at).toLocaleString()}
                        </span>
                      </div>
                      <p className="text-sm text-destructive font-medium">{alert.error_message}</p>
                      <div className="text-xs text-muted-foreground">
                        Entry: {alert.entry_price} | SL: {alert.sl} | TP: {alert.main_tp}
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-center text-muted-foreground py-8">Brak alertów z błędami</p>
              )}
            </div>
          </ScrollArea>
        </CardContent>
      </Card>

      {/* Banned Symbols */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Ban className="h-5 w-5" />
            Zbanowane Symbole
          </CardTitle>
        </CardHeader>
        <CardContent>
          {bannedSymbols && bannedSymbols.length > 0 ? (
            <div className="space-y-3">
              {bannedSymbols.map((banned) => (
                <div key={banned.id} className="flex items-center justify-between p-3 border border-border rounded-lg">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge variant="destructive">{banned.symbol}</Badge>
                      <span className="text-xs text-muted-foreground">
                        Zbanowany: {new Date(banned.banned_at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">{banned.reason}</p>
                  </div>
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={() => unbanMutation.mutate(banned.id)}
                    disabled={unbanMutation.isPending}
                  >
                    Odbanuj
                  </Button>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-center text-muted-foreground py-8">Brak zbanowanych symboli</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
