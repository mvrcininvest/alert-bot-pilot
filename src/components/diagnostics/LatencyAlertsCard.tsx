import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { AlertTriangle, CheckCircle, Clock } from "lucide-react";
import { format } from "date-fns";

interface LatencyAlert {
  id: string;
  alert_id: string | null;
  user_id: string | null;
  latency_ms: number;
  threshold_ms: number;
  created_at: string;
  acknowledged_at: string | null;
  acknowledged_by: string | null;
  alerts?: {
    symbol: string;
    side: string;
    tier: string | null;
  };
}

interface LatencyAlertsCardProps {
  alerts: LatencyAlert[];
  onAcknowledge: (alertId: string) => void;
  onClear: () => void;
  isAcknowledging?: boolean;
  isClearing?: boolean;
}

export function LatencyAlertsCard({ 
  alerts, 
  onAcknowledge, 
  onClear,
  isAcknowledging,
  isClearing 
}: LatencyAlertsCardProps) {
  const unacknowledgedAlerts = alerts.filter(a => !a.acknowledged_at);
  const acknowledgedAlerts = alerts.filter(a => a.acknowledged_at);

  const formatLatency = (ms: number) => {
    const seconds = Math.floor(ms / 1000);
    return `${seconds}s`;
  };

  const getSeverityColor = (ms: number) => {
    if (ms > 60000) return "text-destructive"; // > 60s - Critical
    if (ms > 45000) return "text-orange-500"; // > 45s - High
    return "text-yellow-600"; // > 30s - Warning
  };

  const getSeverityBadge = (ms: number) => {
    if (ms > 60000) return <Badge variant="destructive">KRYTYCZNA</Badge>;
    if (ms > 45000) return <Badge variant="destructive" className="bg-orange-500">WYSOKA</Badge>;
    return <Badge variant="secondary" className="bg-yellow-600 text-white">OSTRZEŻENIE</Badge>;
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-yellow-600" />
            Alerty Latencji (&gt;30s)
            {unacknowledgedAlerts.length > 0 && (
              <Badge variant="destructive" className="ml-2">
                {unacknowledgedAlerts.length} nowych
              </Badge>
            )}
          </CardTitle>
          <Button 
            variant="outline" 
            size="sm"
            onClick={onClear}
            disabled={isClearing || alerts.length === 0}
          >
            Wyczyść wszystkie
          </Button>
        </div>
      </CardHeader>
      <CardContent>
        {alerts.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <CheckCircle className="h-12 w-12 mx-auto mb-2 text-green-500" />
            <p>Brak alertów latencji</p>
            <p className="text-xs mt-1">Wszystkie transakcje wykonują się w optymalnym czasie</p>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Unacknowledged Alerts */}
            {unacknowledgedAlerts.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4 text-yellow-600" />
                  Niepotwierdzonelatencji ({unacknowledgedAlerts.length})
                </h4>
                <ScrollArea className="h-[300px]">
                  <div className="space-y-3">
                    {unacknowledgedAlerts.map((alert) => (
                      <div 
                        key={alert.id} 
                        className="border border-yellow-600/20 bg-yellow-50/5 rounded-lg p-4 space-y-2"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex-1 space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              {getSeverityBadge(alert.latency_ms)}
                              {alert.alerts && (
                                <>
                                  <Badge variant="outline">{alert.alerts.symbol}</Badge>
                                  <Badge variant={alert.alerts.side === 'BUY' ? 'default' : 'destructive'}>
                                    {alert.alerts.side}
                                  </Badge>
                                  {alert.alerts.tier && (
                                    <Badge variant="secondary">{alert.alerts.tier}</Badge>
                                  )}
                                </>
                              )}
                            </div>
                            <div className="flex items-center gap-3 text-sm">
                              <span className={`font-bold ${getSeverityColor(alert.latency_ms)}`}>
                                Latencja: {formatLatency(alert.latency_ms)}
                              </span>
                              <span className="text-muted-foreground">
                                <Clock className="h-3 w-3 inline mr-1" />
                                {format(new Date(alert.created_at), "dd.MM.yyyy HH:mm:ss")}
                              </span>
                            </div>
                            <p className="text-xs text-muted-foreground">
                              Próg: {formatLatency(alert.threshold_ms)} | Przekroczenie: {formatLatency(alert.latency_ms - alert.threshold_ms)}
                            </p>
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => onAcknowledge(alert.id)}
                            disabled={isAcknowledging}
                          >
                            Potwierdź
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Acknowledged Alerts */}
            {acknowledgedAlerts.length > 0 && (
              <div className="pt-4 border-t border-border">
                <h4 className="text-sm font-semibold mb-3 text-muted-foreground flex items-center gap-2">
                  <CheckCircle className="h-4 w-4" />
                  Potwierdzone ({acknowledgedAlerts.length})
                </h4>
                <ScrollArea className="h-[200px]">
                  <div className="space-y-2">
                    {acknowledgedAlerts.map((alert) => (
                      <div 
                        key={alert.id} 
                        className="border border-border rounded-lg p-3 opacity-60 text-sm"
                      >
                        <div className="flex items-center gap-2 flex-wrap">
                          <Badge variant="outline" className="text-xs">{formatLatency(alert.latency_ms)}</Badge>
                          {alert.alerts && (
                            <Badge variant="outline" className="text-xs">{alert.alerts.symbol}</Badge>
                          )}
                          <span className="text-xs text-muted-foreground">
                            {format(new Date(alert.created_at), "dd.MM HH:mm")}
                          </span>
                        </div>
                      </div>
                    ))}
                  </div>
                </ScrollArea>
              </div>
            )}

            {/* Summary Stats */}
            <div className="pt-4 border-t border-border grid grid-cols-3 gap-4 text-center">
              <div>
                <p className="text-xs text-muted-foreground">Łącznie</p>
                <p className="text-2xl font-bold">{alerts.length}</p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Średnia latencja</p>
                <p className="text-2xl font-bold text-yellow-600">
                  {formatLatency(Math.round(alerts.reduce((sum, a) => sum + a.latency_ms, 0) / alerts.length))}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">Max latencja</p>
                <p className="text-2xl font-bold text-destructive">
                  {formatLatency(Math.max(...alerts.map(a => a.latency_ms)))}
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}