import React, { useState, useEffect } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { AlertTriangle, TrendingUp, TrendingDown, RefreshCw, BarChart3, Target, Shield, Zap, Calculator, ChevronRight } from "lucide-react";
import { TradingStats } from "@/hooks/useTradingStats";
import { cn } from "@/lib/utils";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface FeeCalculatorProps {
  // Editable parameters
  margin: number;
  leverage: number;
  maxLoss: number;
  tp1RrRatio: number;
  tp2RrRatio: number;
  tp3RrRatio: number;
  tpLevels: number;
  tp1ClosePct?: number;
  tp2ClosePct?: number;
  tp3ClosePct?: number;
  
  // Callbacks
  onMarginChange: (value: number) => void;
  onLeverageChange: (value: number) => void;
  onMaxLossChange: (value: number) => void;
  onTP1RRChange: (value: number) => void;
  onTP2RRChange: (value: number) => void;
  onTP3RRChange: (value: number) => void;
  onTPLevelsChange?: (value: number) => void;
  onTP1ClosePctChange?: (value: number) => void;
  onTP2ClosePctChange?: (value: number) => void;
  onTP3ClosePctChange?: (value: number) => void;
  
  // Advanced optional parameters
  entryPrice?: number;
  onEntryPriceChange?: (value: number | undefined) => void;
  slPercent?: number;
  onSlPercentChange?: (value: number | undefined) => void;
  takerFeeRate?: number;
  onTakerFeeRateChange?: (value: number) => void;
  symbolCategory?: string;
  onSymbolCategoryChange?: (value: string) => void;
  atrValue?: number;
  onAtrValueChange?: (value: number | undefined) => void;
  
  // Trade series simulation
  seriesWins?: number;
  onSeriesWinsChange?: (value: number) => void;
  seriesLosses?: number;
  onSeriesLossesChange?: (value: number) => void;
  
  // Account balance
  accountBalance: number;
  onAccountBalanceChange: (value: number) => void;
  onFetchBalance?: () => Promise<void>;
  isFetchingBalance?: boolean;
  
  // Trading statistics
  tradingStats?: TradingStats;
  onRefreshStats?: () => void;
  isRefreshingStats?: boolean;
  
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
  closePct: number;
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
  tp1ClosePct,
  tp2ClosePct,
  tp3ClosePct,
  onMarginChange,
  onLeverageChange,
  onMaxLossChange,
  onTP1RRChange,
  onTP2RRChange,
  onTP3RRChange,
  onTPLevelsChange,
  onTP1ClosePctChange,
  onTP2ClosePctChange,
  onTP3ClosePctChange,
  entryPrice,
  onEntryPriceChange,
  slPercent,
  onSlPercentChange,
  takerFeeRate = 0.06,
  onTakerFeeRateChange,
  symbolCategory = 'ALTCOIN',
  onSymbolCategoryChange,
  atrValue,
  onAtrValueChange,
  seriesWins = 10,
  onSeriesWinsChange,
  seriesLosses = 5,
  onSeriesLossesChange,
  accountBalance,
  onAccountBalanceChange,
  onFetchBalance,
  isFetchingBalance = false,
  tradingStats,
  onRefreshStats,
  isRefreshingStats = false,
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
  
  // Calculate trade series simulation
  const totalTrades = seriesWins + seriesLosses;
  const winRate = totalTrades > 0 ? (seriesWins / totalTrades) * 100 : 0;
  
  // Calculate expected PnL from trade series - sum all TP levels
  const totalWinProfit = rrSimulation.reduce((sum, sim) => sum + sim.netProfit, 0);
  const totalPnL = (seriesWins * totalWinProfit) - (seriesLosses * calculations.realMaxLoss);
  const expectedPerTrade = totalTrades > 0 ? totalPnL / totalTrades : 0;
  const maxDrawdown = seriesLosses * calculations.realMaxLoss;

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

  // Calculate Real R:R with fees (exact same as simulation)
  const calculateRealRR = (margin: number, leverage: number, maxLoss: number, mathRR: number) => {
    const notional = margin * leverage;
    const feeRate = BITGET_TAKER_FEE / 100;
    const roundTripFees = notional * feeRate * 2;
    const realMaxLoss = maxLoss + roundTripFees;
    const slPercent = maxLoss / notional;
    const tpPercent = slPercent * mathRR;
    const grossProfit = notional * tpPercent;
    const netProfit = grossProfit - roundTripFees;
    const realRR = netProfit / realMaxLoss;
    
    return {
      realRR,
      netProfit,
      grossProfit,
      roundTripFees,
      realMaxLoss,
      feeImpactPercent: (roundTripFees / maxLoss) * 100
    };
  };

  // Calculate minimum Math R:R needed for target Real R:R
  const calculateMinMathRRForTargetRealRR = (
    margin: number, 
    leverage: number, 
    maxLoss: number, 
    targetRealRR: number = 1.0
  ): number => {
    const notional = margin * leverage;
    const feeRate = BITGET_TAKER_FEE / 100;
    const roundTripFees = notional * feeRate * 2;
    const realMaxLoss = maxLoss + roundTripFees;
    // Solving: (notional * slPercent * mathRR - fees) / realMaxLoss = targetRealRR
    // mathRR = (targetRealRR * realMaxLoss + fees) / maxLoss
    const minMathRR = (targetRealRR * realMaxLoss + roundTripFees) / maxLoss;
    return Math.max(minMathRR, 1.0);
  };

  useEffect(() => {
    // Calculate real-time values
    const notional = margin * leverage;
    const feeRate = (takerFeeRate || BITGET_TAKER_FEE) / 100;
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

    // Simulate R:R for configured number of TPs with closePct
    const tpRatios = [
      { tp: "TP1", ratio: tp1RrRatio, closePct: tp1ClosePct ?? (tpLevels === 1 ? 100 : 50) },
      { tp: "TP2", ratio: tp2RrRatio, closePct: tp2ClosePct ?? (tpLevels === 2 ? 50 : 30) },
      { tp: "TP3", ratio: tp3RrRatio, closePct: tp3ClosePct ?? 20 },
    ].slice(0, tpLevels); // Only show configured number of TPs

    const simulation: RRSimulation[] = tpRatios.map(({ tp, ratio, closePct }) => {
      const tpPercent = slPercent * ratio;
      const positionPart = closePct / 100;
      
      // Gross profit proportional to closed position part
      const grossProfit = notional * tpPercent * positionPart;
      
      // Fees proportional to closed position part
      const exitFee = notional * positionPart * feeRate;
      const entryFeeForPart = notional * positionPart * feeRate;
      const feesForPart = entryFeeForPart + exitFee;
      
      const netProfit = grossProfit - feesForPart;
      const realRR = netProfit / (maxLoss * positionPart + feesForPart);

      return {
        tp,
        mathRR: `${ratio.toFixed(1)}:1`,
        ratio,
        tpPercent: tpPercent * 100,
        grossProfit,
        netProfit,
        realRR,
        closePct,
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
  }, [margin, leverage, maxLoss, tp1RrRatio, tp2RrRatio, tp3RrRatio, tpLevels, tp1ClosePct, tp2ClosePct, tp3ClosePct, slPercent, entryPrice, takerFeeRate, onMarginChange, onLeverageChange, onTP1RRChange]);

  const hasLowRR = rrSimulation.some((sim) => sim.realRR < 1);
  const hasHighFeeImpact = calculations.feeImpactPercent > 50;

  // Symbol categories for leverage-aware presets
  const SYMBOL_CATEGORIES = [
    { id: 'BTC_ETH', name: 'BTC/ETH', maxLeverage: 150, symbols: 'BTCUSDT, ETHUSDT' },
    { id: 'MAJOR', name: 'Major', maxLeverage: 100, symbols: 'SOL, XRP, BNB' },
    { id: 'ALTCOIN', name: 'Altcoiny', maxLeverage: 75, symbols: 'Pozostałe' },
  ];

  const calculateIntelligentPresets = (
    balance: number, 
    stats: TradingStats | undefined,
    settings: any
  ) => {
    // Helper to create TP breakdown for a preset
    const createTPBreakdown = (margin: number, leverage: number, maxLoss: number, tp1RR: number, tpLevels: number, tp1ClosePct: number, tp2ClosePct: number) => {
      const breakdown = [];
      const tpRatios = [tp1RR, tp1RR * 1.5, tp1RR * 2];
      const closePcts = [tp1ClosePct, tp2ClosePct, 100 - tp1ClosePct - tp2ClosePct];
      
      for (let i = 0; i < tpLevels; i++) {
        const calc = calculateRealRR(margin, leverage, maxLoss, tpRatios[i]);
        breakdown.push({
          level: i + 1,
          mathRR: tpRatios[i],
          realRR: calc.realRR,
          closePct: closePcts[i],
          netProfit: calc.netProfit * (closePcts[i] / 100)
        });
      }
      
      return breakdown;
    };

    // Helper to calculate fee-aware preset with full TP breakdown
    const createFeeAwarePreset = (presetConfig: any) => {
      const realRRCalc = calculateRealRR(
        presetConfig.margin, 
        presetConfig.leverage, 
        presetConfig.maxLoss, 
        presetConfig.tp1RR
      );
      const isRRHealthy = realRRCalc.realRR >= 1.0;
      
      let adjustedTP1RR = presetConfig.tp1RR;
      let autoAdjusted = false;
      
      // Auto-correct if Real R:R < 1.0
      if (!isRRHealthy) {
        adjustedTP1RR = calculateMinMathRRForTargetRealRR(
          presetConfig.margin,
          presetConfig.leverage,
          presetConfig.maxLoss,
          1.0
        );
        adjustedTP1RR = Math.ceil(adjustedTP1RR * 10) / 10;
        autoAdjusted = true;
      }
      
      // Recalculate with adjusted R:R
      const finalCalc = calculateRealRR(
        presetConfig.margin, 
        presetConfig.leverage, 
        presetConfig.maxLoss, 
        adjustedTP1RR
      );
      
      // Create full TP breakdown
      const tpBreakdown = createTPBreakdown(
        presetConfig.margin,
        presetConfig.leverage,
        presetConfig.maxLoss,
        adjustedTP1RR,
        presetConfig.tpLevels || 1,
        presetConfig.tp1ClosePct || 100,
        presetConfig.tp2ClosePct || 0
      );
      
      const totalExpectedProfit = tpBreakdown.reduce((sum, tp) => sum + tp.netProfit, 0);
      
      return {
        ...presetConfig,
        tp1RR: adjustedTP1RR,
        tp2RR: adjustedTP1RR * 1.5,
        tp3RR: adjustedTP1RR * 2,
        tp1RealRR: finalCalc.realRR,
        tp1NetProfit: finalCalc.netProfit,
        feeImpactPercent: finalCalc.feeImpactPercent,
        isRRHealthy: finalCalc.realRR >= 1.0,
        suggestedMinRR: !isRRHealthy ? adjustedTP1RR : null,
        autoAdjusted,
        tpBreakdown,
        totalExpectedProfit,
        reasoning: autoAdjusted 
          ? `⚠️ Math R:R podniesione z ${presetConfig.tp1RR.toFixed(1)} do ${adjustedTP1RR.toFixed(1)} dla Real R:R ≥ 1.0. ${presetConfig.reasoning}`
          : `Real R:R ${finalCalc.realRR.toFixed(2)}:1 po fees. ${presetConfig.reasoning}`,
      };
    };

    if (!stats || stats.totalTrades < 10) {
      // Generate category-specific presets without sufficient data
      const presets: any = {};
      
      SYMBOL_CATEGORIES.forEach(category => {
        const effectiveLeverage = Math.min(75, category.maxLeverage);
        const leverageWarning = 75 > category.maxLeverage 
          ? `⚠️ Leverage obcięty do max ${category.maxLeverage}x dla tej kategorii`
          : null;
        
        presets[`${category.id}`] = createFeeAwarePreset({
          icon: BarChart3,
          name: `📊 OPTYMALNE (${category.name})`,
          description: `Max ${category.maxLeverage}x | ${category.symbols}`,
          category: category.id,
          supportedSymbols: category.symbols,
          leverageWarning,
          margin: 0.8,
          leverage: effectiveLeverage,
          maxLoss: settings?.maxLossPerTrade || 0.25,
          tp1RR: 1.5,
          tpLevels: 1,
          tp1ClosePct: 100,
          tp2ClosePct: 0,
          tp3ClosePct: 0,
          calculatedSLPercent: (((settings?.maxLossPerTrade || 0.25) / (0.8 * effectiveLeverage)) * 100).toFixed(2),
          expectedWinRate: 50,
          reasoning: "Brak wystarczających danych - podstawowy preset",
        });
      });
      
      return presets;
    }

    // With enough data, generate category-specific presets
    const bestTP1RR = stats.bestTP1RR || 1.5;
    const optimalTPLevels = stats.optimalTPLevels || 1;
    const optimalTP1ClosePct = stats.optimalTP1ClosePct || 100;
    const optimalTP2ClosePct = stats.optimalTP2ClosePct || 0;
    
    const presets: any = {};
    
    SYMBOL_CATEGORIES.forEach(category => {
      const effectiveLeverage = Math.min(stats.bestLeverage || 75, category.maxLeverage);
      const leverageWarning = (stats.bestLeverage || 75) > category.maxLeverage 
        ? `⚠️ Twój optymalny leverage (${stats.bestLeverage}x) obcięty do max ${category.maxLeverage}x`
        : null;
      
      presets[`dataOptimized_${category.id}`] = createFeeAwarePreset({
        icon: BarChart3,
        name: `📊 OPTYMALNE (${category.name})`,
        description: `Bazowane na ${stats.totalTrades} tradeów | Max ${category.maxLeverage}x`,
        category: category.id,
        supportedSymbols: category.symbols,
        leverageWarning,
        margin: 0.8,
        leverage: effectiveLeverage,
        maxLoss: settings?.maxLossPerTrade || 0.25,
        tp1RR: bestTP1RR,
        tpLevels: optimalTPLevels,
        tp1ClosePct: optimalTP1ClosePct,
        tp2ClosePct: optimalTP2ClosePct,
        tp3ClosePct: 100 - optimalTP1ClosePct - optimalTP2ClosePct,
        calculatedSLPercent: (((settings?.maxLossPerTrade || 0.25) / (0.8 * effectiveLeverage)) * 100).toFixed(2),
        expectedWinRate: stats.bestMarginWinRate,
        reasoning: `Math R:R ${bestTP1RR.toFixed(1)} = ${stats.bestTP1RRWinRate.toFixed(0)}% win rate. ${optimalTPLevels === 1 ? 'Full close' : `${optimalTPLevels} TP levels`}.`,
      });
    });

    return presets;
  };

  const presets = calculateIntelligentPresets(accountBalance, tradingStats, currentSettings);

  const applyPreset = (preset: any) => {
    onMarginChange(preset.margin);
    onLeverageChange(preset.leverage);
    onMaxLossChange(preset.maxLoss);
    onTP1RRChange(preset.tp1RR);
    if (preset.tp2RR) onTP2RRChange(preset.tp2RR);
    if (preset.tp3RR) onTP3RRChange(preset.tp3RR);
    if (preset.tpLevels && onTPLevelsChange) onTPLevelsChange(preset.tpLevels);
    if (preset.tp1ClosePct !== undefined && onTP1ClosePctChange) onTP1ClosePctChange(preset.tp1ClosePct);
    if (preset.tp2ClosePct !== undefined && onTP2ClosePctChange) onTP2ClosePctChange(preset.tp2ClosePct);
    if (preset.tp3ClosePct !== undefined && onTP3ClosePctChange) onTP3ClosePctChange(preset.tp3ClosePct);
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
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <BarChart3 className="w-5 h-5 text-primary" />
                  <h4 className="font-semibold">📊 TWOJE STATYSTYKI TRADINGU ({tradingStats.totalTrades} tradeów)</h4>
                </div>
                {onRefreshStats && (
                  <Button 
                    variant="outline" 
                    size="sm"
                    onClick={onRefreshStats}
                    disabled={isRefreshingStats}
                  >
                    <RefreshCw className={`w-4 h-4 mr-2 ${isRefreshingStats ? 'animate-spin' : ''}`} />
                    Odśwież
                  </Button>
                )}
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
          <h3 className="font-semibold text-lg">🎯 INTELIGENTNE PRESETY (per Kategoria Symboli)</h3>
          <div className="grid gap-4">
            {Object.entries(presets).map(([key, preset]: [string, any]) => {
              const Icon = preset.icon;
              const capitalUsed = ((preset.margin / accountBalance) * 100).toFixed(2);
              
              return (
                <div key={key} className="p-4 border rounded-lg hover:border-primary/50 transition-colors">
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2 flex-1">
                      <Icon className="w-5 h-5 text-primary" />
                      <div className="flex-1">
                        <div className="font-semibold">{preset.name}</div>
                        <div className="text-sm text-muted-foreground">{preset.description}</div>
                        {preset.leverageWarning && (
                          <div className="text-xs text-orange-600 mt-1">{preset.leverageWarning}</div>
                        )}
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
                  
                  <div className="grid grid-cols-2 gap-3 text-sm mb-3">
                    <div className="p-2 bg-muted/30 rounded">
                      <div className="text-xs text-muted-foreground mb-1">💰 Money Management</div>
                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Margin:</span>
                          <span className="font-semibold">{preset.margin.toFixed(2)} USDT</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Leverage:</span>
                          <span className="font-semibold">{preset.leverage}x</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Max Loss:</span>
                          <span className="font-semibold">{preset.maxLoss.toFixed(2)} USDT</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">% kapitału:</span>
                          <span className="font-semibold">{capitalUsed}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Calc. SL:</span>
                          <span className="font-semibold">~{preset.calculatedSLPercent}%</span>
                        </div>
                      </div>
                    </div>
                    
                    <div className="p-2 bg-muted/30 rounded">
                      <div className="text-xs text-muted-foreground mb-1">🎯 Quick Summary</div>
                      <div className="space-y-1">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">TP Levels:</span>
                          <span className="font-semibold">{preset.tpLevels}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Real R:R:</span>
                          <span className={cn(
                            "font-semibold",
                            preset.tp1RealRR >= 1.0 ? "text-green-600" : "text-red-600"
                          )}>
                            {preset.tp1RealRR.toFixed(2)}:1 {preset.tp1RealRR < 1.0 && '⚠️'}
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Fee Impact:</span>
                          <span className={cn(
                            "font-semibold text-xs",
                            preset.feeImpactPercent > 50 ? "text-red-600" : 
                            preset.feeImpactPercent > 25 ? "text-orange-600" : "text-green-600"
                          )}>
                            {preset.feeImpactPercent.toFixed(0)}% loss
                          </span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Expected WR:</span>
                          <span className="font-semibold">{preset.expectedWinRate.toFixed(0)}%</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">Symbole:</span>
                          <span className="font-semibold text-xs">{preset.supportedSymbols}</span>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* TP Breakdown Table */}
                  {preset.tpBreakdown && preset.tpBreakdown.length > 0 && (
                    <div className="mt-3 mb-3">
                      <div className="text-xs text-muted-foreground mb-2">📈 TP Breakdown:</div>
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead className="text-xs">Level</TableHead>
                            <TableHead className="text-xs">Math R:R</TableHead>
                            <TableHead className="text-xs">Real R:R</TableHead>
                            <TableHead className="text-xs">Close %</TableHead>
                            <TableHead className="text-xs">Net Profit</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {preset.tpBreakdown.map((tp: any) => (
                            <TableRow key={tp.level}>
                              <TableCell className="font-medium text-xs">TP{tp.level}</TableCell>
                              <TableCell className="text-xs">{tp.mathRR.toFixed(1)}:1</TableCell>
                              <TableCell className={cn(
                                "text-xs font-semibold",
                                tp.realRR >= 1.0 ? "text-green-600" : "text-red-600"
                              )}>
                                {tp.realRR.toFixed(2)}:1 {tp.realRR < 1.0 && '⚠️'}
                              </TableCell>
                              <TableCell className="text-xs">{tp.closePct}%</TableCell>
                              <TableCell className={cn(
                                "text-xs font-semibold",
                                tp.netProfit >= 0 ? "text-green-600" : "text-red-600"
                              )}>
                                {tp.netProfit >= 0 ? '+' : ''}{tp.netProfit.toFixed(3)} USDT
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                      {preset.totalExpectedProfit !== undefined && (
                        <div className="text-xs mt-2 p-2 bg-primary/5 rounded">
                          <span className="text-muted-foreground">💵 Expected Total Profit (all TPs): </span>
                          <span className={cn(
                            "font-semibold",
                            preset.totalExpectedProfit >= 0 ? "text-green-600" : "text-red-600"
                          )}>
                            {preset.totalExpectedProfit >= 0 ? '+' : ''}{preset.totalExpectedProfit.toFixed(3)} USDT
                          </span>
                        </div>
                      )}
                    </div>
                  )}
                  
                  {/* Warning if Real R:R < 1.0 */}
                  {!preset.isRRHealthy && (
                    <Alert variant="destructive" className="mt-3 mb-2">
                      <AlertTriangle className="h-4 w-4" />
                      <AlertDescription className="text-sm">
                        {preset.autoAdjusted 
                          ? `✅ Auto-skorygowany: Math R:R podniesione do ${preset.tp1RR.toFixed(1)} dla Real R:R ≥ 1.0`
                          : `Real R:R tylko ${preset.tp1RealRR.toFixed(2)}:1 po fees! Zwiększ TP R:R.`
                        }
                      </AlertDescription>
                    </Alert>
                  )}
                  
                  <div className="text-xs p-2 bg-muted/30 rounded">
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
          
          {/* Row 1: Basic params */}
          <div className="grid grid-cols-4 gap-4">
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
              <Label>TP Levels (1-3)</Label>
              <Input
                type="number"
                value={tpLevels}
                onChange={(e) => onTPLevelsChange?.(Math.min(3, Math.max(1, parseInt(e.target.value) || 1)))}
                min="1"
                max="3"
              />
            </div>
          </div>
          
          {/* Row 2: TP R:R Ratios (dynamic) */}
          <div className={cn(
            "grid gap-4",
            tpLevels === 1 ? "grid-cols-1" : tpLevels === 2 ? "grid-cols-2" : "grid-cols-3"
          )}>
            <div className="space-y-2">
              <Label>TP1 R:R Ratio</Label>
              <Input
                type="number"
                value={tp1RrRatio}
                onChange={(e) => onTP1RRChange(parseFloat(e.target.value) || 1.5)}
                step="0.1"
              />
            </div>
            {tpLevels >= 2 && (
              <div className="space-y-2">
                <Label>TP2 R:R Ratio</Label>
                <Input
                  type="number"
                  value={tp2RrRatio}
                  onChange={(e) => onTP2RRChange(parseFloat(e.target.value) || 2.5)}
                  step="0.1"
                />
              </div>
            )}
            {tpLevels >= 3 && (
              <div className="space-y-2">
                <Label>TP3 R:R Ratio</Label>
                <Input
                  type="number"
                  value={tp3RrRatio}
                  onChange={(e) => onTP3RRChange(parseFloat(e.target.value) || 3.5)}
                  step="0.1"
                />
              </div>
            )}
          </div>
          
          {/* Row 3: TP Close % (when tpLevels > 1) */}
          {tpLevels > 1 && (
            <div className={cn(
              "grid gap-4",
              tpLevels === 2 ? "grid-cols-2" : "grid-cols-3"
            )}>
              <div className="space-y-2">
                <Label>TP1 Close %</Label>
                <Input
                  type="number"
                  value={tp1ClosePct ?? 50}
                  onChange={(e) => onTP1ClosePctChange?.(parseFloat(e.target.value) || 50)}
                  step="5"
                  min="0"
                  max="100"
                />
              </div>
              {tpLevels >= 2 && (
                <div className="space-y-2">
                  <Label>TP2 Close %</Label>
                  <Input
                    type="number"
                    value={tp2ClosePct ?? 30}
                    onChange={(e) => onTP2ClosePctChange?.(parseFloat(e.target.value) || 30)}
                    step="5"
                    min="0"
                    max="100"
                  />
                </div>
              )}
              {tpLevels >= 3 && (
                <div className="space-y-2">
                  <Label>TP3 Close %</Label>
                  <Input
                    type="number"
                    value={tp3ClosePct ?? 20}
                    onChange={(e) => onTP3ClosePctChange?.(parseFloat(e.target.value) || 20)}
                    step="5"
                    min="0"
                    max="100"
                  />
                  <p className="text-xs text-muted-foreground">
                    Pozostałe: {100 - (tp1ClosePct ?? 50) - (tp2ClosePct ?? 30)}%
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
        
        <Separator />
        
        {/* Advanced Parameters (Collapsible) */}
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:underline w-full">
            <ChevronRight className="h-4 w-4" />
            ⚙️ Zaawansowane parametry (opcjonalne)
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              
              <div className="space-y-2">
                <Label>Entry Price (opcjonalnie)</Label>
                <Input
                  type="number"
                  placeholder="np. 95000"
                  value={entryPrice || ''}
                  onChange={(e) => onEntryPriceChange?.(e.target.value ? parseFloat(e.target.value) : undefined)}
                />
                <p className="text-xs text-muted-foreground">
                  Konkretna cena wejścia
                </p>
              </div>
              
              <div className="space-y-2">
                <Label>SL % (bezpośrednio)</Label>
                <Input
                  type="number"
                  placeholder="np. 0.5"
                  step="0.1"
                  value={slPercent || ''}
                  onChange={(e) => onSlPercentChange?.(e.target.value ? parseFloat(e.target.value) : undefined)}
                />
                <p className="text-xs text-muted-foreground">
                  Nadpisuje kalkulację z Max Loss
                </p>
              </div>
              
              <div className="space-y-2">
                <Label>Taker Fee %</Label>
                <Input
                  type="number"
                  value={takerFeeRate}
                  onChange={(e) => onTakerFeeRateChange?.(parseFloat(e.target.value) || 0.06)}
                  step="0.01"
                />
                <p className="text-xs text-muted-foreground">
                  Bitget default: 0.06%
                </p>
              </div>
              
              <div className="space-y-2">
                <Label>Kategoria symbolu</Label>
                <Select value={symbolCategory} onValueChange={onSymbolCategoryChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Wybierz kategorię" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="BTC_ETH">BTC/ETH (max 150x)</SelectItem>
                    <SelectItem value="MAJOR">Major - SOL, XRP, BNB (max 100x)</SelectItem>
                    <SelectItem value="ALTCOIN">Altcoiny (max 75x)</SelectItem>
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">
                  Wpływa na max leverage i presety
                </p>
              </div>
              
              <div className="space-y-2">
                <Label>ATR Value (opcjonalnie)</Label>
                <Input
                  type="number"
                  placeholder="np. 1500"
                  value={atrValue || ''}
                  onChange={(e) => onAtrValueChange?.(e.target.value ? parseFloat(e.target.value) : undefined)}
                />
                <p className="text-xs text-muted-foreground">
                  Dla symulacji z ATR-based
                </p>
              </div>
              
            </div>
          </CollapsibleContent>
        </Collapsible>
        
        <Separator />
        
        {/* Trade Series Simulation (Collapsible) */}
        <Collapsible>
          <CollapsibleTrigger className="flex items-center gap-2 text-sm font-medium hover:underline w-full">
            <ChevronRight className="h-4 w-4" />
            📊 Symulacja serii trade'ów (opcjonalne)
          </CollapsibleTrigger>
          <CollapsibleContent className="pt-4 space-y-4">
            
            <div className="grid grid-cols-3 gap-4">
              <div className="space-y-2">
                <Label>Liczba wygranych</Label>
                <Input
                  type="number"
                  value={seriesWins}
                  onChange={(e) => onSeriesWinsChange?.(parseInt(e.target.value) || 0)}
                  min={0}
                />
              </div>
              <div className="space-y-2">
                <Label>Liczba przegranych</Label>
                <Input
                  type="number"
                  value={seriesLosses}
                  onChange={(e) => onSeriesLossesChange?.(parseInt(e.target.value) || 0)}
                  min={0}
                />
              </div>
              <div className="space-y-2">
                <Label>Win Rate</Label>
                <div className="h-10 flex items-center text-lg font-semibold">
                  {winRate.toFixed(1)}%
                </div>
              </div>
            </div>
            
            <div className="p-4 bg-muted/50 rounded-lg space-y-2">
              <div className="flex justify-between">
                <span>Łączny PnL po {totalTrades} tradeach:</span>
                <span className={cn(
                  "font-semibold",
                  totalPnL >= 0 ? "text-green-600" : "text-red-600"
                )}>
                  {totalPnL >= 0 ? '+' : ''}{totalPnL.toFixed(2)} USDT
                </span>
              </div>
              <div className="flex justify-between">
                <span>Oczekiwany zwrot na trade:</span>
                <span className={cn(
                  expectedPerTrade >= 0 ? "text-green-600" : "text-red-600"
                )}>
                  {expectedPerTrade >= 0 ? '+' : ''}{expectedPerTrade.toFixed(3)} USDT
                </span>
              </div>
              <div className="flex justify-between">
                <span>Max Drawdown (worst case):</span>
                <span className="text-red-600">-{maxDrawdown.toFixed(2)} USDT</span>
              </div>
            </div>
            
          </CollapsibleContent>
        </Collapsible>

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
                <TableHead>Close %</TableHead>
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
                  <TableCell>{sim.closePct}%</TableCell>
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
              {tpLevels > 1 && (() => {
                const totalGrossProfit = rrSimulation.reduce((sum, sim) => sum + sim.grossProfit, 0);
                const totalNetProfit = rrSimulation.reduce((sum, sim) => sum + sim.netProfit, 0);
                const totalClosePct = rrSimulation.reduce((sum, sim) => sum + sim.closePct, 0);
                const combinedRealRR = totalNetProfit / calculations.realMaxLoss;
                
                return (
                  <TableRow className="font-semibold bg-muted/30 border-t-2">
                    <TableCell>SUMA</TableCell>
                    <TableCell className={totalClosePct !== 100 ? "text-destructive" : ""}>
                      {totalClosePct}%
                    </TableCell>
                    <TableCell>-</TableCell>
                    <TableCell>+{totalGrossProfit.toFixed(2)}</TableCell>
                    <TableCell className={totalNetProfit >= 0 ? "text-green-600" : "text-red-600"}>
                      {totalNetProfit >= 0 ? '+' : ''}{totalNetProfit.toFixed(2)}
                    </TableCell>
                    <TableCell className={combinedRealRR >= 1 ? "" : "text-red-600"}>
                      {combinedRealRR.toFixed(2)}:1
                    </TableCell>
                  </TableRow>
                );
              })()}
            </TableBody>
          </Table>

          {/* Close % validation warning */}
          {tpLevels > 1 && (() => {
            const totalClosePct = rrSimulation.reduce((sum, sim) => sum + sim.closePct, 0);
            return totalClosePct !== 100 && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  <strong>Błąd Close %!</strong> Suma Close % = {totalClosePct}%. Powinno być dokładnie 100%!
                </AlertDescription>
              </Alert>
            );
          })()}

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
