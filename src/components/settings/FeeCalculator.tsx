import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, TrendingUp, TrendingDown, RefreshCw, BarChart3, Target, Shield, Zap, Calculator } from "lucide-react";
import { TradingStats } from "@/hooks/useTradingStats";

interface FeeCalculatorProps {
  // Editable parameters
  margin: number;
  leverage: number;
  maxLoss: number;
  tp1RrRatio: number;
  tp2RrRatio: number;
  tp3RrRatio: number;
  tpLevels: number;
  
  // Callbacks
  onMarginChange: (value: number) => void;
  onLeverageChange: (value: number) => void;
  onMaxLossChange: (value: number) => void;
  onTP1RRChange: (value: number) => void;
  onTP2RRChange: (value: number) => void;
  onTP3RRChange: (value: number) => void;
  
  // Account balance
  accountBalance: number;
  onAccountBalanceChange: (value: number) => void;
  onFetchBalance?: () => Promise<void>;
  isFetchingBalance?: boolean;
  
  // Trading statistics
  tradingStats?: TradingStats;
  
  // Current bot settings
  currentSettings?: {
    positionSizingType: string;
    tpLevels: number;
    slMethod: string;
    maxLossPerTrade: number;
    maxMarginPerTrade: number;
    defaultLeverage: number;
    slToBreakeven: boolean;
    slPercentMin: number;
    slPercentMax: number;
  };
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

const BITGET_TAKER_FEE = 0.06; // 0.06% per side

export function FeeCalculator({
  margin,
  leverage,
  maxLoss,
  tp1RrRatio,
  tp2RrRatio,
  tp3RrRatio,
  tpLevels,
  onMarginChange,
  onLeverageChange,
  onMaxLossChange,
  onTP1RRChange,
  onTP2RRChange,
  onTP3RRChange,
  accountBalance,
  onAccountBalanceChange,
  onFetchBalance,
  isFetchingBalance = false,
  tradingStats,
  currentSettings,
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

    setRecommendations(newRecommendations);
  }, [margin, leverage, maxLoss, tp1RrRatio, tp2RrRatio, tp3RrRatio, tpLevels, onMarginChange, onLeverageChange, onTP1RRChange]);

  const hasLowRR = rrSimulation.some((sim) => sim.realRR < 1);
  const hasHighFeeImpact = calculations.feeImpactPercent > 50;

  const calculateIntelligentPresets = (
    balance: number, 
    stats: TradingStats | undefined,
    settings: any
  ) => {
    if (!stats || stats.totalTrades < 10) {
      // Default presets if not enough data
      return {
        conservative: {
          icon: Shield,
          name: "🛡️ BEZPIECZNY",
          description: `Max 0.5% kapitału na trade`,
          margin: Math.min(balance * 0.005, 0.5),
          leverage: 50,
          maxLoss: Math.min(balance * 0.002, 0.2),
          tp1RR: 2.0,
          expectedWinRate: 50,
          reasoning: "Brak wystarczających danych - używam konserwatywnego podejścia",
        },
        scalping: {
          icon: Zap,
          name: "⚡ SCALPING M5",
          description: "Optymalne dla interwału M5",
          margin: Math.min(balance * 0.01, 1),
          leverage: 100,
          maxLoss: settings?.maxLossPerTrade || 0.25,
          tp1RR: 1.0,
          expectedWinRate: 50,
          reasoning: "Scalping wymaga wysokiego leverage i małych SL",
        },
      };
    }

    return {
      dataOptimized: {
        icon: BarChart3,
        name: "📊 OPTYMALNE (z danych)",
        description: `Bazowane na ${stats.totalTrades} Twoich tradeów`,
        margin: 0.8, // < 1 USDT = best win rate
        leverage: stats.bestLeverage || 75,
        maxLoss: settings?.maxLossPerTrade || 0.25,
        tp1RR: 1.5,
        expectedWinRate: stats.bestMarginWinRate,
        reasoning: `Twoje dane pokazują, że margin ${stats.bestMarginBucket} ma ${stats.bestMarginWinRate.toFixed(1)}% win rate`,
      },
      conservative: {
        icon: Shield,
        name: "🛡️ BEZPIECZNY",
        description: `Max ${((0.5/balance)*100).toFixed(1)}% kapitału`,
        margin: Math.min(balance * 0.005, 0.5),
        leverage: 50,
        maxLoss: Math.min(balance * 0.002, 0.2),
        tp1RR: 2.0,
        expectedWinRate: Math.min(stats.winRate * 1.1, 100),
        reasoning: "Ultra-bezpieczny dla małych kont",
      },
      scalping: {
        icon: Zap,
        name: "⚡ SCALPING M5",
        description: "Optymalne dla interwału M5 i szybkich wejść",
        margin: Math.min(balance * 0.01, 1),
        leverage: 100,
        maxLoss: settings?.maxLossPerTrade || 0.25,
        tp1RR: 1.0,
        expectedWinRate: 50,
        reasoning: "Scalping wymaga wysokiego leverage i małych SL",
      },
      tierOptimized: {
        icon: Target,
        name: "🎯 TIER-OPTYMALNE",
        description: `Optymalne dla tier ${stats.bestTier} (${stats.bestTierWinRate.toFixed(0)}% win)`,
        margin: 0.8,
        leverage: stats.bestLeverage || 75,
        maxLoss: settings?.maxLossPerTrade || 0.25,
        tp1RR: 1.5,
        expectedWinRate: stats.bestTierWinRate,
        reasoning: `Tier "${stats.bestTier}" generuje najlepsze wyniki (+${stats.bestTierTotalPnl.toFixed(2)} USDT total)`,
      },
    };
  };

