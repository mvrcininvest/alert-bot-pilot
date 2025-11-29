import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { useState, useEffect } from "react";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { FeeCalculator } from "@/components/settings/FeeCalculator";

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [localSettings, setLocalSettings] = useState<any>(null);
  const [newSymbolLeverage, setNewSymbolLeverage] = useState<string>("");
  const [leverageSource, setLeverageSource] = useState<"alert" | "global_max" | "custom">("alert");

  const { data: settings, isLoading, error } = useQuery({
    queryKey: ["settings"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("settings")
        .select("*")
        .limit(1);
      
      if (error) throw error;
      
      // If no settings exist, create default settings
      if (!data || data.length === 0) {
        const { data: newSettings, error: insertError } = await supabase
          .from("settings")
          .insert({
            bot_active: true,
            position_size_value: 100,
            position_sizing_type: 'fixed_usdt',
            calculator_type: 'simple_percent',
            sl_method: 'percent_entry',
            simple_sl_percent: 1.5,
            simple_tp_percent: 3.0,
            rr_ratio: 2.0,
            tp_strategy: 'partial_close',
            tp_levels: 1,
            tp1_close_percent: 100,
            max_open_positions: 3,
            daily_loss_limit: 500,
            filter_by_tier: false,
            allowed_tiers: ['Premium'],
            sl_to_breakeven: true,
            breakeven_trigger_tp: 1,
            trailing_stop: false,
            auto_repair: true,
            monitor_interval_seconds: 60,
          })
          .select()
          .limit(1);
        
        if (insertError) throw insertError;
        return newSettings?.[0];
      }
      
      return data[0];
    },
  });

  useEffect(() => {
    if (settings) {
      console.log("Ładowanie ustawień do lokalnego stanu:", settings);
      setLocalSettings(settings);
      
      // Determine leverage source from settings
      if (settings.use_alert_leverage !== false) {
        setLeverageSource("alert");
      } else if (settings.use_max_leverage_global) {
        setLeverageSource("global_max");
      } else {
        setLeverageSource("custom");
      }
    }
  }, [settings]);

  const updateSettings = useMutation({
    mutationFn: async (updates: any) => {
      const { error } = await supabase
        .from("settings")
        .update(updates)
        .eq("id", settings?.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["settings"] });
      toast({ title: "Zapisano", description: "Ustawienia zostały zaktualizowane" });
    },
    onError: () => {
      toast({ title: "Błąd", description: "Nie udało się zapisać ustawień", variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (localSettings) {
      // Validation for scalping mode with fees
      if (localSettings.position_sizing_type === "scalping_mode" && 
          localSettings.include_fees_in_calculations) {
        const margin = localSettings.max_margin_per_trade ?? 2;
        const loss = localSettings.max_loss_per_trade ?? 1;
        const leverage = localSettings.default_leverage ?? 10;
        const takerFeeRate = (localSettings.taker_fee_rate ?? 0.06) / 100;
        const tp1RrRatio = localSettings.tp1_rr_ratio ?? 1.5;
        
        // Calculate SL%
        const slMin = (localSettings.sl_percent_min ?? 0.3) / 100;
        const slMax = (localSettings.sl_percent_max ?? 2.0) / 100;
        let slPercent = loss / (margin * leverage);
        if (slPercent < slMin) slPercent = slMin;
        else if (slPercent > slMax) slPercent = slMax;
        
        // Calculate fees and real R:R
        const notional = margin * leverage;
        const roundTripFees = notional * takerFeeRate * 2;
        const realMaxLoss = loss + roundTripFees;
        const tp1Percent = slPercent * tp1RrRatio;
        const grossProfit = notional * tp1Percent;
        const netProfit = grossProfit - roundTripFees;
        const realRR = netProfit / realMaxLoss;
        
        if (realRR < 1) {
          toast({
            title: "⚠️ Ostrzeżenie: Niskie Real R:R",
            description: `TP1 Real R:R = ${realRR.toFixed(2)}:1. Zysk z TP1 nie pokryje straty! Zwiększ R:R ratio lub margin.`,
            variant: "destructive",
          });
        }
      }
      
      console.log("Zapisywanie ustawień:", localSettings);
      updateSettings.mutate(localSettings);
    }
  };

  const updateLocal = (key: string, value: any) => {
    setLocalSettings((prev: any) => ({ ...prev, [key]: value }));
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Ładowanie ustawień...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-destructive">Błąd ładowania ustawień: {error.message}</div>
      </div>
    );
  }

  if (!localSettings) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Inicjalizacja ustawień...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Ustawienia Bota</h1>
          <p className="text-muted-foreground">Konfiguracja zaawansowanych parametrów tradingowych</p>
        </div>
        <Button onClick={handleSave}>Zapisz Zmiany</Button>
      </div>

      <Tabs defaultValue="general" className="space-y-6">
        <TabsList className={`grid w-full ${localSettings.position_sizing_type === "scalping_mode" ? "grid-cols-5" : "grid-cols-6"}`}>
          <TabsTrigger value="general">Ogólne</TabsTrigger>
          <TabsTrigger value="position">Pozycje</TabsTrigger>
          {localSettings.position_sizing_type !== "scalping_mode" && (
            <TabsTrigger value="sltp">SL/TP</TabsTrigger>
          )}
          <TabsTrigger value="adaptive">Adaptacyjne</TabsTrigger>
          <TabsTrigger value="risk">Risk Mgmt</TabsTrigger>
          <TabsTrigger value="monitor">Monitoring</TabsTrigger>
        </TabsList>

        {/* GENERAL TAB */}
        <TabsContent value="general" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Kontrola Bota</CardTitle>
              <CardDescription>Podstawowe ustawienia działania bota</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Bot Aktywny</Label>
                  <div className="text-sm text-muted-foreground">
                    Włącz/wyłącz automatyczne otwieranie pozycji
                  </div>
                </div>
                <Switch
                  checked={localSettings.bot_active}
                  onCheckedChange={(checked) => updateLocal("bot_active", checked)}
                />
              </div>
              
              <Separator />
              
              <div className="space-y-2">
                <Label>Nazwa Profilu</Label>
                <Input
                  value={localSettings.profile_name || ""}
                  onChange={(e) => updateLocal("profile_name", e.target.value)}
                  placeholder="Default"
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Obecne Ustawienia Bota</CardTitle>
              <CardDescription>Kompletne podsumowanie aktywnej konfiguracji</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {/* PODSTAWOWE */}
              <div>
                <h3 className="font-semibold mb-3">Podstawowe</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Nazwa profilu</div>
                    <div className="font-medium">{localSettings.profile_name || "Default"}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Bot aktywny</div>
                    <div className="font-medium">{localSettings.bot_active ? "✓ TAK" : "✗ NIE"}</div>
                  </div>
                </div>
              </div>

              <Separator />

              {/* POZYCJE */}
              <div>
                <h3 className="font-semibold mb-3">Wielkość Pozycji</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Metoda</div>
                    <div className="font-medium">
                      {localSettings.position_sizing_type === "fixed_usdt" 
                        ? "Stała kwota USDT" 
                        : localSettings.position_sizing_type === "scalping_mode"
                        ? "🎯 Scalping Mode"
                        : "% kapitału"}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Wartość</div>
                    <div className="font-medium">
                      {localSettings.position_sizing_type === "scalping_mode" 
                        ? `Max ${localSettings.max_margin_per_trade ?? 2} USDT margin / ${localSettings.max_loss_per_trade ?? 1} USDT loss`
                        : `${localSettings.position_size_value} ${localSettings.position_sizing_type === "fixed_usdt" ? "USDT (notional)" : "%"}`}
                    </div>
                    {localSettings.position_sizing_type === "fixed_usdt" && (
                      <div className="text-xs text-muted-foreground">
                        Margines = wartość ÷ dźwignia
                      </div>
                    )}
                    {localSettings.position_sizing_type === "scalping_mode" && (
                      <div className="text-xs text-muted-foreground">
                        SL range: {localSettings.sl_percent_min ?? 0.3}% - {localSettings.sl_percent_max ?? 2.0}%
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <Separator />

              {/* DŹWIGNIA */}
              <div>
                <h3 className="font-semibold mb-3">Dźwignia (Leverage)</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Źródło dźwigni</div>
                    <div className="font-medium">
                      {localSettings.use_alert_leverage !== false 
                        ? "Z alertu TradingView" 
                        : localSettings.use_max_leverage_global 
                        ? "MAX dla wszystkich" 
                        : `Własna (${localSettings.default_leverage || 10}x)`}
                    </div>
                  </div>
                </div>
                {localSettings.symbol_leverage_overrides && 
                  Object.keys(localSettings.symbol_leverage_overrides).length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs text-muted-foreground mb-2">Wyjątki dla symboli:</div>
                    <div className="flex flex-wrap gap-2">
                      {Object.entries(localSettings.symbol_leverage_overrides).map(([symbol, leverage]: [string, any]) => (
                        <Badge key={symbol} variant="outline">
                          {symbol}: {leverage}x
                        </Badge>
                      ))}
                    </div>
                  </div>
                )}
              </div>

              <Separator />

              {/* KALKULATOR SL/TP */}
              {localSettings.position_sizing_type !== "scalping_mode" ? (
                <div>
                  <h3 className="font-semibold mb-3">Kalkulator SL/TP</h3>
                  <div className="grid grid-cols-2 gap-3 text-sm">
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Typ kalkulatora</div>
                      <div className="font-medium">
                        {localSettings.calculator_type === "simple_percent" && "Prosty (%)"}
                        {localSettings.calculator_type === "risk_reward" && "Risk:Reward"}
                        {localSettings.calculator_type === "atr_based" && "ATR-based"}
                      </div>
                    </div>
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Liczba poziomów TP</div>
                      <div className="font-medium">{localSettings.tp_levels || 1}</div>
                    </div>
                  </div>

                  {/* Simple Percent */}
                  {localSettings.calculator_type === "simple_percent" && (
                    <div className="mt-3 p-3 bg-muted/30 rounded-lg">
                      <div className="text-xs font-medium mb-2">Prosty (%)</div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">SL %</div>
                          <div className="font-medium">{localSettings.simple_sl_percent || 1.5}%</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">TP1 %</div>
                          <div className="font-medium">{localSettings.simple_tp_percent || 3}%</div>
                        </div>
                        {localSettings.tp_levels >= 2 && (
                          <div>
                            <div className="text-xs text-muted-foreground">TP2 %</div>
                            <div className="font-medium">{localSettings.simple_tp2_percent || (localSettings.simple_tp_percent * 1.5)}%</div>
                          </div>
                        )}
                        {localSettings.tp_levels >= 3 && (
                          <div>
                            <div className="text-xs text-muted-foreground">TP3 %</div>
                            <div className="font-medium">{localSettings.simple_tp3_percent || (localSettings.simple_tp_percent * 2)}%</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* Risk Reward */}
                  {localSettings.calculator_type === "risk_reward" && (
                    <div className="mt-3 p-3 bg-muted/30 rounded-lg">
                      <div className="text-xs font-medium mb-2">Risk:Reward</div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">SL % margin</div>
                          <div className="font-medium">{localSettings.rr_sl_percent_margin || 2}%</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">Adaptive R:R</div>
                          <div className="font-medium">{localSettings.rr_adaptive ? "✓" : "✗"}</div>
                        </div>
                        {localSettings.rr_adaptive && (
                          <>
                            <div>
                              <div className="text-xs text-muted-foreground">Słaby R:R</div>
                              <div className="font-medium">{localSettings.adaptive_rr_weak_signal || 1.5}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Standard R:R</div>
                              <div className="font-medium">{localSettings.adaptive_rr_standard || 2.0}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Silny R:R</div>
                              <div className="font-medium">{localSettings.adaptive_rr_strong || 2.5}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">Bardzo silny R:R</div>
                              <div className="font-medium">{localSettings.adaptive_rr_very_strong || 3.0}</div>
                            </div>
                          </>
                        )}
                        <div>
                          <div className="text-xs text-muted-foreground">TP1 R:R</div>
                          <div className="font-medium">{localSettings.tp1_rr_ratio || 1.5}</div>
                        </div>
                        {localSettings.tp_levels >= 2 && (
                          <div>
                            <div className="text-xs text-muted-foreground">TP2 R:R</div>
                            <div className="font-medium">{localSettings.tp2_rr_ratio || 2.5}</div>
                          </div>
                        )}
                        {localSettings.tp_levels >= 3 && (
                          <div>
                            <div className="text-xs text-muted-foreground">TP3 R:R</div>
                            <div className="font-medium">{localSettings.tp3_rr_ratio || 3.5}</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ATR Based */}
                  {localSettings.calculator_type === "atr_based" && (
                    <div className="mt-3 p-3 bg-muted/30 rounded-lg">
                      <div className="text-xs font-medium mb-2">ATR-based</div>
                      <div className="grid grid-cols-2 gap-3 text-sm">
                        <div>
                          <div className="text-xs text-muted-foreground">SL multiplier</div>
                          <div className="font-medium">{localSettings.atr_sl_multiplier || 1.5}x</div>
                        </div>
                        <div>
                          <div className="text-xs text-muted-foreground">TP1 multiplier</div>
                          <div className="font-medium">{localSettings.atr_tp_multiplier || 3}x</div>
                        </div>
                        {localSettings.tp_levels >= 2 && (
                          <div>
                            <div className="text-xs text-muted-foreground">TP2 multiplier</div>
                            <div className="font-medium">{localSettings.atr_tp2_multiplier || (localSettings.atr_tp_multiplier * 1.5)}x</div>
                          </div>
                        )}
                        {localSettings.tp_levels >= 3 && (
                          <div>
                            <div className="text-xs text-muted-foreground">TP3 multiplier</div>
                            <div className="font-medium">{localSettings.atr_tp3_multiplier || (localSettings.atr_tp_multiplier * 2)}x</div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}

                  {/* % zamknięcia pozycji */}
                  <div className="mt-3 p-3 bg-muted/30 rounded-lg">
                    <div className="text-xs font-medium mb-2">% zamknięcia pozycji</div>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">TP1</div>
                        <div className="font-medium">{localSettings.tp1_close_percent || 100}%</div>
                      </div>
                      {localSettings.tp_levels >= 2 && (
                        <div>
                          <div className="text-xs text-muted-foreground">TP2</div>
                          <div className="font-medium">{localSettings.tp2_close_percent || 0}%</div>
                        </div>
                      )}
                      {localSettings.tp_levels >= 3 && (
                        <div>
                          <div className="text-xs text-muted-foreground">TP3</div>
                          <div className="font-medium">{localSettings.tp3_close_percent || 0}%</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <div>
                  <h3 className="font-semibold mb-3">🎯 Scalping Mode - SL/TP</h3>
                  <div className="p-3 bg-primary/10 rounded-lg">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Algorytm SL</div>
                        <div className="font-medium">
                          SL% = {localSettings.max_loss_per_trade} / ({localSettings.max_margin_per_trade} × leverage)
                        </div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Zakres SL%</div>
                        <div className="font-medium">{localSettings.sl_percent_min}% - {localSettings.sl_percent_max}%</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">TP1 R:R</div>
                        <div className="font-medium">{localSettings.tp1_rr_ratio} (distance = SL × {localSettings.tp1_rr_ratio})</div>
                      </div>
                      {localSettings.tp_levels >= 2 && (
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">TP2 R:R</div>
                          <div className="font-medium">{localSettings.tp2_rr_ratio} (distance = SL × {localSettings.tp2_rr_ratio})</div>
                        </div>
                      )}
                      {localSettings.tp_levels >= 3 && (
                        <div className="space-y-1">
                          <div className="text-xs text-muted-foreground">TP3 R:R</div>
                          <div className="font-medium">{localSettings.tp3_rr_ratio} (distance = SL × {localSettings.tp3_rr_ratio})</div>
                        </div>
                      )}
                    </div>
                    
                    {/* Live calculation example */}
                    <div className="mt-3 pt-3 border-t border-border/50 text-xs">
                      <div className="font-medium mb-2">Przykład dla 75x leverage:</div>
                      <div className="grid grid-cols-4 gap-2">
                        <div>
                          <div className="text-muted-foreground">SL%:</div>
                          <div className="font-medium">{((localSettings.max_loss_per_trade / (localSettings.max_margin_per_trade * 75)) * 100).toFixed(2)}%</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">Loss:</div>
                          <div className="font-medium">{localSettings.max_loss_per_trade} USDT</div>
                        </div>
                        <div>
                          <div className="text-muted-foreground">TP1%:</div>
                          <div className="font-medium">{((localSettings.max_loss_per_trade / (localSettings.max_margin_per_trade * 75)) * 100 * localSettings.tp1_rr_ratio).toFixed(2)}%</div>
                        </div>
                        {localSettings.tp_levels >= 2 && (
                          <div>
                            <div className="text-muted-foreground">TP2%:</div>
                            <div className="font-medium">{((localSettings.max_loss_per_trade / (localSettings.max_margin_per_trade * 75)) * 100 * localSettings.tp2_rr_ratio).toFixed(2)}%</div>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                  
                  <Badge variant="outline" className="mt-2">
                    ⚠️ Standardowy kalkulator (Risk:Reward, SL% margin) jest ignorowany
                  </Badge>

                  {/* % zamknięcia pozycji */}
                  <div className="mt-3 p-3 bg-muted/30 rounded-lg">
                    <div className="text-xs font-medium mb-2">% zamknięcia pozycji</div>
                    <div className="grid grid-cols-3 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">TP1</div>
                        <div className="font-medium">{localSettings.tp1_close_percent || 100}%</div>
                      </div>
                      {localSettings.tp_levels >= 2 && (
                        <div>
                          <div className="text-xs text-muted-foreground">TP2</div>
                          <div className="font-medium">{localSettings.tp2_close_percent || 0}%</div>
                        </div>
                      )}
                      {localSettings.tp_levels >= 3 && (
                        <div>
                          <div className="text-xs text-muted-foreground">TP3</div>
                          <div className="font-medium">{localSettings.tp3_close_percent || 0}%</div>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <Separator />

              {/* ZARZĄDZANIE SL */}
              <div>
                <h3 className="font-semibold mb-3">Zarządzanie Stop Loss</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Strategia</div>
                    <div className="font-medium">
                      {localSettings.trailing_stop ? "Trailing Stop" : 
                       localSettings.sl_to_breakeven ? "Breakeven" : "Brak"}
                    </div>
                  </div>
                  {localSettings.sl_to_breakeven && (
                    <div className="space-y-1">
                      <div className="text-xs text-muted-foreground">Breakeven po TP</div>
                      <div className="font-medium">TP{localSettings.breakeven_trigger_tp || 1}</div>
                    </div>
                  )}
                  {localSettings.trailing_stop && (
                    <>
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Trailing start po TP</div>
                        <div className="font-medium">TP{localSettings.trailing_stop_trigger_tp || 1}</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Trailing odległość</div>
                        <div className="font-medium">{localSettings.trailing_stop_distance || 1}%</div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <Separator />

              {/* ADAPTACYJNE */}
              <div>
                <h3 className="font-semibold mb-3">Ustawienia Adaptacyjne</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Adaptive TP Spacing</div>
                    <div className="font-medium">{localSettings.adaptive_tp_spacing ? "✓" : "✗"}</div>
                  </div>
                  {localSettings.adaptive_tp_spacing && (
                    <>
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Wysoka zmienność</div>
                        <div className="font-medium">{localSettings.adaptive_tp_high_volatility_multiplier || 1.3}x</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Niska zmienność</div>
                        <div className="font-medium">{localSettings.adaptive_tp_low_volatility_multiplier || 0.9}x</div>
                      </div>
                    </>
                  )}
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Momentum-based TP</div>
                    <div className="font-medium">{localSettings.momentum_based_tp ? "✓" : "✗"}</div>
                  </div>
                  {localSettings.momentum_based_tp && (
                    <>
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Słaby momentum</div>
                        <div className="font-medium">{localSettings.momentum_weak_multiplier || 0.9}x</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Umiarkowany</div>
                        <div className="font-medium">{localSettings.momentum_moderate_multiplier || 1.1}x</div>
                      </div>
                      <div className="space-y-1">
                        <div className="text-xs text-muted-foreground">Silny momentum</div>
                        <div className="font-medium">{localSettings.momentum_strong_multiplier || 1.3}x</div>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <Separator />

              {/* RISK MANAGEMENT */}
              <div>
                <h3 className="font-semibold mb-3">Risk Management</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Max otwartych pozycji</div>
                    <div className="font-medium">{localSettings.max_open_positions || 3}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Typ limitu straty</div>
                    <div className="font-medium">
                      {localSettings.loss_limit_type === "percent_drawdown" ? "% Drawdown" : "Stała kwota"}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Dzienny limit straty</div>
                    <div className="font-medium">
                      {localSettings.loss_limit_type === "percent_drawdown" 
                        ? `${localSettings.daily_loss_percent || 5}%` 
                        : `${localSettings.daily_loss_limit || 500} USDT`}
                    </div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Filtrowanie po tier</div>
                    <div className="font-medium">{localSettings.filter_by_tier ? "✓ Włączone" : "✗ Wyłączone"}</div>
                  </div>
                  {localSettings.filter_by_tier && localSettings.excluded_tiers && localSettings.excluded_tiers.length > 0 && (
                    <div className="col-span-2">
                      <div className="text-xs text-muted-foreground mb-1">Wykluczone tier:</div>
                      <div className="flex flex-wrap gap-1">
                        {localSettings.excluded_tiers.map((tier: string) => (
                          <Badge key={tier} variant="destructive" className="text-xs">{tier}</Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>

              <Separator />

              {/* MONITORING */}
              <div>
                <h3 className="font-semibold mb-3">Monitoring</h3>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Auto-repair</div>
                    <div className="font-medium">{localSettings.auto_repair ? "✓ Włączony" : "✗ Wyłączony"}</div>
                  </div>
                  <div className="space-y-1">
                    <div className="text-xs text-muted-foreground">Interwał sprawdzania</div>
                    <div className="font-medium">{localSettings.monitor_interval_seconds || 60}s</div>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* POSITION SIZING TAB */}
        <TabsContent value="position" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Wielkość Pozycji</CardTitle>
              <CardDescription>Konfiguracja rozmiaru otwieranych pozycji</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Metoda Kalkulacji</Label>
                <Select
                  value={localSettings.position_sizing_type}
                  onValueChange={(value) => updateLocal("position_sizing_type", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed_usdt">Stała kwota USDT</SelectItem>
                    <SelectItem value="percent_capital">% kapitału</SelectItem>
                    <SelectItem value="scalping_mode">🎯 Scalping Mode</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {localSettings.position_sizing_type === "scalping_mode" ? (
                <>
                <Card className="border-2 border-primary/20 bg-primary/5">
                  <CardHeader>
                    <CardTitle className="text-lg">⚡ Scalping Mode Settings</CardTitle>
                    <CardDescription>
                      Automatyczne dostosowanie SL/TP z zachowaniem bezpiecznych zakresów
                    </CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label>Max Margin per Trade (USDT)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={localSettings.max_margin_per_trade ?? 2}
                          onChange={(e) => updateLocal("max_margin_per_trade", parseFloat(e.target.value))}
                        />
                        <p className="text-xs text-muted-foreground">
                          Maksymalny margines z konta na jedną pozycję
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label>Max Loss per Trade (USDT)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={localSettings.max_loss_per_trade ?? 1}
                          onChange={(e) => updateLocal("max_loss_per_trade", parseFloat(e.target.value))}
                        />
                        <p className="text-xs text-muted-foreground">
                          Maksymalna strata przy uderzeniu w SL
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label>Min SL% (bezpieczeństwo)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={localSettings.sl_percent_min ?? 0.3}
                          onChange={(e) => updateLocal("sl_percent_min", parseFloat(e.target.value))}
                        />
                        <p className="text-xs text-muted-foreground">
                          Jeśli SL% wyjdzie poniżej, margines zostanie zmniejszony
                        </p>
                      </div>

                      <div className="space-y-2">
                        <Label>Max SL% (limit)</Label>
                        <Input
                          type="number"
                          step="0.01"
                          value={localSettings.sl_percent_max ?? 2.0}
                          onChange={(e) => updateLocal("sl_percent_max", parseFloat(e.target.value))}
                        />
                        <p className="text-xs text-muted-foreground">
                          Jeśli SL% wyjdzie powyżej, loss zostanie ograniczony
                        </p>
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-3">
                      <div className="flex items-center justify-between">
                        <Label>Liczba poziomów TP</Label>
                        <Select
                          value={String(localSettings.tp_levels)}
                          onValueChange={(value) => updateLocal("tp_levels", parseInt(value))}
                        >
                          <SelectTrigger className="w-24">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="1">1 TP</SelectItem>
                            <SelectItem value="2">2 TP</SelectItem>
                            <SelectItem value="3">3 TP</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>

                      <div className="space-y-3">
                        <div className="grid grid-cols-2 gap-3">
                          <div className="space-y-2">
                            <Label>TP1 R:R Ratio</Label>
                            <Input
                              type="number"
                              step="0.1"
                              value={localSettings.tp1_rr_ratio ?? 1.5}
                              onChange={(e) => updateLocal("tp1_rr_ratio", parseFloat(e.target.value))}
                            />
                          </div>
                          <div className="space-y-2">
                            <Label>TP1 Close %</Label>
                            <Input
                              type="number"
                              value={localSettings.tp1_close_percent ?? 100}
                              onChange={(e) => updateLocal("tp1_close_percent", parseFloat(e.target.value))}
                            />
                          </div>
                        </div>

                        {localSettings.tp_levels >= 2 && (
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label>TP2 R:R Ratio</Label>
                              <Input
                                type="number"
                                step="0.1"
                                value={localSettings.tp2_rr_ratio ?? 2.5}
                                onChange={(e) => updateLocal("tp2_rr_ratio", parseFloat(e.target.value))}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>TP2 Close %</Label>
                              <Input
                                type="number"
                                value={localSettings.tp2_close_percent ?? 0}
                                onChange={(e) => updateLocal("tp2_close_percent", parseFloat(e.target.value))}
                              />
                            </div>
                          </div>
                        )}

                        {localSettings.tp_levels >= 3 && (
                          <div className="grid grid-cols-2 gap-3">
                            <div className="space-y-2">
                              <Label>TP3 R:R Ratio</Label>
                              <Input
                                type="number"
                                step="0.1"
                                value={localSettings.tp3_rr_ratio ?? 3.5}
                                onChange={(e) => updateLocal("tp3_rr_ratio", parseFloat(e.target.value))}
                              />
                            </div>
                            <div className="space-y-2">
                              <Label>TP3 Close %</Label>
                              <Input
                                type="number"
                                value={localSettings.tp3_close_percent ?? 0}
                                onChange={(e) => updateLocal("tp3_close_percent", parseFloat(e.target.value))}
                              />
                            </div>
                          </div>
                        )}
                      </div>
                    </div>

                    <Separator />

                    {/* EFFECTIVE RR CALCULATOR */}
                    <div className="p-4 bg-primary/5 border-2 border-primary/20 rounded-lg">
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-sm font-semibold">Effective Risk:Reward</Label>
                        <Badge variant="default" className="text-lg px-4 py-1">
                          {(() => {
                            const tp1Close = localSettings.tp1_close_percent ?? 100;
                            const tp2Close = localSettings.tp2_close_percent ?? 0;
                            const tp3Close = localSettings.tp3_close_percent ?? 0;
                            const tp1RR = localSettings.tp1_rr_ratio ?? 1.5;
                            const tp2RR = localSettings.tp2_rr_ratio ?? 2.5;
                            const tp3RR = localSettings.tp3_rr_ratio ?? 3.5;
                            
                            const effectiveRR = (
                              (tp1Close * tp1RR) +
                              (localSettings.tp_levels >= 2 ? tp2Close * tp2RR : 0) +
                              (localSettings.tp_levels >= 3 ? tp3Close * tp3RR : 0)
                            ) / 100;
                            
                            return `${effectiveRR.toFixed(2)}:1`;
                          })()}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Średni zysk ÷ strata przy wszystkich TP. Wyliczone na podstawie % zamknięcia i R:R każdego poziomu.
                      </p>
                      <div className="mt-3 space-y-1 text-xs">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">TP1: {localSettings.tp1_close_percent ?? 100}% × {localSettings.tp1_rr_ratio ?? 1.5} R:R</span>
                          <span className="font-medium">= {((localSettings.tp1_close_percent ?? 100) * (localSettings.tp1_rr_ratio ?? 1.5) / 100).toFixed(2)}R</span>
                        </div>
                        {localSettings.tp_levels >= 2 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">TP2: {localSettings.tp2_close_percent ?? 0}% × {localSettings.tp2_rr_ratio ?? 2.5} R:R</span>
                            <span className="font-medium">= {((localSettings.tp2_close_percent ?? 0) * (localSettings.tp2_rr_ratio ?? 2.5) / 100).toFixed(2)}R</span>
                          </div>
                        )}
                        {localSettings.tp_levels >= 3 && (
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">TP3: {localSettings.tp3_close_percent ?? 0}% × {localSettings.tp3_rr_ratio ?? 3.5} R:R</span>
                            <span className="font-medium">= {((localSettings.tp3_close_percent ?? 0) * (localSettings.tp3_rr_ratio ?? 3.5) / 100).toFixed(2)}R</span>
                          </div>
                        )}
                      </div>
                    </div>

                    <Separator />

                    <div className="space-y-2">
                      <Label className="text-sm font-semibold">Live Preview - SL & TP %</Label>
                      <div className="space-y-2 text-xs">
                        {[150, 75, 50].map((lev) => {
                          const margin = localSettings.max_margin_per_trade ?? 2;
                          const loss = localSettings.max_loss_per_trade ?? 1;
                          const slMin = (localSettings.sl_percent_min ?? 0.3) / 100;
                          const slMax = (localSettings.sl_percent_max ?? 2.0) / 100;
                          
                          let slPercent = loss / (margin * lev);
                          let adjustment = '';
                          
                          if (slPercent < slMin) {
                            adjustment = '(margin reduced)';
                            slPercent = slMin;
                          } else if (slPercent > slMax) {
                            adjustment = '(loss capped)';
                            slPercent = slMax;
                          }
                          
                          const tp1Percent = slPercent * (localSettings.tp1_rr_ratio ?? 1.5);
                          const tp2Percent = slPercent * (localSettings.tp2_rr_ratio ?? 2.5);
                          const tp3Percent = slPercent * (localSettings.tp3_rr_ratio ?? 3.5);
                          
                          return (
                            <div key={lev} className="p-2 bg-muted/50 rounded flex items-center justify-between">
                              <span className="font-medium">{lev}x leverage:</span>
                              <span>
                                SL: {(slPercent * 100).toFixed(3)}% {adjustment}
                                {localSettings.tp_levels >= 1 && ` | TP1: ${(tp1Percent * 100).toFixed(2)}%`}
                                {localSettings.tp_levels >= 2 && ` | TP2: ${(tp2Percent * 100).toFixed(2)}%`}
                                {localSettings.tp_levels >= 3 && ` | TP3: ${(tp3Percent * 100).toFixed(2)}%`}
                              </span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>📊 Fee-Aware Strategy Optimizer</CardTitle>
                    <CardDescription>
                      Optymalizuj margin, leverage i R:R żeby zminimalizować wpływ fees na zyski
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <FeeCalculator
                      margin={localSettings.max_margin_per_trade ?? 2}
                      leverage={localSettings.default_leverage ?? 10}
                      maxLoss={localSettings.max_loss_per_trade ?? 1}
                      tp1RrRatio={localSettings.tp1_rr_ratio ?? 1.5}
                      tp2RrRatio={localSettings.tp2_rr_ratio ?? 2.5}
                      tp3RrRatio={localSettings.tp3_rr_ratio ?? 3.5}
                      tpLevels={localSettings.tp_levels ?? 1}
                      feeAwareBreakeven={localSettings.fee_aware_breakeven ?? true}
                      onMarginChange={(value) => updateLocal("max_margin_per_trade", value)}
                      onLeverageChange={(value) => updateLocal("default_leverage", value)}
                      onMaxLossChange={(value) => updateLocal("max_loss_per_trade", value)}
                      onTP1RRChange={(value) => updateLocal("tp1_rr_ratio", value)}
                      onTP2RRChange={(value) => updateLocal("tp2_rr_ratio", value)}
                      onTP3RRChange={(value) => updateLocal("tp3_rr_ratio", value)}
                      onTPLevelsChange={(value) => updateLocal("tp_levels", value)}
                      onFeeAwareBreakevenChange={(value) => updateLocal("fee_aware_breakeven", value)}
                    />
                  </CardContent>
                </Card>
                </>
              ) : (
                <div className="space-y-2">
                  <Label>
                    Wartość ({localSettings.position_sizing_type === "fixed_usdt" ? "USDT" : "%"})
                  </Label>
                  <Input
                    type="number"
                    value={localSettings.position_size_value}
                    onChange={(e) => updateLocal("position_size_value", parseFloat(e.target.value))}
                  />
                  {localSettings.position_sizing_type === "fixed_usdt" && (
                    <p className="text-xs text-muted-foreground">
                      To jest <strong>wartość pozycji</strong> (notional), nie margines. 
                      Przykład: 3 USDT przy dźwigni 10x = z konta zostanie wzięte 0.3 USDT marginu.
                      Przy dźwigni 20x = 0.15 USDT marginu z konta.
                    </p>
                  )}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dźwignia (Leverage)</CardTitle>
              <CardDescription>Konfiguracja dźwigni dla pozycji</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                <Label>Źródło dźwigni</Label>
                <RadioGroup 
                  value={leverageSource} 
                  onValueChange={(value) => {
                    setLeverageSource(value as "alert" | "global_max" | "custom");
                    
                    if (value === "alert") {
                      updateLocal("use_alert_leverage", true);
                      updateLocal("use_max_leverage_global", false);
                    } else if (value === "global_max") {
                      updateLocal("use_alert_leverage", false);
                      updateLocal("use_max_leverage_global", true);
                    } else {
                      updateLocal("use_alert_leverage", false);
                      updateLocal("use_max_leverage_global", false);
                    }
                  }}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="alert" id="alert" />
                    <Label htmlFor="alert" className="font-normal cursor-pointer">
                      Z alertu TradingView
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="global_max" id="global_max" />
                    <Label htmlFor="global_max" className="font-normal cursor-pointer">
                      Maksymalna dostępna (MAX dla wszystkich symboli)
                    </Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="custom" id="custom" />
                    <Label htmlFor="custom" className="font-normal cursor-pointer">
                      Własna dźwignia
                    </Label>
                  </div>
                </RadioGroup>
                <p className="text-xs text-muted-foreground">
                  {leverageSource === "alert" 
                    ? "Bot użyje dźwigni wysłanej w alercie z TradingView"
                    : leverageSource === "global_max"
                    ? "Bot automatycznie użyje maksymalnej dozwolonej dźwigni dla każdego symbolu"
                    : "Bot użyje poniższej domyślnej dźwigni dla wszystkich symboli"}
                </p>
              </div>

              {leverageSource === "custom" && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label>Domyślna dźwignia</Label>
                    <Input
                      type="number"
                      min="1"
                      max="125"
                      value={localSettings.default_leverage || 10}
                      onChange={(e) => updateLocal("default_leverage", parseInt(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Dźwignia używana dla wszystkich symboli (chyba że ustawisz wyjątek poniżej)
                    </p>
                  </div>
                </>
              )}

              <Separator />

              <div className="space-y-3">
                <div>
                  <Label>Wyjątki dla konkretnych symboli</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    {leverageSource === "alert"
                      ? "Zmień źródło dźwigni aby móc ustawić wyjątki"
                      : leverageSource === "global_max"
                      ? "Ustaw mniejszą dźwignię dla symboli, dla których nie chcesz używać MAX"
                      : "Ustaw różną dźwignię dla konkretnych par handlowych"}
                  </p>
                </div>

                {localSettings.symbol_leverage_overrides && 
                  Object.keys(localSettings.symbol_leverage_overrides).length > 0 && (
                  <div className="space-y-2">
                    {Object.entries(localSettings.symbol_leverage_overrides).map(([symbol, leverage]: [string, any]) => (
                      <div key={symbol} className="flex items-center justify-between p-2 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{symbol}</Badge>
                          <span className="text-sm font-medium">{leverage}x</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const updated = { ...localSettings.symbol_leverage_overrides };
                            delete updated[symbol];
                            updateLocal("symbol_leverage_overrides", updated);
                          }}
                          disabled={leverageSource === "alert"}
                        >
                          Usuń
                        </Button>
                      </div>
                    ))}
                  </div>
                )}

                <div className="flex gap-2">
                  <Input
                    id="new-symbol"
                    placeholder="Symbol (np. BTCUSDT)"
                    className="flex-1"
                    disabled={leverageSource === "alert"}
                  />
                  <Input
                    id="new-leverage"
                    type="number"
                    min="1"
                    max="125"
                    placeholder="Dźwignia"
                    className="w-32"
                    value={newSymbolLeverage}
                    onChange={(e) => setNewSymbolLeverage(e.target.value)}
                    disabled={leverageSource === "alert"}
                  />
                  <Button
                    disabled={leverageSource === "alert"}
                    onClick={() => {
                      const symbolInput = document.getElementById("new-symbol") as HTMLInputElement;
                      const symbol = symbolInput?.value.trim().toUpperCase();
                      
                      if (!symbol) {
                        toast({
                          title: "Błąd",
                          description: "Wprowadź symbol",
                          variant: "destructive",
                        });
                        return;
                      }

                      const leverage = parseInt(newSymbolLeverage);
                      
                      if (!leverage || leverage <= 0 || leverage > 125) {
                        toast({
                          title: "Błąd",
                          description: "Wprowadź prawidłową dźwignię (1-125)",
                          variant: "destructive",
                        });
                        return;
                      }

                      const updated = {
                        ...(localSettings.symbol_leverage_overrides || {}),
                        [symbol]: leverage
                      };
                      updateLocal("symbol_leverage_overrides", updated);
                      symbolInput.value = "";
                      setNewSymbolLeverage("");
                      
                      toast({
                        title: "Dodano",
                        description: `${symbol}: ${leverage}x`,
                      });
                    }}
                  >
                    Dodaj
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {leverageSource === "global_max"
                    ? "Przykład: BTCUSDT z dźwignią 50x zamiast MAX"
                    : "Przykład: BTCUSDT z dźwignią 20x"}
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SL/TP TAB */}
        {localSettings.position_sizing_type !== "scalping_mode" && (
        <TabsContent value="sltp" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Kalkulator SL/TP</CardTitle>
              <CardDescription>Konfiguracja Stop Loss i Take Profit</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              {/* WYBÓR KALKULATORA */}
              <div className="space-y-2">
                <Label>Typ Kalkulatora</Label>
                <Select
                  value={localSettings.calculator_type}
                  onValueChange={(value) => updateLocal("calculator_type", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="simple_percent">Prosty (% od entry)</SelectItem>
                    <SelectItem value="risk_reward">Risk:Reward (R:R)</SelectItem>
                    <SelectItem value="atr_based">ATR-based (Dynamiczny)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Separator />

              {/* SIMPLE PERCENT */}
              {localSettings.calculator_type === "simple_percent" && (
                <>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Stop Loss (%)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={localSettings.simple_sl_percent}
                        onChange={(e) => updateLocal("simple_sl_percent", parseFloat(e.target.value))}
                      />
                      <p className="text-xs text-muted-foreground">
                        Odległość SL od ceny wejścia w %
                      </p>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Liczba poziomów TP</Label>
                      <Input
                        type="number"
                        min="1"
                        max="3"
                        value={localSettings.tp_levels || 1}
                        onChange={(e) => updateLocal("tp_levels", parseInt(e.target.value))}
                      />
                    </div>

                    {/* TP1 */}
                    <div className="space-y-3 p-3 border rounded-lg">
                      <div className="font-medium">TP1</div>
                      <div className="space-y-2">
                        <Label>TP1 - Odległość od entry (%)</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={localSettings.simple_tp_percent}
                          onChange={(e) => updateLocal("simple_tp_percent", parseFloat(e.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>TP1 - Zamknij % pozycji</Label>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={localSettings.tp1_close_percent || 100}
                          onChange={(e) => updateLocal("tp1_close_percent", parseFloat(e.target.value))}
                        />
                      </div>
                    </div>

                    {/* TP2 */}
                    {localSettings.tp_levels >= 2 && (
                      <div className="space-y-3 p-3 border rounded-lg">
                        <div className="font-medium">TP2</div>
                        <div className="space-y-2">
                          <Label>TP2 - Odległość od entry (%)</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={localSettings.simple_tp2_percent || (localSettings.simple_tp_percent * 1.5)}
                            onChange={(e) => updateLocal("simple_tp2_percent", parseFloat(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>TP2 - Zamknij % pozycji</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={localSettings.tp2_close_percent || 0}
                            onChange={(e) => updateLocal("tp2_close_percent", parseFloat(e.target.value))}
                          />
                        </div>
                      </div>
                    )}

                    {/* TP3 */}
                    {localSettings.tp_levels >= 3 && (
                      <div className="space-y-3 p-3 border rounded-lg">
                        <div className="font-medium">TP3</div>
                        <div className="space-y-2">
                          <Label>TP3 - Odległość od entry (%)</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={localSettings.simple_tp3_percent || (localSettings.simple_tp_percent * 2)}
                            onChange={(e) => updateLocal("simple_tp3_percent", parseFloat(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>TP3 - Zamknij % pozycji</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={localSettings.tp3_close_percent || 0}
                            onChange={(e) => updateLocal("tp3_close_percent", parseFloat(e.target.value))}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* RISK REWARD */}
              {localSettings.calculator_type === "risk_reward" && (
                <>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Stop Loss (% z margin)</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={localSettings.rr_sl_percent_margin || 2.0}
                        onChange={(e) => updateLocal("rr_sl_percent_margin", parseFloat(e.target.value))}
                      />
                      <p className="text-xs text-muted-foreground">
                        Maksymalna strata jako % kapitału z uwzględnieniem dźwigni
                      </p>
                    </div>
                    
                    <div className="flex items-center justify-between">
                      <div className="space-y-0.5">
                        <Label>Adaptive R:R</Label>
                        <div className="text-sm text-muted-foreground">
                          Automatyczne dostosowanie R:R do siły sygnału
                        </div>
                      </div>
                      <Switch
                        checked={localSettings.rr_adaptive || false}
                        onCheckedChange={(checked) => updateLocal("rr_adaptive", checked)}
                      />
                    </div>

                    {localSettings.rr_adaptive && (
                      <div className="space-y-3 pl-4 border-l-2 border-primary/30">
                        <div className="space-y-2">
                          <Label>Słaby sygnał R:R</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={localSettings.adaptive_rr_weak_signal || 1.5}
                            onChange={(e) => updateLocal("adaptive_rr_weak_signal", parseFloat(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Standardowy R:R</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={localSettings.adaptive_rr_standard || 2.0}
                            onChange={(e) => updateLocal("adaptive_rr_standard", parseFloat(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Silny sygnał R:R</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={localSettings.adaptive_rr_strong || 2.5}
                            onChange={(e) => updateLocal("adaptive_rr_strong", parseFloat(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Bardzo silny R:R</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={localSettings.adaptive_rr_very_strong || 3.0}
                            onChange={(e) => updateLocal("adaptive_rr_very_strong", parseFloat(e.target.value))}
                          />
                        </div>
                      </div>
                    )}
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Liczba poziomów TP</Label>
                      <Input
                        type="number"
                        min="1"
                        max="3"
                        value={localSettings.tp_levels || 1}
                        onChange={(e) => updateLocal("tp_levels", parseInt(e.target.value))}
                      />
                    </div>

                    {/* TP1 */}
                    <div className="space-y-3 p-3 border rounded-lg">
                      <div className="font-medium">TP1</div>
                      <div className="space-y-2">
                        <Label>R:R Ratio</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={localSettings.tp1_rr_ratio || 1.5}
                          onChange={(e) => updateLocal("tp1_rr_ratio", parseFloat(e.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>Zamknij % pozycji</Label>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={localSettings.tp1_close_percent || 50}
                          onChange={(e) => updateLocal("tp1_close_percent", parseFloat(e.target.value))}
                        />
                      </div>
                    </div>

                    {/* TP2 */}
                    {localSettings.tp_levels >= 2 && (
                      <div className="space-y-3 p-3 border rounded-lg">
                        <div className="font-medium">TP2</div>
                        <div className="space-y-2">
                          <Label>R:R Ratio</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={localSettings.tp2_rr_ratio || 2.5}
                            onChange={(e) => updateLocal("tp2_rr_ratio", parseFloat(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Zamknij % pozycji</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={localSettings.tp2_close_percent || 30}
                            onChange={(e) => updateLocal("tp2_close_percent", parseFloat(e.target.value))}
                          />
                        </div>
                      </div>
                    )}

                    {/* TP3 */}
                    {localSettings.tp_levels >= 3 && (
                      <div className="space-y-3 p-3 border rounded-lg">
                        <div className="font-medium">TP3</div>
                        <div className="space-y-2">
                          <Label>R:R Ratio</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={localSettings.tp3_rr_ratio || 3.5}
                            onChange={(e) => updateLocal("tp3_rr_ratio", parseFloat(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>Zamknij % pozycji</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={localSettings.tp3_close_percent || 20}
                            onChange={(e) => updateLocal("tp3_close_percent", parseFloat(e.target.value))}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}

              {/* ATR BASED */}
              {localSettings.calculator_type === "atr_based" && (
                <>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>ATR SL Multiplier</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={localSettings.atr_sl_multiplier || 1.5}
                        onChange={(e) => updateLocal("atr_sl_multiplier", parseFloat(e.target.value))}
                      />
                      <p className="text-xs text-muted-foreground">
                        SL będzie {localSettings.atr_sl_multiplier || 1.5}x ATR od ceny wejścia
                      </p>
                    </div>
                  </div>

                  <Separator />

                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label>Liczba poziomów TP</Label>
                      <Input
                        type="number"
                        min="1"
                        max="3"
                        value={localSettings.tp_levels || 1}
                        onChange={(e) => updateLocal("tp_levels", parseInt(e.target.value))}
                      />
                    </div>

                    {/* TP1 */}
                    <div className="space-y-3 p-3 border rounded-lg">
                      <div className="font-medium">TP1</div>
                      <div className="space-y-2">
                        <Label>TP1 - ATR Multiplier</Label>
                        <Input
                          type="number"
                          step="0.1"
                          value={localSettings.atr_tp_multiplier || 3.0}
                          onChange={(e) => updateLocal("atr_tp_multiplier", parseFloat(e.target.value))}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label>TP1 - Zamknij % pozycji</Label>
                        <Input
                          type="number"
                          min="0"
                          max="100"
                          value={localSettings.tp1_close_percent || 100}
                          onChange={(e) => updateLocal("tp1_close_percent", parseFloat(e.target.value))}
                        />
                      </div>
                    </div>

                    {/* TP2 */}
                    {localSettings.tp_levels >= 2 && (
                      <div className="space-y-3 p-3 border rounded-lg">
                        <div className="font-medium">TP2</div>
                        <div className="space-y-2">
                          <Label>TP2 - ATR Multiplier</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={localSettings.atr_tp2_multiplier || (localSettings.atr_tp_multiplier * 1.5)}
                            onChange={(e) => updateLocal("atr_tp2_multiplier", parseFloat(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>TP2 - Zamknij % pozycji</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={localSettings.tp2_close_percent || 0}
                            onChange={(e) => updateLocal("tp2_close_percent", parseFloat(e.target.value))}
                          />
                        </div>
                      </div>
                    )}

                    {/* TP3 */}
                    {localSettings.tp_levels >= 3 && (
                      <div className="space-y-3 p-3 border rounded-lg">
                        <div className="font-medium">TP3</div>
                        <div className="space-y-2">
                          <Label>TP3 - ATR Multiplier</Label>
                          <Input
                            type="number"
                            step="0.1"
                            value={localSettings.atr_tp3_multiplier || (localSettings.atr_tp_multiplier * 2)}
                            onChange={(e) => updateLocal("atr_tp3_multiplier", parseFloat(e.target.value))}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label>TP3 - Zamknij % pozycji</Label>
                          <Input
                            type="number"
                            min="0"
                            max="100"
                            value={localSettings.tp3_close_percent || 0}
                            onChange={(e) => updateLocal("tp3_close_percent", parseFloat(e.target.value))}
                          />
                        </div>
                      </div>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Zaawansowane Zarządzanie SL</CardTitle>
              <CardDescription>Automatyczne przesuwanie Stop Loss po osiągnięciu TP</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Strategia po osiągnięciu TP</Label>
                <Select
                  value={
                    localSettings.trailing_stop ? "trailing" :
                    localSettings.sl_to_breakeven ? "breakeven" : 
                    "none"
                  }
                  onValueChange={(value) => {
                    if (value === "trailing") {
                      updateLocal("trailing_stop", true);
                      updateLocal("sl_to_breakeven", false);
                    } else if (value === "breakeven") {
                      updateLocal("trailing_stop", false);
                      updateLocal("sl_to_breakeven", true);
                    } else {
                      updateLocal("trailing_stop", false);
                      updateLocal("sl_to_breakeven", false);
                    }
                  }}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Brak - SL pozostaje na miejscu</SelectItem>
                    <SelectItem value="breakeven">Breakeven - przesuń SL na entry</SelectItem>
                    <SelectItem value="trailing">Trailing Stop - śledź cenę</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {localSettings.sl_to_breakeven && (
                <div className="space-y-2">
                  <Label>Breakeven Trigger (po którym TP?)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="3"
                    value={localSettings.breakeven_trigger_tp}
                    onChange={(e) => updateLocal("breakeven_trigger_tp", parseInt(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Po osiągnięciu tego TP, SL zostanie przesunięty na cenę wejścia
                  </p>
                </div>
              )}

              {localSettings.trailing_stop && (
                <>
                  <div className="space-y-2">
                    <Label>Trailing Start (po którym TP?)</Label>
                    <Input
                      type="number"
                      min="1"
                      max="3"
                      value={localSettings.trailing_stop_trigger_tp}
                      onChange={(e) => updateLocal("trailing_stop_trigger_tp", parseInt(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Trailing Distance (%)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.trailing_stop_distance}
                      onChange={(e) => updateLocal("trailing_stop_distance", parseFloat(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      O ile % poniżej aktualnej ceny ma być trailing stop
                    </p>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* ADAPTIVE TAB */}
        <TabsContent value="adaptive" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Adaptive TP Spacing</CardTitle>
              <CardDescription>Dostosowanie odstępów TP na podstawie zmienności</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Włącz Adaptive TP Spacing</Label>
                  <div className="text-sm text-muted-foreground">
                    Rozszerz TP przy wysokiej zmienności, zmniejsz przy niskiej
                  </div>
                </div>
                <Switch
                  checked={localSettings.adaptive_tp_spacing}
                  onCheckedChange={(checked) => updateLocal("adaptive_tp_spacing", checked)}
                />
              </div>

              {localSettings.adaptive_tp_spacing && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label>Wysoka zmienność - Multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.adaptive_tp_high_volatility_multiplier}
                      onChange={(e) => updateLocal("adaptive_tp_high_volatility_multiplier", parseFloat(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Domyślnie 1.3 (TP 30% dalej). Gdy ATR &gt; 0.01 lub volume_ratio &gt; 1.5
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Niska zmienność - Multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.adaptive_tp_low_volatility_multiplier}
                      onChange={(e) => updateLocal("adaptive_tp_low_volatility_multiplier", parseFloat(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Domyślnie 0.9 (TP 10% bliżej). Gdy ATR i volume są niskie
                    </p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg text-sm">
                    <strong>Jak to działa:</strong> System analizuje ATR i volume_ratio z alertu.
                    Przy silnych ruchach (wysoka zmienność) TP są dalej, aby uchwycić większy ruch.
                    Przy spokojnym rynku TP są bliżej dla szybszego realizowania zysków.
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Momentum-Based TP</CardTitle>
              <CardDescription>Dostosowanie TP na podstawie siły momentum</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Włącz Momentum-Based TP</Label>
                  <div className="text-sm text-muted-foreground">
                    Rozszerz TP gdy momentum jest silne
                  </div>
                </div>
                <Switch
                  checked={localSettings.momentum_based_tp}
                  onCheckedChange={(checked) => updateLocal("momentum_based_tp", checked)}
                />
              </div>

              {localSettings.momentum_based_tp && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label>Słabe momentum - Multiplier (strength &lt; 0.3)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.momentum_weak_multiplier}
                      onChange={(e) => updateLocal("momentum_weak_multiplier", parseFloat(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Domyślnie 0.9 - bliższe TP dla słabych sygnałów
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Umiarkowane momentum - Multiplier (0.3-0.6)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.momentum_moderate_multiplier}
                      onChange={(e) => updateLocal("momentum_moderate_multiplier", parseFloat(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Domyślnie 1.1 - lekko dalej dla standardowych sygnałów
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Silne momentum - Multiplier (strength &gt; 0.6)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.momentum_strong_multiplier}
                      onChange={(e) => updateLocal("momentum_strong_multiplier", parseFloat(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Domyślnie 1.3 - znacznie dalej dla bardzo silnych sygnałów
                    </p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg text-sm">
                    <strong>Jak to działa:</strong> Pole 'strength' z alertu (0-1) określa siłę momentum.
                    Im wyższa wartość, tym dalej ustawiamy TP, bo ruch może być silniejszy.
                    Przykład: strength=0.8 (silny) = TP 30% dalej od bazowego.
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Adaptive Risk:Reward</CardTitle>
              <CardDescription>Dostosowanie R:R na podstawie siły sygnału</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Włącz Adaptive R:R</Label>
                  <div className="text-sm text-muted-foreground">
                    Lepszy R:R dla silniejszych sygnałów
                  </div>
                </div>
                <Switch
                  checked={localSettings.adaptive_rr}
                  onCheckedChange={(checked) => updateLocal("adaptive_rr", checked)}
                />
              </div>

              {localSettings.adaptive_rr && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label>Słaby sygnał - Multiplier (score 0-3)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.adaptive_rr_weak_signal}
                      onChange={(e) => updateLocal("adaptive_rr_weak_signal", parseFloat(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Domyślnie 0.8x - niższy R:R, bierzemy szybszy zysk
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Standardowy - Multiplier (score 3-5)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.adaptive_rr_standard}
                      onChange={(e) => updateLocal("adaptive_rr_standard", parseFloat(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Domyślnie 1.0x - bazowy R:R bez zmian
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Silny - Multiplier (score 5-7)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.adaptive_rr_strong}
                      onChange={(e) => updateLocal("adaptive_rr_strong", parseFloat(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Domyślnie 1.2x - wyższy R:R dla dobrych sygnałów
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label>Bardzo silny - Multiplier (score 7-10)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.adaptive_rr_very_strong}
                      onChange={(e) => updateLocal("adaptive_rr_very_strong", parseFloat(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Domyślnie 1.5x - maksymalny R:R dla najlepszych setupów
                    </p>
                  </div>
                  <div className="p-3 bg-muted rounded-lg text-sm">
                    <strong>Jak to działa:</strong> Score = strength × 10 (0-10).
                    Wyższy score = sygnał lepszej jakości = możemy celować w dalsze TP.
                    Przykład: strength=0.75 → score=7.5 → R:R 1.5x (very strong).
                    Jeśli bazowy R:R to 2.0, to finalny będzie 3.0 (2.0 × 1.5).
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* RISK MANAGEMENT TAB */}
        <TabsContent value="risk" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Limity Ryzyka</CardTitle>
              <CardDescription>Zarządzanie maksymalnymi limitami</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Maksymalna liczba otwartych pozycji</Label>
                <Input
                  type="number"
                  min="1"
                  value={localSettings.max_open_positions}
                  onChange={(e) => updateLocal("max_open_positions", parseInt(e.target.value))}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dzienny Limit Strat</CardTitle>
              <CardDescription>Automatyczne zatrzymanie po osiągnięciu limitu</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Typ limitu</Label>
                <Select
                  value={localSettings.loss_limit_type || 'fixed_usdt'}
                  onValueChange={(value) => updateLocal("loss_limit_type", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="fixed_usdt">Stała kwota USDT</SelectItem>
                    <SelectItem value="percent_drawdown">% Drawdown kapitału</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {localSettings.loss_limit_type === 'fixed_usdt' || !localSettings.loss_limit_type ? (
                <div className="space-y-2">
                  <Label>Maksymalna strata dzienna (USDT)</Label>
                  <Input
                    type="number"
                    value={localSettings.daily_loss_limit}
                    onChange={(e) => updateLocal("daily_loss_limit", parseFloat(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Bot przestanie tradować po przekroczeniu tej kwoty strat w ciągu dnia
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Maksymalny dzienny drawdown (%)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    value={localSettings.daily_loss_percent || 5.0}
                    onChange={(e) => updateLocal("daily_loss_percent", parseFloat(e.target.value))}
                  />
                  <p className="text-xs text-muted-foreground">
                    Bot przestanie tradować gdy dzienny drawdown przekroczy ten % kapitału
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Filtry Sygnałów</CardTitle>
              <CardDescription>Wykluczaj słabsze sygnały z tradingu</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Filtruj po tierze</Label>
                  <div className="text-sm text-muted-foreground">
                    Wykluczaj określone tiers z automatycznego tradingu
                  </div>
                </div>
                <Switch
                  checked={localSettings.filter_by_tier}
                  onCheckedChange={(checked) => updateLocal("filter_by_tier", checked)}
                />
              </div>

              {localSettings.filter_by_tier && (
                <div className="space-y-2">
                  <Label>Wykluczone Tiers (nie będą tradowane)</Label>
                  <p className="text-sm text-muted-foreground mb-3">
                    Tiery ze wskaźnika: <strong>Platinum</strong> (najrzadsze, 1-2/dzień), <strong>Premium</strong> (2-4/dzień), <strong>Standard</strong> (4-8/dzień), <strong>Quick</strong> (6-12/dzień), <strong>Emergency</strong> (0-3/dzień, tryb awaryjny)
                  </p>
                  <div className="space-y-2">
                    {['Platinum', 'Premium', 'Standard', 'Quick', 'Emergency'].map((tier) => (
                      <div key={tier} className="flex items-center space-x-2">
                        <Checkbox
                          id={`exclude-${tier}`}
                          checked={(localSettings.excluded_tiers || []).includes(tier)}
                          onCheckedChange={(checked) => {
                            const current = localSettings.excluded_tiers || [];
                            if (checked) {
                              updateLocal("excluded_tiers", [...current, tier]);
                            } else {
                              updateLocal("excluded_tiers", current.filter((t: string) => t !== tier));
                            }
                          }}
                        />
                        <Label htmlFor={`exclude-${tier}`} className="cursor-pointer">
                          {tier}
                        </Label>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground">
                    Zaznaczone tiers będą automatycznie ignorowane
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Obsługa Duplikatów Alertów</CardTitle>
              <CardDescription>Inteligentne zarządzanie alertami na tym samym symbolu</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Włącz inteligentną obsługę duplikatów</Label>
                  <div className="text-sm text-muted-foreground">
                    Analizuj siłę nowego alertu vs istniejącej pozycji
                  </div>
                </div>
                <Switch
                  checked={localSettings.duplicate_alert_handling !== false}
                  onCheckedChange={(checked) => updateLocal("duplicate_alert_handling", checked)}
                />
              </div>

              {localSettings.duplicate_alert_handling !== false && (
                <>
                  <Separator />
                  
                  <div className="space-y-2">
                    <Label>Próg siły alertu (punkty)</Label>
                    <Input
                      type="number"
                      min="0"
                      max="100"
                      step="1"
                      value={Math.round((localSettings.alert_strength_threshold || 0.20) * 100)}
                      onChange={(e) => updateLocal("alert_strength_threshold", parseFloat(e.target.value) / 100)}
                    />
                    <p className="text-xs text-muted-foreground">
                      Minimalna różnica siły (w punktach 0-100), aby uznać nowy alert za mocniejszy. Domyślnie: 20 pkt
                    </p>
                  </div>

                  <div className="space-y-2">
                    <Label>Próg PnL (%)</Label>
                    <Input
                      type="number"
                      min="0"
                      max="10"
                      step="0.1"
                      value={localSettings.pnl_threshold_percent || 0.5}
                      onChange={(e) => updateLocal("pnl_threshold_percent", parseFloat(e.target.value))}
                    />
                    <p className="text-xs text-muted-foreground">
                      Minimalny zysk/strata w % wartości pozycji aby uznać pozycję za "na plusie" lub "na minusie". 
                      Poniżej tego progu pozycja jest traktowana jako break-even. Domyślnie: 0.5%
                    </p>
                  </div>

                  <Separator />

                  <div className="p-4 bg-muted/50 rounded-lg space-y-3">
                    <div className="font-medium text-sm">📊 Logika działania:</div>
                    
                    <div className="space-y-2 text-xs">
                      <div className="font-semibold">Alert w tym samym kierunku (LONG → LONG):</div>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                        <li>Słabszy lub &lt;{Math.round((localSettings.alert_strength_threshold || 0.20) * 100)} pkt mocniejszy → ❌ Odrzuć</li>
                        <li>≥{Math.round((localSettings.alert_strength_threshold || 0.20) * 100)} pkt mocniejszy + pozycja na minusie/break-even → ❌ Odrzuć</li>
                        <li>≥{Math.round((localSettings.alert_strength_threshold || 0.20) * 100)} pkt mocniejszy + pozycja na plusie (&gt;{localSettings.pnl_threshold_percent || 0.5}% wartości) → ✅ Zamknij i otwórz nową</li>
                      </ul>
                    </div>

                    <div className="space-y-2 text-xs">
                      <div className="font-semibold">Alert w przeciwnym kierunku (LONG → SHORT):</div>
                      <ul className="list-disc list-inside space-y-1 text-muted-foreground ml-2">
                        <li>Słabszy lub &lt;{Math.round((localSettings.alert_strength_threshold || 0.20) * 100)} pkt mocniejszy → ❌ Odrzuć</li>
                        <li>≥{Math.round((localSettings.alert_strength_threshold || 0.20) * 100)} pkt mocniejszy + pozycja na minusie/break-even → ✅ Zamknij i otwórz nową</li>
                        <li>≥{Math.round((localSettings.alert_strength_threshold || 0.20) * 100)} pkt mocniejszy + pozycja na plusie (&gt;{localSettings.pnl_threshold_percent || 0.5}% wartości) → ❌ Odrzuć (chroń zysk)</li>
                      </ul>
                    </div>

                    <div className="p-3 bg-background/50 rounded text-xs text-muted-foreground">
                      <strong>Jak to działa:</strong> Gdy pojawia się nowy alert na symbolu z już otwartą pozycją, 
                      system porównuje siłę sygnałów i stan PnL. Silniejsze sygnały (różnica ≥{Math.round((localSettings.alert_strength_threshold || 0.20) * 100)} pkt) 
                      mogą zamknąć istniejącą pozycję jeśli warunki są spełnione. Pozycje ze znaczącym zyskiem (&gt;{localSettings.pnl_threshold_percent || 0.5}% wartości pozycji) 
                      są chronione. Pozycje z PnL w przedziale ±{localSettings.pnl_threshold_percent || 0.5}% wartości traktowane jako break-even.
                    </div>
                  </div>
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {/* MONITORING TAB */}
        <TabsContent value="monitor" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>System Monitoringu</CardTitle>
              <CardDescription>Konfiguracja sprawdzania pozycji</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Interwał sprawdzania (sekundy)</Label>
                <Input
                  type="number"
                  min="30"
                  value={localSettings.monitor_interval_seconds}
                  onChange={(e) => updateLocal("monitor_interval_seconds", parseInt(e.target.value))}
                />
                <div className="text-sm text-muted-foreground">
                  Jak często bot sprawdza stan pozycji na giełdzie
                </div>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Auto-naprawianie</Label>
                  <div className="text-sm text-muted-foreground">
                    Automatycznie naprawiaj wykryte problemy
                  </div>
                </div>
                <Switch
                  checked={localSettings.auto_repair}
                  onCheckedChange={(checked) => updateLocal("auto_repair", checked)}
                />
              </div>

              <div className="mt-4 p-4 bg-muted rounded-lg">
                <div className="text-sm space-y-2">
                  <div className="font-medium">System sprawdza:</div>
                  <ul className="list-disc list-inside space-y-1 text-muted-foreground">
                    <li>Czy quantity się zgadza</li>
                    <li>Czy SL jest ustawiony</li>
                    <li>Czy TP są ustawione</li>
                    <li>Czy ceny SL/TP są prawidłowe</li>
                  </ul>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
