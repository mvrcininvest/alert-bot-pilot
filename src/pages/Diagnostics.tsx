import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertCircle, Eye, Ban, CheckCircle, XCircle, TrendingUp } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

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

      {/* Deviations Widget */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <TrendingUp className="h-5 w-5" />
            Odchylenia Poziomów i Ilości
          </CardTitle>
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
          <CardTitle className="flex items-center gap-2">
            <Eye className="h-5 w-5" />
            Oko Saurona - Interwencje
          </CardTitle>
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