  const presets = calculateIntelligentPresets(accountBalance, tradingStats, currentSettings);

  const applyPreset = (preset: any) => {
    onMarginChange(preset.margin);
    onLeverageChange(preset.leverage);
    onMaxLossChange(preset.maxLoss);
    onTP1RRChange(preset.tp1RR);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Calculator className="h-5 w-5" />
          💰 Fee Calculator & Strategy Optimizer
        </CardTitle>
        <CardDescription>
          Inteligentny kalkulator oparty o TWOJE dane tradingowe
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Fixed Information */}
        <div className="p-4 bg-muted/50 rounded-lg">
          <div className="flex items-center justify-between text-sm">
            <span className="text-muted-foreground">Bitget Taker Fee:</span>
            <span className="font-mono font-semibold">0.06%</span>
          </div>
          <div className="flex items-center justify-between text-sm mt-2">
            <span className="text-muted-foreground">Round-trip (entry + exit):</span>
            <span className="font-mono font-semibold">0.12%</span>
          </div>
        </div>

        {/* Account Balance Section */}
        <div className="space-y-4">
          <div>
            <h3 className="font-semibold text-lg mb-3">💰 SALDO KONTA</h3>
            <div className="flex gap-2">
              <div className="flex-1">
                <Input
                  type="number"
                  value={accountBalance}
                  onChange={(e) => onAccountBalanceChange(parseFloat(e.target.value) || 0)}
                  step="0.01"
                  className="text-lg font-semibold"
                />
              </div>
              <span className="flex items-center text-muted-foreground">USDT</span>
              {onFetchBalance && (
                <Button 
                  onClick={onFetchBalance}
                  disabled={isFetchingBalance}
                  variant="outline"
                  size="default"
                >
                  {isFetchingBalance ? (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2 animate-spin" />
                      Pobieranie...
                    </>
                  ) : (
                    <>
                      <RefreshCw className="w-4 h-4 mr-2" />
                      Pobierz z Bitget
                    </>
                  )}
                </Button>
              )}
            </div>
          </div>

