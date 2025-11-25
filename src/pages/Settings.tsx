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

              {localSettings.calculator_type === "simple_percent" && (
                <>
                  <div className="space-y-2">
                    <Label>SL Procent</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.simple_sl_percent}
                      onChange={(e) => updateLocal("simple_sl_percent", parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>TP Procent</Label>
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
                    <Label>SL % od Margin</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.rr_sl_percent_margin}
                      onChange={(e) => updateLocal("rr_sl_percent_margin", parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Risk:Reward Ratio</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.rr_ratio}
                      onChange={(e) => updateLocal("rr_ratio", parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="flex items-center justify-between">
                    <Label>Adaptive R:R</Label>
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
                    <Label>ATR SL Multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.atr_sl_multiplier}
                      onChange={(e) => updateLocal("atr_sl_multiplier", parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>ATR TP Multiplier</Label>
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
              <CardTitle>Zarządzanie SL</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Metoda Stop Loss</Label>
                <Select
                  value={localSettings.sl_method}
                  onValueChange={(value) => updateLocal("sl_method", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="percent_margin">% od Margin</SelectItem>
                    <SelectItem value="percent_entry">% od Ceny Entry</SelectItem>
                    <SelectItem value="fixed_usdt">Stała kwota USDT</SelectItem>
                    <SelectItem value="atr_based">Bazowany na ATR</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Breakeven</Label>
                  <div className="text-sm text-muted-foreground">Przesuń SL na entry po TP</div>
                </div>
                <Switch
                  checked={localSettings.sl_to_breakeven}
                  onCheckedChange={(checked) => updateLocal("sl_to_breakeven", checked)}
                />
              </div>

              {localSettings.sl_to_breakeven && (
                <div className="space-y-2">
                  <Label>Breakeven Trigger (który TP?)</Label>
                  <Input
                    type="number"
                    min="1"
                    max="3"
                    value={localSettings.breakeven_trigger_tp}
                    onChange={(e) => updateLocal("breakeven_trigger_tp", parseInt(e.target.value))}
                  />
                </div>
              )}

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Trailing Stop</Label>
                  <div className="text-sm text-muted-foreground">Automatyczne przesuwanie SL</div>
                </div>
                <Switch
                  checked={localSettings.trailing_stop}
                  onCheckedChange={(checked) => updateLocal("trailing_stop", checked)}
                />
              </div>

              {localSettings.trailing_stop && (
                <>
                  <div className="space-y-2">
                    <Label>Trailing Trigger (który TP?)</Label>
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
                  </div>
                </>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Poziomy Take Profit</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label>Strategia TP</Label>
                <Select
                  value={localSettings.tp_strategy}
                  onValueChange={(value) => updateLocal("tp_strategy", value)}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="partial_close">Częściowe zamykanie</SelectItem>
                    <SelectItem value="main_tp_only">Tylko main_tp</SelectItem>
                    <SelectItem value="trailing_stop">Trailing Stop</SelectItem>
                  </SelectContent>
                </Select>
              </div>

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

              {localSettings.tp_strategy === "partial_close" && (
                <>
                  <div className="space-y-2">
                    <Label>TP1 Zamknij % pozycji</Label>
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
                      <Label>TP2 Zamknij % pozycji</Label>
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
                      <Label>TP3 Zamknij % pozycji</Label>
                      <Input
                        type="number"
                        min="0"
                        max="100"
                        value={localSettings.tp3_close_percent}
                        onChange={(e) => updateLocal("tp3_close_percent", parseFloat(e.target.value))}
                      />
                    </div>
                  )}
                </>
              )}

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
                <Label>Włącz Adaptive TP Spacing</Label>
                <Switch
                  checked={localSettings.adaptive_tp_spacing}
                  onCheckedChange={(checked) => updateLocal("adaptive_tp_spacing", checked)}
                />
              </div>

              {localSettings.adaptive_tp_spacing && (
                <>
                  <div className="space-y-2">
                    <Label>Wysoka zmienność - Multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.adaptive_tp_high_volatility_multiplier}
                      onChange={(e) => updateLocal("adaptive_tp_high_volatility_multiplier", parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Niska zmienność - Multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.adaptive_tp_low_volatility_multiplier}
                      onChange={(e) => updateLocal("adaptive_tp_low_volatility_multiplier", parseFloat(e.target.value))}
                    />
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
                <Label>Włącz Momentum-Based TP</Label>
                <Switch
                  checked={localSettings.momentum_based_tp}
                  onCheckedChange={(checked) => updateLocal("momentum_based_tp", checked)}
                />
              </div>

              {localSettings.momentum_based_tp && (
                <>
                  <div className="space-y-2">
                    <Label>Słabe momentum - Multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.momentum_weak_multiplier}
                      onChange={(e) => updateLocal("momentum_weak_multiplier", parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Umiarkowane momentum - Multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.momentum_moderate_multiplier}
                      onChange={(e) => updateLocal("momentum_moderate_multiplier", parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Silne momentum - Multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.momentum_strong_multiplier}
                      onChange={(e) => updateLocal("momentum_strong_multiplier", parseFloat(e.target.value))}
                    />
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
                <Label>Włącz Adaptive R:R</Label>
                <Switch
                  checked={localSettings.adaptive_rr}
                  onCheckedChange={(checked) => updateLocal("adaptive_rr", checked)}
                />
              </div>

              {localSettings.adaptive_rr && (
                <>
                  <div className="space-y-2">
                    <Label>Słaby sygnał (0-3) - Multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.adaptive_rr_weak_signal}
                      onChange={(e) => updateLocal("adaptive_rr_weak_signal", parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Standardowy (3-5) - Multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.adaptive_rr_standard}
                      onChange={(e) => updateLocal("adaptive_rr_standard", parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Silny (5-7) - Multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.adaptive_rr_strong}
                      onChange={(e) => updateLocal("adaptive_rr_strong", parseFloat(e.target.value))}
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Bardzo silny (7-10) - Multiplier</Label>
                    <Input
                      type="number"
                      step="0.1"
                      value={localSettings.adaptive_rr_very_strong}
                      onChange={(e) => updateLocal("adaptive_rr_very_strong", parseFloat(e.target.value))}
                    />
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
                <Label>Max otwartych pozycji</Label>
                <Input
                  type="number"
                  min="1"
                  value={localSettings.max_open_positions}
                  onChange={(e) => updateLocal("max_open_positions", parseInt(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label>Dzienny limit strat (USDT)</Label>
                <Input
                  type="number"
                  value={localSettings.daily_loss_limit}
                  onChange={(e) => updateLocal("daily_loss_limit", parseFloat(e.target.value))}
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Filtry Sygnałów</CardTitle>
              <CardDescription>Filtrowanie alertów przed wykonaniem</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Filtruj po Tier</Label>
                  <div className="text-sm text-muted-foreground">Tylko wybrane tier'y</div>
                </div>
                <Switch
                  checked={localSettings.filter_by_tier}
                  onCheckedChange={(checked) => updateLocal("filter_by_tier", checked)}
                />
              </div>

              {localSettings.filter_by_tier && (
                <div className="space-y-2">
                  <Label>Dozwolone Tier'y</Label>
                  <div className="space-y-2">
                    {["Premium", "Standard", "Basic"].map((tier) => (
                      <div key={tier} className="flex items-center space-x-2">
                        <Checkbox
                          id={tier}
                          checked={localSettings.allowed_tiers?.includes(tier)}
                          onCheckedChange={(checked) => {
                            const newTiers = checked
                              ? [...(localSettings.allowed_tiers || []), tier]
                              : (localSettings.allowed_tiers || []).filter((t: string) => t !== tier);
                            updateLocal("allowed_tiers", newTiers);
                          }}
                        />
                        <Label htmlFor={tier} className="cursor-pointer">{tier}</Label>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label>Min Strength (0-1)</Label>
                <Input
                  type="number"
                  step="0.1"
                  min="0"
                  max="1"
                  value={localSettings.min_strength}
                  onChange={(e) => updateLocal("min_strength", parseFloat(e.target.value))}
                />
              </div>
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
