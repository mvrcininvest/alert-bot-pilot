import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Calculator, AlertTriangle, TrendingUp, Zap, CheckCircle2 } from "lucide-react";
import { useState, useEffect } from "react";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";

interface FeeCalculatorProps {
  // Editable parameters for simulation
  margin: number;
  leverage: number;
  maxLoss: number;
  tp1RrRatio: number;
  tp2RrRatio: number;
  tp3RrRatio: number;
  tpLevels: number;
  feeAwareBreakeven?: boolean;
  
  // Callbacks for changes
  onMarginChange?: (value: number) => void;
  onLeverageChange?: (value: number) => void;
  onMaxLossChange?: (value: number) => void;
  onTP1RRChange?: (value: number) => void;
  onTP2RRChange?: (value: number) => void;
  onTP3RRChange?: (value: number) => void;
  onTPLevelsChange?: (value: number) => void;
  onFeeAwareBreakevenChange?: (value: boolean) => void;
}

interface Calculations {
  notional: number;
  roundTripFees: number;
  realMaxLoss: number;
  breakEvenPercent: number;
  feeImpactPercent: number;
  minProfitableTpPercent: number;
}

interface RRSimulation {
  tp: string;
  mathRR: string;
  ratio: number;
  tpPercent: number;
  grossProfit: number;
  netProfit: number;
  realRR: number;
}

interface Recommendation {
  type: 'margin' | 'rr' | 'leverage' | 'preset';
  title: string;
  description: string;
  value: number | { margin: number; leverage: number; tp1RR: number };
  action: () => void;
}

interface BreakevenComparison {
  entryPrice: number;
  standardBE: number;
  feeAwareBE: number;
  standardLoss: number;
  feeAwareLoss: number;
}

const BITGET_TAKER_FEE = 0.06; // 0.06% per side