          {/* Trading Statistics */}
          {tradingStats && tradingStats.totalTrades > 0 && (
            <div className="p-4 bg-primary/5 border border-primary/20 rounded-lg space-y-3">
              <div className="flex items-center gap-2 mb-3">
                <BarChart3 className="w-5 h-5 text-primary" />
                <h4 className="font-semibold">📊 TWOJE STATYSTYKI TRADINGU ({tradingStats.totalTrades} tradeów)</h4>
              </div>
              
              <div className="space-y-2">
                <div className="font-medium text-sm">🎯 NAJLEPSZE WYNIKI:</div>
                <div className="grid grid-cols-1 gap-2 text-sm pl-4">
                  <div>
                    <span className="text-muted-foreground">• Margin {tradingStats.bestMarginBucket}: </span>
                    <span className="font-semibold text-green-600">{tradingStats.bestMarginWinRate.toFixed(1)}% win rate</span>
                    <span className="text-muted-foreground"> ({tradingStats.bestMarginAvgPnl >= 0 ? '+' : ''}{tradingStats.bestMarginAvgPnl.toFixed(2)} USDT avg)</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">• Leverage {tradingStats.bestLeverage}x: </span>
                    <span className="font-semibold text-green-600">{tradingStats.bestLeverageWinRate.toFixed(1)}% win rate</span>
                    <span className="text-muted-foreground"> (najstabilniejszy)</span>
                  </div>
                  <div>
                    <span className="text-muted-foreground">• Tier "{tradingStats.bestTier}": </span>
                    <span className="font-semibold text-green-600">{tradingStats.bestTierWinRate.toFixed(1)}% win rate</span>
                    <span className="text-muted-foreground"> ({tradingStats.bestTierTotalPnl >= 0 ? '+' : ''}{tradingStats.bestTierTotalPnl.toFixed(2)} USDT total)</span>
                  </div>
                </div>

                {tradingStats.worstMarginWinRate < 20 && (
                  <>
                    <div className="font-medium text-sm mt-3 text-orange-600">⚠️ PROBLEMY DO NAPRAWY:</div>
                    <div className="grid grid-cols-1 gap-2 text-sm pl-4">
                      <div>
                        <span className="text-muted-foreground">• Margin {tradingStats.worstMarginBucket}: </span>
                        <span className="font-semibold text-red-600">tylko {tradingStats.worstMarginWinRate.toFixed(1)}% win rate</span>
                      </div>
                      <div className="text-muted-foreground">
                        • Fees zjadają zyski przy dużym notional
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
          )}
        </div>

        <Separator />

        {/* Intelligent Presets */}
        <div className="space-y-4">
          <h3 className="font-semibold text-lg">🎯 INTELIGENTNE PRESETY</h3>
          <div className="grid gap-4">
            {Object.entries(presets).map(([key, preset]: [string, any]) => {
              const Icon = preset.icon;
              const capitalUsed = ((preset.margin / accountBalance) * 100).toFixed(2);
              
              return (
                <div key={key} className="p-4 border rounded-lg hover:border-primary/50 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <Icon className="w-5 h-5 text-primary" />
                      <div>
                        <div className="font-semibold">{preset.name}</div>
                        <div className="text-sm text-muted-foreground">{preset.description}</div>
                      </div>
                    </div>
                    <Button 
                      onClick={() => applyPreset(preset)}
                      size="sm"
                      variant="outline"
                    >
                      Zastosuj
                    </Button>
                  </div>
                  
                  <div className="grid grid-cols-4 gap-3 text-sm mb-2">
                    <div>
                      <div className="text-xs text-muted-foreground">Margin</div>
                      <div className="font-semibold">{preset.margin.toFixed(2)} USDT</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Leverage</div>
                      <div className="font-semibold">{preset.leverage}x</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">Max Loss</div>
                      <div className="font-semibold">{preset.maxLoss.toFixed(2)} USDT</div>
                    </div>
                    <div>
                      <div className="text-xs text-muted-foreground">% kapitału</div>
                      <div className="font-semibold">{capitalUsed}%</div>
                    </div>
                  </div>
                  
                  <div className="text-xs p-2 bg-muted/30 rounded">
                    <div className="font-medium mb-1">📈 Oczekiwany win rate: ~{preset.expectedWinRate.toFixed(0)}%</div>
                    <div className="text-muted-foreground">💡 {preset.reasoning}</div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <Separator />

        {/* Simulation Parameters */}
        <div className="space-y-4">
          <h3 className="font-semibold">📐 PARAMETRY SYMULACJI</h3>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Margin (USDT)</Label>
              <Input
                type="number"
                value={margin}
                onChange={(e) => onMarginChange(parseFloat(e.target.value) || 0)}
                step="0.1"
              />
            </div>
            <div className="space-y-2">
              <Label>Leverage (x)</Label>
              <Input
                type="number"
                value={leverage}
                onChange={(e) => onLeverageChange(parseInt(e.target.value) || 10)}
                step="5"
              />
            </div>
            <div className="space-y-2">
              <Label>Max Loss (USDT)</Label>
              <Input
                type="number"
                value={maxLoss}
                onChange={(e) => onMaxLossChange(parseFloat(e.target.value) || 0)}
                step="0.1"
              />
            </div>
            <div className="space-y-2">
              <Label>TP1 R:R Ratio</Label>
              <Input
                type="number"
                value={tp1RrRatio}
                onChange={(e) => onTP1RRChange(parseFloat(e.target.value) || 1.5)}
                step="0.1"
              />
            </div>
          </div>
        </div>

        <Separator />

        {/* Results Section */}
        <div className="space-y-4">
          <h3 className="font-semibold">💰 WYNIKI KALKULACJI</h3>
          
          <div className="grid grid-cols-3 gap-4">
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="text-xs text-muted-foreground">Notional</div>
              <div className="font-mono font-semibold text-lg">{calculations.notional.toFixed(2)} USDT</div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="text-xs text-muted-foreground">Round-trip Fees</div>
              <div className="font-mono font-semibold text-lg text-destructive">{calculations.roundTripFees.toFixed(2)} USDT</div>
            </div>
            <div className="p-3 bg-muted/50 rounded-lg">
              <div className="text-xs text-muted-foreground">Real Max Loss</div>
              <div className="font-mono font-semibold text-lg">{calculations.realMaxLoss.toFixed(2)} USDT</div>
            </div>
          </div>

          {/* TP Simulation Table */}
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>TP</TableHead>
                <TableHead>Math R:R</TableHead>
                <TableHead>Gross PnL</TableHead>
                <TableHead>Net PnL</TableHead>
                <TableHead>Real R:R</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rrSimulation.map((sim) => (
                <TableRow key={sim.tp}>
                  <TableCell className="font-medium">{sim.tp}</TableCell>
                  <TableCell>{sim.mathRR}</TableCell>
                  <TableCell>+{sim.grossProfit.toFixed(2)}</TableCell>
                  <TableCell className={sim.netProfit >= 0 ? "text-green-600" : "text-red-600"}>
                    {sim.netProfit >= 0 ? '+' : ''}{sim.netProfit.toFixed(2)}
                  </TableCell>
                  <TableCell className={sim.realRR >= 1 ? "font-semibold" : "font-semibold text-red-600"}>
                    {sim.realRR.toFixed(2)}:1 {sim.realRR < 1 && '⚠️'}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>

          {/* Warnings */}
          {hasLowRR && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Niskie Real R:R!</strong> Jeden lub więcej poziomów TP ma Real R:R {'<'} 1.0. Zysk nie pokryje straty!
              </AlertDescription>
            </Alert>
          )}

          {hasHighFeeImpact && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>
                <strong>Wysoki wpływ fees!</strong> Fees stanowią {calculations.feeImpactPercent.toFixed(0)}% max loss. Rozważ zwiększenie marginu lub zmniejszenie leverage.
              </AlertDescription>
            </Alert>
          )}
        </div>

        {/* Recommendations */}
        {recommendations.length > 0 && (
          <>
            <Separator />
            <div className="space-y-3">
              <h3 className="font-semibold">💡 REKOMENDACJE</h3>
              {recommendations.map((rec, idx) => (
                <div key={idx} className="p-3 bg-primary/5 border border-primary/20 rounded-lg">
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="font-medium">{rec.title}</div>
                      <div className="text-sm text-muted-foreground mt-1">{rec.description}</div>
                    </div>
                    <Button onClick={rec.action} size="sm" variant="outline">
                      Zastosuj
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
