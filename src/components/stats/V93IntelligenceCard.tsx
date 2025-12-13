import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Brain, Zap, TrendingUp } from "lucide-react";

interface V93Stats {
  label: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnl: number;
  totalPnl: number;
}

interface V93IntelligenceCardProps {
  volatilityRegimeStats: V93Stats[];
  m1ImpulseStats: V93Stats[];
  rsVsBtcStats: V93Stats[];
}

export function V93IntelligenceCard({ 
  volatilityRegimeStats, 
  m1ImpulseStats, 
  rsVsBtcStats 
}: V93IntelligenceCardProps) {
  const hasData = volatilityRegimeStats.length > 0 || m1ImpulseStats.length > 0 || rsVsBtcStats.length > 0;

  if (!hasData) {
    return null;
  }

  const getRegimeColor = (regime: string) => {
    switch (regime.toUpperCase()) {
      case 'OPTIMAL': return 'bg-profit/20 text-profit';
      case 'HIGH': return 'bg-warning/20 text-warning';
      case 'LOW': return 'bg-muted text-muted-foreground';
      default: return 'bg-secondary text-secondary-foreground';
    }
  };

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Brain className="h-5 w-5 text-primary" />
          v9.3 Intelligence Analysis
          <Badge variant="outline" className="ml-2 text-xs">NEW</Badge>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Volatility Regime Analysis */}
        {volatilityRegimeStats.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <Zap className="h-4 w-4" />
              Volatility Regime
            </h4>
            <div className="grid gap-2">
              {volatilityRegimeStats.map((stat) => (
                <div 
                  key={stat.label}
                  className="flex items-center justify-between p-3 rounded-lg bg-secondary/30"
                >
                  <div className="flex items-center gap-3">
                    <Badge className={getRegimeColor(stat.label)}>
                      {stat.label}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {stat.trades} trades
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm">
                      WR: <span className={stat.winRate >= 50 ? "text-profit" : "text-loss"}>
                        {stat.winRate.toFixed(1)}%
                      </span>
                    </span>
                    <span className={`font-medium ${stat.totalPnl >= 0 ? "text-profit" : "text-loss"}`}>
                      ${stat.totalPnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* M1 Impulse Analysis */}
        {m1ImpulseStats.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <TrendingUp className="h-4 w-4" />
              M1 Impulse Impact
            </h4>
            <div className="grid gap-2">
              {m1ImpulseStats.map((stat) => (
                <div 
                  key={stat.label}
                  className="flex items-center justify-between p-3 rounded-lg bg-secondary/30"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant={stat.label === 'With Impulse' ? 'default' : 'secondary'}>
                      {stat.label}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {stat.trades} trades
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm">
                      WR: <span className={stat.winRate >= 50 ? "text-profit" : "text-loss"}>
                        {stat.winRate.toFixed(1)}%
                      </span>
                    </span>
                    <span className="text-sm">
                      Avg: <span className={stat.avgPnl >= 0 ? "text-profit" : "text-loss"}>
                        ${stat.avgPnl.toFixed(3)}
                      </span>
                    </span>
                    <span className={`font-medium ${stat.totalPnl >= 0 ? "text-profit" : "text-loss"}`}>
                      ${stat.totalPnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* RS vs BTC Analysis */}
        {rsVsBtcStats.length > 0 && (
          <div>
            <h4 className="text-sm font-medium mb-3 flex items-center gap-2">
              <svg className="h-4 w-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M12 2v20M2 12h20" />
              </svg>
              RS vs BTC Ranges
            </h4>
            <div className="grid gap-2">
              {rsVsBtcStats.map((stat) => (
                <div 
                  key={stat.label}
                  className="flex items-center justify-between p-3 rounded-lg bg-secondary/30"
                >
                  <div className="flex items-center gap-3">
                    <Badge variant="outline">
                      {stat.label}
                    </Badge>
                    <span className="text-sm text-muted-foreground">
                      {stat.trades} trades
                    </span>
                  </div>
                  <div className="flex items-center gap-4">
                    <span className="text-sm">
                      WR: <span className={stat.winRate >= 50 ? "text-profit" : "text-loss"}>
                        {stat.winRate.toFixed(1)}%
                      </span>
                    </span>
                    <span className={`font-medium ${stat.totalPnl >= 0 ? "text-profit" : "text-loss"}`}>
                      ${stat.totalPnl.toFixed(2)}
                    </span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
