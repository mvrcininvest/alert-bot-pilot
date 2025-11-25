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

export default function Settings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [localSettings, setLocalSettings] = useState<any>(null);

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
            min_strength: 0.3,
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
      setLocalSettings(settings);
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
        <TabsList className="grid w-full grid-cols-6">
          <TabsTrigger value="general">Ogólne</TabsTrigger>
          <TabsTrigger value="position">Pozycje</TabsTrigger>
          <TabsTrigger value="sltp">SL/TP</TabsTrigger>
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
                  value={localSettings.profile_name}
                  onChange={(e) => updateLocal("profile_name", e.target.value)}
                  placeholder="Default"
                />
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
                  </SelectContent>
                </Select>
              </div>

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
                    Wartość kontraktu bez dźwigni (notional). Z dźwignią 10x potrzebujesz 10x mniej marginu.
                  </p>
                )}
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Dźwignia (Leverage)</CardTitle>
              <CardDescription>Konfiguracja dźwigni dla pozycji</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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
                  Dźwignia używana dla wszystkich symboli (jeśli nie ma custom ustawienia)
                </p>
              </div>

              <Separator />

              <div className="space-y-3">
                <div>
                  <Label>Niestandardowa dźwignia dla symboli</Label>
                  <p className="text-xs text-muted-foreground mt-1">
                    Ustaw różną dźwignię dla konkretnych par handlowych
                  </p>
                </div>

                {localSettings.symbol_leverage_overrides && 
                  Object.keys(localSettings.symbol_leverage_overrides).length > 0 && (
                  <div className="space-y-2">
                    {Object.entries(localSettings.symbol_leverage_overrides).map(([symbol, leverage]) => (
                      <div key={symbol} className="flex items-center justify-between p-2 border rounded-lg">
                        <div className="flex items-center gap-2">
                          <Badge variant="outline">{symbol}</Badge>
                          <span className="text-sm">{leverage as number}x</span>
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            const updated = { ...localSettings.symbol_leverage_overrides };
                            delete updated[symbol];
                            updateLocal("symbol_leverage_overrides", updated);
                          }}
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
                  />
                  <Input
                    id="new-leverage"
                    type="number"
                    min="1"
                    max="125"
                    placeholder="Dźwignia"
                    className="w-24"
                  />
                  <Button
                    onClick={() => {
                      const symbolInput = document.getElementById("new-symbol") as HTMLInputElement;
                      const leverageInput = document.getElementById("new-leverage") as HTMLInputElement;
                      
                      const symbol = symbolInput?.value.trim().toUpperCase();
                      const leverage = parseInt(leverageInput?.value);
                      
                      if (symbol && leverage && leverage > 0 && leverage <= 125) {
                        const updated = {
                          ...(localSettings.symbol_leverage_overrides || {}),
                          [symbol]: leverage
                        };
                        updateLocal("symbol_leverage_overrides", updated);
                        symbolInput.value = "";
                        leverageInput.value = "";
                        toast({
                          title: "Dodano",
                          description: `Ustawiono ${symbol} na dźwignię ${leverage}x`,
                        });
                      } else {
                        toast({
                          title: "Błąd",
                          description: "Wprowadź prawidłowy symbol i dźwignię (1-125)",
                          variant: "destructive",
                        });
                      }
                    }}
                  >
                    Dodaj
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Przykład: BTCUSDT z dźwignią 20x, ETHUSDT z 15x
                </p>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        {/* SL/TP TAB */}
        <TabsContent value="sltp" className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle>Kalkulator SL/TP</CardTitle>
              <CardDescription>Wybierz metodę kalkulacji Stop Loss i Take Profit</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
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

              {localSettings.calculator_type === "simple_percent" && (
                <>
                  <div className="space-y-2">
                    <Label>SL Procent (% od ceny wejścia)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.simple_sl_percent}
                      onChange={(e) => updateLocal("simple_sl_percent", parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>TP Procent (% od ceny wejścia)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.simple_tp_percent}
                      onChange={(e) => updateLocal("simple_tp_percent", parseFloat(e.target.value))}
                    />
                  </div>
                </>
              )}

              {localSettings.calculator_type === "risk_reward" && (
                <>
                  <div className="space-y-2">
                    <Label>SL % od Margin (max strata z kapitału)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.rr_sl_percent_margin}
                      onChange={(e) => updateLocal("rr_sl_percent_margin", parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Risk:Reward Ratio (bazowy)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.rr_ratio}
                      onChange={(e) => updateLocal("rr_ratio", parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label>Adaptive R:R</Label>
                      <div className="text-sm text-muted-foreground">
                        Dostosuj R:R na podstawie siły sygnału
                      </div>
                    </div>
                    <Switch
                      checked={localSettings.rr_adaptive}
                      onCheckedChange={(checked) => updateLocal("rr_adaptive", checked)}
                    />
                  </div>
                </>
              )}

              {localSettings.calculator_type === "atr_based" && (
                <>
                  <div className="space-y-2">
                    <Label>ATR SL Multiplier (ile ATR dla SL)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.atr_sl_multiplier}
                      onChange={(e) => updateLocal("atr_sl_multiplier", parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>ATR TP Multiplier (ile ATR dla TP)</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.atr_tp_multiplier}
                      onChange={(e) => updateLocal("atr_tp_multiplier", parseFloat(e.target.value))}
                    />
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Zaawansowane Zarządzanie SL</CardTitle>
              <CardDescription>Wybierz JEDNĄ strategię przesuwania Stop Loss</CardDescription>
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

          <Card>
            <CardHeader>
              <CardTitle>Poziomy Take Profit</CardTitle>
              <CardDescription>Konfiguracja częściowego zamykania pozycji</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Liczba poziomów TP</Label>
                <Input
                  type="number"
                  min="1"
                  max="3"
                  value={localSettings.tp_levels}
                  onChange={(e) => updateLocal("tp_levels", parseInt(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label>TP1 - Zamknij % pozycji</Label>
                <Input
                  type="number"
                  min="0"
                  max="100"
                  value={localSettings.tp1_close_percent}
                  onChange={(e) => updateLocal("tp1_close_percent", parseFloat(e.target.value))}
                />
              </div>
              
              {localSettings.tp_levels >= 2 && (
                <div className="space-y-2">
                  <Label>TP2 - Zamknij % pozycji</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={localSettings.tp2_close_percent}
                    onChange={(e) => updateLocal("tp2_close_percent", parseFloat(e.target.value))}
                  />
                </div>
              )}
              
              {localSettings.tp_levels >= 3 && (
                <div className="space-y-2">
                  <Label>TP3 - Zamknij % pozycji</Label>
                  <Input
                    type="number"
                    min="0"
                    max="100"
                    value={localSettings.tp3_close_percent}
                    onChange={(e) => updateLocal("tp3_close_percent", parseFloat(e.target.value))}
                  />
                </div>
              )}

              {localSettings.calculator_type === "risk_reward" && (
                <>
                  <Separator />
                  <div className="space-y-2">
                    <Label>TP1 R:R Ratio</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.tp1_rr_ratio}
                      onChange={(e) => updateLocal("tp1_rr_ratio", parseFloat(e.target.value))}
                    />
                  </div>
                  {localSettings.tp_levels >= 2 && (
                    <div className="space-y-2">
                      <Label>TP2 R:R Ratio</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={localSettings.tp2_rr_ratio}
                        onChange={(e) => updateLocal("tp2_rr_ratio", parseFloat(e.target.value))}
                      />
                    </div>
                  )}
                  {localSettings.tp_levels >= 3 && (
                    <div className="space-y-2">
                      <Label>TP3 R:R Ratio</Label>
                      <Input
                        type="number"
                        step="0.1"
                        value={localSettings.tp3_rr_ratio}
                        onChange={(e) => updateLocal("tp3_rr_ratio", parseFloat(e.target.value))}
                      />
                    </div>
                  )}
                </>
              )}
            </CardContent>
          </Card>
        </TabsContent>

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