export function FeeCalculator({
  margin,
  leverage,
  maxLoss,
  tp1RrRatio,
  tp2RrRatio,
  tp3RrRatio,
  tpLevels,
  feeAwareBreakeven = true,
  onMarginChange,
  onLeverageChange,
  onMaxLossChange,
  onTP1RRChange,
  onTP2RRChange,
  onTP3RRChange,
  onTPLevelsChange,
  onFeeAwareBreakevenChange,
}: FeeCalculatorProps) {
  const [calculations, setCalculations] = useState<Calculations>({
    notional: 0,
    roundTripFees: 0,
    realMaxLoss: 0,
    breakEvenPercent: 0,
    feeImpactPercent: 0,
    minProfitableTpPercent: 0,
  });

  const [rrSimulation, setRrSimulation] = useState<RRSimulation[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [beComparison, setBeComparison] = useState<BreakevenComparison>({
    entryPrice: 100000,
    standardBE: 100000,
    feeAwareBE: 100120,
    standardLoss: 0.18,
    feeAwareLoss: 0,
  });

  // Calculate minimum margin needed for target Real R:R
  const calculateMinMarginForTargetRR = (targetRealRR: number, currentMaxLoss: number, currentLeverage: number, tpRatio: number): number => {
    const feeRate = BITGET_TAKER_FEE / 100;
    const minMargin = (currentMaxLoss * (tpRatio - targetRealRR)) / (currentLeverage * feeRate * 2 * (targetRealRR + 1));
    return Math.max(minMargin, 0.5);
  };

  // Calculate minimum R:R ratio for target Real R:R
  const calculateMinRRForTargetRR = (targetRealRR: number, currentMargin: number, currentLeverage: number, currentMaxLoss: number): number => {
    const feeRate = BITGET_TAKER_FEE / 100;
    const notional = currentMargin * currentLeverage;
    const roundTripFees = notional * feeRate * 2;
    const realMaxLoss = currentMaxLoss + roundTripFees;
    const minRR = (targetRealRR * realMaxLoss + roundTripFees) / currentMaxLoss;
    return Math.max(minRR, 1.0);
  };

  // Calculate optimal leverage
  const calculateOptimalLeverage = (currentMargin: number, currentMaxLoss: number, targetFeeImpact: number): number => {
    const feeRate = BITGET_TAKER_FEE / 100;
    const optimalLev = (targetFeeImpact * currentMaxLoss) / (currentMargin * feeRate * 2 * 100);
    return Math.max(Math.round(optimalLev / 5) * 5, 10);
  };

  useEffect(() => {
    // Calculate real-time values
    const notional = margin * leverage;
    const feeRate = BITGET_TAKER_FEE / 100;
    const roundTripFees = notional * feeRate * 2;
    const realMaxLoss = maxLoss + roundTripFees;
    const breakEvenPercent = BITGET_TAKER_FEE * 2; // 0.12%
    const feeImpactPercent = maxLoss > 0 ? (roundTripFees / maxLoss) * 100 : 0;
    const minProfitableTpPercent = breakEvenPercent + 0.05;

    setCalculations({
      notional,
      roundTripFees,
      realMaxLoss,
      breakEvenPercent,
      feeImpactPercent,
      minProfitableTpPercent,
    });

    // Calculate break-even comparison for BTC example
    const exampleEntry = 100000;
    const standardBE = exampleEntry; // Standard BE = entry price
    const feeAwareBE = exampleEntry * (1 + 0.0012); // +0.12% for fees
    const standardLoss = notional * 0.0012; // Loss when SL at entry
    const feeAwareLoss = 0; // True break-even

    setBeComparison({
      entryPrice: exampleEntry,
      standardBE,
      feeAwareBE,
      standardLoss,
      feeAwareLoss,
    });

    // Calculate SL percentage
    const slPercent = maxLoss / notional;

    // Simulate R:R for configured number of TPs
    const tpRatios = [
      { tp: "TP1", ratio: tp1RrRatio },
      { tp: "TP2", ratio: tp2RrRatio },
      { tp: "TP3", ratio: tp3RrRatio },
    ].slice(0, tpLevels); // Only show configured number of TPs

    const simulation: RRSimulation[] = tpRatios.map(({ tp, ratio }) => {
      const tpPercent = slPercent * ratio;
      const grossProfit = notional * tpPercent;
      const netProfit = grossProfit - roundTripFees;
      const realRR = netProfit / realMaxLoss;

      return {
        tp,
        mathRR: `${ratio.toFixed(1)}:1`,
        ratio,
        tpPercent: tpPercent * 100,
        grossProfit,
        netProfit,
        realRR,
      };
    });

    setRrSimulation(simulation);

    // Generate recommendations
    const newRecommendations: Recommendation[] = [];
    const tp1RealRR = simulation[0]?.realRR || 0;

    if (tp1RealRR < 1.5) {
      // Solution 1: Increase margin
      const targetRealRR = 1.5;
      const minMargin = calculateMinMarginForTargetRR(targetRealRR, maxLoss, leverage, tp1RrRatio);
      if (minMargin > margin && minMargin < 100) {
        newRecommendations.push({
          type: 'margin',
          title: '💡 Zwiększ Margin',
          description: `Minimalny margin dla Real R:R ≥ ${targetRealRR}: ${minMargin.toFixed(2)} USDT`,
          value: Math.ceil(minMargin * 10) / 10,
          action: () => onMarginChange?.(Math.ceil(minMargin * 10) / 10),
        });
      }

      // Solution 2: Increase R:R ratio
      const minRR = calculateMinRRForTargetRR(1.0, margin, leverage, maxLoss);
      if (minRR > tp1RrRatio && minRR < 10) {
        newRecommendations.push({
          type: 'rr',
          title: '💡 Zwiększ TP1 R:R',
          description: `Minimalny TP1 R:R dla Real R:R ≥ 1.0: ${minRR.toFixed(1)}:1`,
          value: Math.ceil(minRR * 10) / 10,
          action: () => onTP1RRChange?.(Math.ceil(minRR * 10) / 10),
        });
      }

      // Solution 3: Decrease leverage if fee impact is high
      if (feeImpactPercent > 25) {
        const optimalLev = calculateOptimalLeverage(margin, maxLoss, 20);
        if (optimalLev < leverage) {
          newRecommendations.push({
            type: 'leverage',
            title: '💡 Zmniejsz Leverage',
            description: `Przy leverage ${optimalLev}x fees będą stanowić ~20% max loss`,
            value: optimalLev,
            action: () => onLeverageChange?.(optimalLev),
          });
        }
      }
    }

    // Optimal presets
    if (tp1RealRR < 2.0) {
      newRecommendations.push({
        type: 'preset',
        title: '✅ OPTYMALNE USTAWIENIA',
        description: `Conservative: Margin 3 USDT, Leverage 50x, TP1 R:R 2.0:1 → Real R:R ≥ 2.0`,
        value: { margin: 3, leverage: 50, tp1RR: 2.0 },
        action: () => {
          onMarginChange?.(3);
          onLeverageChange?.(50);
          onTP1RRChange?.(2.0);
        },
      });
    }

    setRecommendations(newRecommendations);
  }, [margin, leverage, maxLoss, tp1RrRatio, tp2RrRatio, tp3RrRatio, tpLevels, onMarginChange, onLeverageChange, onTP1RRChange]);

  const hasLowRR = rrSimulation.some((sim) => sim.realRR < 1);
  const hasHighFeeImpact = calculations.feeImpactPercent > 50;

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          🧮 Fee-Aware Strategy Optimizer
        </CardTitle>
        <CardDescription>
          Optymalizuj swoje ustawienia scalping mode żeby zminimalizować wpływ fees na Real R:R
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Fixed values */}
        <div className="space-y-3 p-4 bg-muted/50 rounded-lg">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            📊 STAŁE (Bitget Futures)
          </h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <Label className="text-xs text-muted-foreground">Taker Fee (per side)</Label>
              <p className="font-mono font-semibold">{BITGET_TAKER_FEE}%</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Round-trip Fee</Label>
              <p className="font-mono font-semibold text-destructive">{(BITGET_TAKER_FEE * 2).toFixed(2)}%</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Break-even TP</Label>
              <p className="font-mono font-semibold">{calculations.breakEvenPercent.toFixed(2)}%</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Min Profitable TP</Label>
              <p className="font-mono font-semibold text-primary">
                {calculations.minProfitableTpPercent.toFixed(2)}%
              </p>
            </div>
          </div>
        </div>

        {/* Break-Even Analysis Section */}
        <div className="space-y-3 p-4 bg-gradient-to-br from-primary/5 to-primary/10 rounded-lg border border-primary/30">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            🎯 BREAK-EVEN ANALYSIS
          </h3>
          
          <div className="space-y-3 text-sm">
            <Alert variant="destructive" className="border-destructive/50">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription className="ml-2">
                <strong>⚠️ Standardowy BE (entry price): STRATA {calculations.breakEvenPercent.toFixed(2)}% (fees)</strong>
              </AlertDescription>
            </Alert>

            <div className="grid grid-cols-2 gap-3">
              <div className="p-3 bg-destructive/10 rounded border border-destructive/30">
                <Label className="text-xs text-muted-foreground">Standardowy BE dla LONG</Label>
                <p className="font-mono font-bold">${beComparison.standardBE.toLocaleString()}</p>
                <p className="text-xs text-destructive mt-1">Strata: {beComparison.standardLoss.toFixed(2)} USDT</p>
              </div>
              <div className="p-3 bg-primary/10 rounded border border-primary/30">
                <Label className="text-xs text-muted-foreground">Fee-Aware BE dla LONG</Label>
                <p className="font-mono font-bold text-primary">${beComparison.feeAwareBE.toLocaleString()}</p>
                <p className="text-xs text-primary mt-1">Zysk: {beComparison.feeAwareLoss.toFixed(2)} USDT ✅</p>
              </div>
            </div>

            <div className="p-3 bg-background/50 rounded text-xs space-y-1">
              <p className="font-semibold">Po TP1 hit, SL zostanie ustawiony na:</p>
              <p className="text-destructive">• Standardowy BE: ${beComparison.standardBE.toLocaleString()} → STRATA {beComparison.standardLoss.toFixed(2)} USDT (fees)</p>
              <p className="text-primary">• Fee-Aware BE: ${beComparison.feeAwareBE.toLocaleString()} → ZYSK {beComparison.feeAwareLoss.toFixed(2)} USDT (true BE) ✅</p>
            </div>

            <div className="flex items-center justify-between p-3 bg-background/80 rounded border border-primary/20">
              <div className="flex items-center gap-2">
                <Switch
                  checked={feeAwareBreakeven}
                  onCheckedChange={onFeeAwareBreakevenChange}
                />
                <Label className="font-semibold cursor-pointer" onClick={() => onFeeAwareBreakevenChange?.(!feeAwareBreakeven)}>
                  Włącz Fee-Aware Break-Even
                </Label>
              </div>
              {feeAwareBreakeven && <CheckCircle2 className="h-5 w-5 text-primary" />}
            </div>
          </div>
        </div>

        {/* Editable simulation parameters */}
        <div className="space-y-4 p-4 bg-primary/5 rounded-lg border border-primary/20">
          <h3 className="font-semibold text-sm flex items-center gap-2">
            ⚙️ PARAMETRY DO SYMULACJI
            <Badge variant="secondary" className="text-xs">Edytuj żeby zobaczyć wpływ</Badge>
          </h3>
          
          <div className="grid grid-cols-4 gap-4">
            <div className="space-y-2">
              <Label>Margin (USDT)</Label>
              <Input
                type="number"
                step="0.1"
                min="0.5"
                value={margin}
                onChange={(e) => onMarginChange?.(parseFloat(e.target.value) || 0.5)}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>Leverage (x)</Label>
              <Input
                type="number"
                step="5"
                min="10"
                max="125"
                value={leverage}
                onChange={(e) => onLeverageChange?.(parseInt(e.target.value) || 10)}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>Max Loss (USDT)</Label>
              <Input
                type="number"
                step="0.1"
                min="0.1"
                value={maxLoss}
                onChange={(e) => onMaxLossChange?.(parseFloat(e.target.value) || 0.1)}
                className="font-mono"
              />
            </div>
            <div className="space-y-2">
              <Label>TP Levels</Label>
              <Input
                type="number"
                min="1"
                max="3"
                value={tpLevels}
                onChange={(e) => onTPLevelsChange?.(parseInt(e.target.value) || 1)}
                className="font-mono"
              />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-2 border-t">
            {tpLevels >= 1 && (
              <div className="space-y-2">
                <Label>TP1 R:R</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.1"
                    min="0.5"
                    value={tp1RrRatio}
                    onChange={(e) => onTP1RRChange?.(parseFloat(e.target.value) || 1.0)}
                    className="font-mono"
                  />
                  <span className="text-sm text-muted-foreground">:1</span>
                </div>
              </div>
            )}
            {tpLevels >= 2 && (
              <div className="space-y-2">
                <Label>TP2 R:R</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.1"
                    min="0.5"
                    value={tp2RrRatio}
                    onChange={(e) => onTP2RRChange?.(parseFloat(e.target.value) || 1.0)}
                    className="font-mono"
                  />
                  <span className="text-sm text-muted-foreground">:1</span>
                </div>
              </div>
            )}
            {tpLevels >= 3 && (
              <div className="space-y-2">
                <Label>TP3 R:R</Label>
                <div className="flex items-center gap-2">
                  <Input
                    type="number"
                    step="0.1"
                    min="0.5"
                    value={tp3RrRatio}
                    onChange={(e) => onTP3RRChange?.(parseFloat(e.target.value) || 1.0)}
                    className="font-mono"
                  />
                  <span className="text-sm text-muted-foreground">:1</span>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Results */}
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">📈 WYNIKI</h3>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-muted/30 rounded">
              <Label className="text-xs text-muted-foreground">Notional Value</Label>
              <p className="text-lg font-mono font-bold">{calculations.notional.toFixed(2)} USDT</p>
            </div>
            <div className="p-3 bg-muted/30 rounded">
              <Label className="text-xs text-muted-foreground">Round-trip Fees</Label>
              <p className="text-lg font-mono font-bold text-destructive">
                {calculations.roundTripFees.toFixed(4)} USDT
              </p>
            </div>
            <div className="p-3 bg-destructive/10 rounded">
              <Label className="text-xs text-muted-foreground">Real Max Loss</Label>
              <p className="text-lg font-mono font-bold text-destructive">
                {calculations.realMaxLoss.toFixed(4)} USDT
              </p>
              <p className="text-xs text-muted-foreground">
                +{calculations.feeImpactPercent.toFixed(1)}% przez fees
                {calculations.feeImpactPercent > 50 && " ⚠️"}
              </p>
            </div>
            <div className="p-3 bg-primary/10 rounded">
              <Label className="text-xs text-muted-foreground">Fee Impact</Label>
              <p className="text-lg font-mono font-bold">
                {calculations.feeImpactPercent.toFixed(1)}% max loss
              </p>
              <p className="text-xs text-muted-foreground">
                {calculations.feeImpactPercent < 25 ? "✅ OK" : calculations.feeImpactPercent < 50 ? "⚠️ Wysokie" : "❌ Za wysokie"}
              </p>
            </div>
          </div>

          {/* R:R Table */}
          <div className="pt-2">
            <h4 className="font-semibold text-xs text-muted-foreground mb-2">─── REAL R:R TABLE ───</h4>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[60px]">TP</TableHead>
                  <TableHead>Math R:R</TableHead>
                  <TableHead className="text-right">TP %</TableHead>
                  <TableHead className="text-right">Net Profit</TableHead>
                  <TableHead className="text-right">Real R:R</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rrSimulation.map((sim) => (
                  <TableRow key={sim.tp}>
                    <TableCell className="font-medium">{sim.tp}</TableCell>
                    <TableCell className="font-mono text-sm">{sim.mathRR}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {sim.tpPercent.toFixed(3)}%
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      +{sim.netProfit.toFixed(3)}
                    </TableCell>
                    <TableCell className="text-right font-mono font-bold">
                      <span className={
                        sim.realRR < 1 
                          ? "text-destructive" 
                          : sim.realRR < 1.5
                          ? "text-warning" 
                          : sim.realRR < 2
                          ? "text-primary"
                          : "text-profit"
                      }>
                        {sim.realRR.toFixed(2)}:1
                        {sim.realRR < 1 && " ❌"}
                        {sim.realRR >= 1 && sim.realRR < 1.5 && " ⚠️"}
                        {sim.realRR >= 2 && " ✅"}
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </div>

        {/* Warnings */}
        {hasLowRR && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>Real R:R &lt; 1.0</strong> - Twoje TP nie pokrywają fees! Nawet jak trafisz TP, stracisz pieniądze.
            </AlertDescription>
          </Alert>
        )}

        {hasHighFeeImpact && (
          <Alert>
            <TrendingUp className="h-4 w-4" />
            <AlertDescription>
              <strong>Fee Impact &gt; 50%</strong> - Fees pochłaniają więcej niż połowę twojego max loss. Rozważ zwiększenie margin lub zmniejszenie leverage.
            </AlertDescription>
          </Alert>
        )}

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <div className="space-y-3">
            <h3 className="font-semibold text-sm flex items-center gap-2">
              💡 REKOMENDACJE OPTYMALIZACYJNE
            </h3>
            <div className="space-y-2">
              {recommendations.map((rec, idx) => (
                <div key={idx} className="flex items-center justify-between p-3 bg-primary/5 rounded-lg border border-primary/20">
                  <div className="flex-1">
                    <p className="font-semibold text-sm">{rec.title}</p>
                    <p className="text-xs text-muted-foreground">{rec.description}</p>
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={rec.action}
                    className="ml-4"
                  >
                    Zastosuj
                  </Button>
                </div>
              ))}
            </div>

            {/* Quick presets */}
            <div className="pt-2 border-t">
              <h4 className="text-xs font-semibold text-muted-foreground mb-2">Quick Presets:</h4>
              <div className="flex gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onMarginChange?.(3);
                    onLeverageChange?.(50);
                    onTP1RRChange?.(2.0);
                  }}
                >
                  <Zap className="h-3 w-3 mr-1" />
                  Conservative
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onMarginChange?.(2);
                    onLeverageChange?.(75);
                    onTP1RRChange?.(2.5);
                  }}
                >
                  <TrendingUp className="h-3 w-3 mr-1" />
                  Balanced
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    onMarginChange?.(1.5);
                    onLeverageChange?.(100);
                    onTP1RRChange?.(3.0);
                  }}
                >
                  <AlertTriangle className="h-3 w-3 mr-1" />
                  Aggressive
                </Button>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}