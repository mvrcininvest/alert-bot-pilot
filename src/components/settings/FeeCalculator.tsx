import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Calculator, AlertTriangle } from "lucide-react";
import { useState, useEffect } from "react";

interface FeeCalculatorProps {
  takerFeeRate: number;
  includeFeesInCalculations: boolean;
  minProfitableTpPercent: number;
  margin: number;
  leverage: number;
  maxLoss: number;
  tp1RrRatio?: number;
  tp2RrRatio?: number;
  tp3RrRatio?: number;
  readOnly?: boolean;
  onFeeRateChange: (value: number) => void;
  onIncludeFeesChange: (value: boolean) => void;
  onMinProfitableTpChange: (value: number) => void;
}

export function FeeCalculator({
  takerFeeRate,
  includeFeesInCalculations,
  minProfitableTpPercent,
  margin,
  leverage,
  maxLoss,
  tp1RrRatio = 1.5,
  tp2RrRatio = 2.5,
  tp3RrRatio = 3.5,
  readOnly = false,
  onFeeRateChange,
  onIncludeFeesChange,
  onMinProfitableTpChange,
}: FeeCalculatorProps) {
  const [calculations, setCalculations] = useState({
    notional: 0,
    roundTripFees: 0,
    realMaxLoss: 0,
    breakEvenPercent: 0,
    feeImpactPercent: 0,
  });

  const [rrSimulation, setRrSimulation] = useState<Array<{
    tp: string;
    mathRR: string;
    grossProfit: number;
    netProfit: number;
    realRR: number;
  }>>([]);

  useEffect(() => {
    // Calculate real-time values
    const notional = margin * leverage;
    const roundTripFees = notional * (takerFeeRate * 2) / 100;
    const realMaxLoss = maxLoss + roundTripFees;
    const breakEvenPercent = takerFeeRate * 2;
    const feeImpactPercent = maxLoss > 0 ? (roundTripFees / maxLoss) * 100 : 0;

    setCalculations({
      notional,
      roundTripFees,
      realMaxLoss,
      breakEvenPercent,
      feeImpactPercent,
    });

    // Simulate R:R for TP1, TP2, TP3
    const tpRatios = [
      { tp: "TP1", mathRR: `${tp1RrRatio.toFixed(1)}:1`, ratio: tp1RrRatio },
      { tp: "TP2", mathRR: `${tp2RrRatio.toFixed(1)}:1`, ratio: tp2RrRatio },
      { tp: "TP3", mathRR: `${tp3RrRatio.toFixed(1)}:1`, ratio: tp3RrRatio },
    ];

    const simulation = tpRatios.map(({ tp, mathRR, ratio }) => {
      const grossProfit = maxLoss * ratio;
      const netProfit = grossProfit - roundTripFees;
      const realRR = netProfit / realMaxLoss;

      return {
        tp,
        mathRR,
        grossProfit,
        netProfit,
        realRR,
      };
    });

    setRrSimulation(simulation);
  }, [margin, leverage, maxLoss, takerFeeRate, tp1RrRatio, tp2RrRatio, tp3RrRatio]);

  const hasLowRR = rrSimulation.some((sim) => sim.realRR < 1);
  const hasHighFeeImpact = calculations.feeImpactPercent > 50;

  return (
    <Card className="border-primary/20">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          🧮 Fee Calculator
          {readOnly && <span className="text-xs text-muted-foreground">(Admin settings)</span>}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Input controls */}
        <div className="space-y-4 p-4 bg-muted/50 rounded-lg">
          <h3 className="font-semibold text-sm">TWOJE PARAMETRY</h3>
          
          <div className="space-y-2">
            <Label>Taker Fee Rate (% per side)</Label>
            <Input
              type="number"
              step="0.01"
              value={takerFeeRate}
              onChange={(e) => onFeeRateChange(parseFloat(e.target.value))}
              disabled={readOnly}
            />
            <p className="text-xs text-muted-foreground">
              Standardowo 0.06% za otwarcie + 0.06% za zamknięcie = 0.12% round-trip
            </p>
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Include Fees in Calculations</Label>
              <p className="text-xs text-muted-foreground">
                Uwzględniaj fees w obliczeniach SL/TP
              </p>
            </div>
            <Switch
              checked={includeFeesInCalculations}
              onCheckedChange={onIncludeFeesChange}
              disabled={readOnly}
            />
          </div>

          <div className="space-y-2">
            <Label>Min Profitable TP (%)</Label>
            <Input
              type="number"
              step="0.1"
              value={minProfitableTpPercent}
              onChange={(e) => onMinProfitableTpChange(parseFloat(e.target.value))}
              disabled={readOnly}
            />
            <p className="text-xs text-muted-foreground">
              Minimalna odległość TP od entry żeby mieć zysk po fees
            </p>
          </div>

          <div className="grid grid-cols-3 gap-4 pt-2 border-t">
            <div>
              <Label className="text-xs text-muted-foreground">Margin</Label>
              <p className="font-mono font-semibold">{margin.toFixed(2)} USDT</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Leverage</Label>
              <p className="font-mono font-semibold">{leverage}x</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">Max Loss (bez fees)</Label>
              <p className="font-mono font-semibold">{maxLoss.toFixed(2)} USDT</p>
            </div>
          </div>
        </div>

        {/* Real-time calculations */}
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">📊 OBLICZENIA W CZASIE RZECZYWISTYM</h3>
          
          <div className="grid grid-cols-2 gap-3">
            <div className="p-3 bg-muted/30 rounded">
              <Label className="text-xs text-muted-foreground">Notional Value</Label>
              <p className="text-lg font-mono font-bold">{calculations.notional.toFixed(2)} USDT</p>
            </div>
            <div className="p-3 bg-muted/30 rounded">
              <Label className="text-xs text-muted-foreground">Round-trip Fees (0.12%)</Label>
              <p className="text-lg font-mono font-bold text-destructive">
                {calculations.roundTripFees.toFixed(4)} USDT
              </p>
            </div>
          </div>

          <div className="space-y-2 pt-4 border-t">
            <h4 className="font-semibold text-xs text-muted-foreground">─── RZECZYWISTE WARTOŚCI ───</h4>
            
            <div className="space-y-2">
              <div className="flex items-center justify-between p-2 bg-destructive/10 rounded">
                <Label className="text-sm">❌ Real Max Loss:</Label>
                <span className="font-mono font-bold text-destructive">
                  {calculations.realMaxLoss.toFixed(4)} USDT
                  <span className="text-xs ml-2">
                    (+{calculations.feeImpactPercent.toFixed(1)}% przez fees!)
                  </span>
                </span>
              </div>

              <div className="flex items-center justify-between p-2 bg-muted/30 rounded">
                <Label className="text-sm">🎯 Break-even TP:</Label>
                <span className="font-mono font-bold">
                  {calculations.breakEvenPercent.toFixed(2)}%
                </span>
              </div>

              <div className="flex items-center justify-between p-2 bg-primary/10 rounded">
                <Label className="text-sm">💰 Min Profitable TP:</Label>
                <span className="font-mono font-bold text-primary">
                  {minProfitableTpPercent.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* R:R Simulation table */}
        <div className="space-y-3">
          <h3 className="font-semibold text-sm">─── SYMULACJA R:R ───</h3>
          
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-[80px]">TP</TableHead>
                <TableHead>Math R:R</TableHead>
                <TableHead className="text-right">Gross</TableHead>
                <TableHead className="text-right">Net</TableHead>
                <TableHead className="text-right">Real R:R</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rrSimulation.map((sim) => (
                <TableRow key={sim.tp}>
                  <TableCell className="font-medium">{sim.tp}</TableCell>
                  <TableCell className="font-mono">{sim.mathRR}</TableCell>
                  <TableCell className="text-right font-mono">
                    +{sim.grossProfit.toFixed(3)}
                  </TableCell>
                  <TableCell className="text-right font-mono">
                    +{sim.netProfit.toFixed(3)}
                  </TableCell>
                  <TableCell className="text-right font-mono font-bold">
                    <span className={
                      sim.realRR < 1 
                        ? "text-destructive" 
                        : sim.realRR < 2 
                        ? "text-warning" 
                        : "text-profit"
                    }>
                      {sim.realRR.toFixed(2)}:1
                      {sim.realRR < 1 && " ⚠️"}
                      {sim.realRR >= 2 && " ✅"}
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Trade Simulation */}
        <div className="space-y-3 p-4 bg-primary/5 rounded-lg border border-primary/20">
          <h3 className="font-semibold text-sm">📍 SYMULACJA TRADE (przykład @ $100,000)</h3>
          
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div>
              <Label className="text-xs text-muted-foreground">Entry Price</Label>
              <p className="font-mono">$100,000</p>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">SL Price</Label>
              <p className="font-mono text-destructive">
                ${(100000 * (1 - (calculations.realMaxLoss / (margin * leverage)))).toFixed(2)}
                <span className="text-xs ml-1">
                  (-{((calculations.realMaxLoss / (margin * leverage)) * 100).toFixed(2)}%)
                </span>
              </p>
            </div>
            {rrSimulation.map((sim, idx) => (
              <div key={sim.tp}>
                <Label className="text-xs text-muted-foreground">{sim.tp} Price</Label>
                <p className={`font-mono ${sim.realRR >= 1 ? 'text-profit' : 'text-destructive'}`}>
                  ${(100000 * (1 + (sim.netProfit / (margin * leverage)))).toFixed(2)}
                  <span className="text-xs ml-1">
                    (+{((sim.netProfit / (margin * leverage)) * 100).toFixed(3)}%)
                  </span>
                </p>
              </div>
            ))}
          </div>

          <div className="pt-3 border-t space-y-2">
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Notional Value:</span>
              <span className="font-mono">{calculations.notional.toFixed(2)} USDT</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Round-trip Fees:</span>
              <span className="font-mono text-destructive">{calculations.roundTripFees.toFixed(4)} USDT</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">Max Loss (net):</span>
              <span className="font-mono font-bold text-destructive">{calculations.realMaxLoss.toFixed(4)} USDT</span>
            </div>
            <div className="flex justify-between text-sm pt-2 border-t">
              <span className="text-muted-foreground">TP1 Profit (net):</span>
              <span className={`font-mono font-bold ${rrSimulation[0]?.netProfit > 0 ? 'text-profit' : 'text-destructive'}`}>
                +{rrSimulation[0]?.netProfit.toFixed(4)} USDT
              </span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-muted-foreground">TP1 Real R:R:</span>
              <span className={`font-mono font-bold ${rrSimulation[0]?.realRR >= 1 ? 'text-profit' : 'text-destructive'}`}>
                {rrSimulation[0]?.realRR.toFixed(2)}:1 {rrSimulation[0]?.realRR < 1 ? '⚠️ STRATA!' : '✅'}
              </span>
            </div>
          </div>
        </div>

        {/* Warnings */}
        {hasLowRR && (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>⚠️ OSTRZEŻENIE:</strong> Twój TP1 (R:R {rrSimulation[0]?.mathRR}) po fees ma realny R:R &lt; 1!
              <br />
              <strong>Zalecenie:</strong> Zwiększ R:R ratio do minimum 2.0 lub zwiększ margin 
              żeby zmniejszyć % wpływu fees.
            </AlertDescription>
          </Alert>
        )}

        {hasHighFeeImpact && !hasLowRR && (
          <Alert>
            <AlertTriangle className="h-4 w-4" />
            <AlertDescription>
              <strong>⚠️ Wysokie opłaty:</strong> Fees stanowią {calculations.feeImpactPercent.toFixed(1)}% Twojej maksymalnej straty!
              <br />
              <strong>Zalecenie:</strong> Zwiększ margin lub zmniejsz leverage żeby zredukować wpływ fees.
            </AlertDescription>
          </Alert>
        )}
      </CardContent>
    </Card>
  );
}
