import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Activity } from "lucide-react";

interface LatencyAnalysisCardProps {
  positions: any[];
}

export function LatencyAnalysisCard({ positions }: LatencyAnalysisCardProps) {
  // Max realistic latency: 120 seconds (2 minutes) - filter outliers
  const MAX_REALISTIC_LATENCY_MS = 120000;

  // Calculate latency statistics from positions with valid alert latency data
  const latencyStats = (() => {
    const validPositions = positions.filter(p => {
      const alert = Array.isArray(p.alerts) ? p.alerts[0] : p.alerts;
      return alert?.latency_ms && 
             alert.latency_ms > 0 && 
             alert.latency_ms < MAX_REALISTIC_LATENCY_MS;
    });
    
    if (validPositions.length === 0) return null;
    
    const latencies = validPositions.map(p => {
      const alert = Array.isArray(p.alerts) ? p.alerts[0] : p.alerts;
      return alert.latency_ms;
    });
    
    const sorted = [...latencies].sort((a, b) => a - b);
    
    return {
      count: latencies.length,
      min: Math.min(...latencies),
      max: Math.max(...latencies),
      avg: latencies.reduce((a, b) => a + b, 0) / latencies.length,
      median: sorted[Math.floor(sorted.length / 2)],
      p95: sorted[Math.floor(sorted.length * 0.95)],
      p99: sorted[Math.floor(sorted.length * 0.99)],
    };
  })();

  if (!latencyStats) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Activity className="h-5 w-5" />
            Analiza Latencji (TV → Exchange)
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Brak danych o latencji</p>
        </CardContent>
      </Card>
    );
  }

  const formatLatency = (ms: number) => `${(ms / 1000).toFixed(1)}s`;

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5" />
          Analiza Latencji (TV → Exchange)
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Pozycji z latencją</p>
            <p className="text-2xl font-bold">{latencyStats.count}</p>
          </div>
          
          <div>
            <p className="text-xs text-muted-foreground">Średnia</p>
            <p className="text-2xl font-bold text-primary">
              {formatLatency(latencyStats.avg)}
            </p>
          </div>
          
          <div>
            <p className="text-xs text-muted-foreground">Mediana</p>
            <p className="text-xl font-bold">
              {formatLatency(latencyStats.median)}
            </p>
          </div>
          
          <div>
            <p className="text-xs text-muted-foreground">Min / Max</p>
            <p className="text-sm font-medium">
              {formatLatency(latencyStats.min)} / {formatLatency(latencyStats.max)}
            </p>
          </div>
          
          <div>
            <p className="text-xs text-muted-foreground">95 Percentyl</p>
            <p className="text-lg font-bold text-warning">
              {formatLatency(latencyStats.p95)}
            </p>
          </div>
          
          <div>
            <p className="text-xs text-muted-foreground">99 Percentyl</p>
            <p className="text-lg font-bold text-loss">
              {formatLatency(latencyStats.p99)}
            </p>
          </div>
        </div>
        
        <div className="mt-4 pt-4 border-t">
          <p className="text-xs text-muted-foreground">
            Latencja mierzy całkowity czas od wygenerowania sygnału w TradingView do otwarcia pozycji na giełdzie.
          </p>
          <div className="mt-2 flex gap-4 text-xs">
            <span className="text-profit">🟢 &lt; 10s: Doskonała</span>
            <span className="text-warning">🟡 10-20s: Dobra</span>
            <span className="text-loss">🔴 &gt; 20s: Do poprawy</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}