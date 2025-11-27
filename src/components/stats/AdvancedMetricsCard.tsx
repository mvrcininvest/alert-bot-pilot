import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { LineChart, TrendingUp, TrendingDown, Activity } from "lucide-react";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { Info } from "lucide-react";

interface AdvancedMetrics {
  sharpeRatio: number;
  sortinoRatio: number;
  calmarRatio: number;
  recoveryFactor: number;
  avgRRR: number;
  payoffRatio: number;
}

interface AdvancedMetricsCardProps {
  metrics: AdvancedMetrics;
}

export function AdvancedMetricsCard({ metrics }: AdvancedMetricsCardProps) {
  const MetricItem = ({ 
    icon: Icon, 
    label, 
    value, 
    description, 
    isGood 
  }: { 
    icon: any; 
    label: string; 
    value: string; 
    description: string; 
    isGood: boolean;
  }) => (
    <div className="p-4 rounded-lg border border-border bg-card">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 text-primary" />
          <span className="text-sm font-medium text-muted-foreground">{label}</span>
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger>
                <Info className="h-3 w-3 text-muted-foreground" />
              </TooltipTrigger>
              <TooltipContent className="max-w-xs">
                <p className="text-xs">{description}</p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
      </div>
      <div className={`text-2xl font-bold ${isGood ? "text-profit" : "text-loss"}`}>
        {value}
      </div>
    </div>
  );

  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Activity className="h-5 w-5 text-primary" />
          Metryki Zaawansowane
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          <MetricItem
            icon={LineChart}
            label="Sharpe Ratio"
            value={metrics.sharpeRatio.toFixed(2)}
            description="Miara zwrotu skorygowanego o ryzyko. Wartość >1 jest dobra, >2 bardzo dobra, >3 wybitna."
            isGood={metrics.sharpeRatio > 1}
          />
          <MetricItem
            icon={TrendingDown}
            label="Sortino Ratio"
            value={metrics.sortinoRatio.toFixed(2)}
            description="Podobnie do Sharpe, ale uwzględnia tylko negatywną zmienność (straty). Wyższa wartość = lepiej."
            isGood={metrics.sortinoRatio > 1}
          />
          <MetricItem
            icon={TrendingUp}
            label="Calmar Ratio"
            value={metrics.calmarRatio.toFixed(2)}
            description="Stosunek zwrotu do maksymalnego drawdownu. Wartość >3 jest bardzo dobra."
            isGood={metrics.calmarRatio > 1}
          />
          <MetricItem
            icon={Activity}
            label="Recovery Factor"
            value={metrics.recoveryFactor.toFixed(2)}
            description="Stosunek całkowitego PnL do max drawdownu. Pokazuje jak szybko odzyskujesz straty."
            isGood={metrics.recoveryFactor > 2}
          />
          <MetricItem
            icon={LineChart}
            label="Avg R:R Ratio"
            value={metrics.avgRRR.toFixed(2)}
            description="Średni stosunek ryzyka do zysku. Wartość >1.5 jest dobra dla zrównoważonej strategii."
            isGood={metrics.avgRRR > 1.5}
          />
          <MetricItem
            icon={TrendingUp}
            label="Payoff Ratio"
            value={metrics.payoffRatio.toFixed(2)}
            description="Średni win / średni loss. Wartość >1 oznacza, że winy są większe niż lossy."
            isGood={metrics.payoffRatio > 1}
          />
        </div>
      </CardContent>
    </Card>
  );
}
