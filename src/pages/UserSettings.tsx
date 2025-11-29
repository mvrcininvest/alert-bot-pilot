import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { Separator } from "@/components/ui/separator";
import { useState, useEffect } from "react";
import { Settings as SettingsIcon, Copy, User } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FeeCalculator } from "@/components/settings/FeeCalculator";

export default function UserSettings() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const [localSettings, setLocalSettings] = useState<any>(null);

  // Fetch user settings from user_settings table
  const { data: userSettings, isLoading } = useQuery({
    queryKey: ["user_settings", user?.id],
    queryFn: async () => {
      if (!user?.id) throw new Error("User not authenticated");
      
      const { data, error } = await supabase
        .from("user_settings")
        .select("*")
        .eq("user_id", user.id)
        .single();
      
      if (error) {
        // If no settings exist, create default ones
        if (error.code === 'PGRST116') {
          const { data: newSettings, error: insertError } = await supabase
            .from("user_settings")
            .insert({
              user_id: user.id,
              money_mode: 'copy_admin',
              sltp_mode: 'copy_admin',
              tier_mode: 'copy_admin',
            })
            .select()
            .single();
          
          if (insertError) throw insertError;
          return newSettings;
        }
        throw error;
      }
      
      return data;
    },
    enabled: !!user?.id,
  });

  useEffect(() => {
    if (userSettings) {
      setLocalSettings(userSettings);
    }
  }, [userSettings]);

  const updateSettingsMutation = useMutation({
    mutationFn: async (updates: any) => {
      if (!user?.id) throw new Error("User not authenticated");
      
      const { error } = await supabase
        .from("user_settings")
        .update(updates)
        .eq("user_id", user.id);
      
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user_settings"] });
      toast({ title: "Zapisano", description: "Ustawienia zostały zaktualizowane" });
    },
    onError: () => {
      toast({ title: "Błąd", description: "Nie udało się zapisać ustawień", variant: "destructive" });
    },
  });

  const handleSave = () => {
    if (!localSettings) return;

    // Validate fee settings if in custom mode
    if (localSettings.money_mode === 'custom' && localSettings.include_fees_in_calculations) {
      const margin = localSettings.max_margin_per_trade || 2;
      const leverage = localSettings.default_leverage || 10;
      const maxLoss = localSettings.max_loss_per_trade || 1;
      const feeRate = localSettings.taker_fee_rate || 0.06;
      const tp1RrRatio = localSettings.tp1_rr_ratio || 1.5;

      const notional = margin * leverage;
      const roundTripFees = notional * (feeRate * 2) / 100;
      const realMaxLoss = maxLoss + roundTripFees;
      const grossProfit = maxLoss * tp1RrRatio;
      const netProfit = grossProfit - roundTripFees;
      const realRR = netProfit / realMaxLoss;

      if (realRR < 1) {
        toast({
          title: "⚠️ Ostrzeżenie o niskim R:R",
          description: `Twój TP1 ma Real R:R ${realRR.toFixed(2)}:1 (mniej niż 1:1). Zalecamy zwiększenie R:R ratio lub margin przed zapisem.`,
          variant: "destructive",
        });
        // Still allow saving, but warn user
      }
    }

    updateSettingsMutation.mutate(localSettings);
  };

  const updateLocal = (key: string, value: any) => {
    setLocalSettings((prev: any) => ({ ...prev, [key]: value }));
  };

  if (isLoading || !localSettings) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <div className="text-muted-foreground">Ładowanie ustawień...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Moje Ustawienia</h1>
          <p className="text-muted-foreground">Konfiguracja Twojego bota tradingowego</p>
        </div>
        <Button onClick={handleSave}>Zapisz Zmiany</Button>
      </div>

      {/* Bot Active Switch */}
      <Card>
        <CardHeader>
          <CardTitle>Kontrola Bota</CardTitle>
          <CardDescription>Włącz/wyłącz automatyczne otwieranie pozycji</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label>Bot Aktywny</Label>
              <div className="text-sm text-muted-foreground">
                {localSettings.bot_active ? "Bot aktywnie handluje" : "Bot wstrzymany"}
              </div>
            </div>
            <Switch
              checked={localSettings.bot_active ?? true}
              onCheckedChange={(checked) => updateLocal("bot_active", checked)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Money Management Mode */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5" />
            Money Management
          </CardTitle>
          <CardDescription>
            Wielkość pozycji, dźwignia i limity ryzyka
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={localSettings.money_mode || 'copy_admin'}
            onValueChange={(value) => updateLocal("money_mode", value)}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="copy_admin" id="money-copy" />
              <Label htmlFor="money-copy" className="flex items-center gap-2 cursor-pointer">
                <Copy className="h-4 w-4" />
                Kopiuj ustawienia admina
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="custom" id="money-own" />
              <Label htmlFor="money-own" className="flex items-center gap-2 cursor-pointer">
                <User className="h-4 w-4" />
                Własne ustawienia
              </Label>
            </div>
          </RadioGroup>

          {localSettings.money_mode === 'copy_admin' && (
            <Alert>
              <Copy className="h-4 w-4" />
              <AlertDescription>
                Kopiujesz ustawienia money management od administratora. Bot będzie używał tych samych wartości co admin.
              </AlertDescription>
            </Alert>
          )}

          {localSettings.money_mode === 'custom' && (
            <div className="space-y-4 pt-4 border-t">
              <div className="space-y-2">
                <Label>Typ pozycji</Label>
                <RadioGroup
                  value={localSettings.position_sizing_type || 'fixed_usdt'}
                  onValueChange={(value) => updateLocal("position_sizing_type", value)}
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="fixed_usdt" id="sizing-fixed" />
                    <Label htmlFor="sizing-fixed" className="cursor-pointer">Stała kwota USDT</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="percent_balance" id="sizing-percent" />
                    <Label htmlFor="sizing-percent" className="cursor-pointer">% kapitału</Label>
                  </div>
                </RadioGroup>
              </div>

              <div className="space-y-2">
                <Label>Wartość pozycji</Label>
                <Input
                  type="number"
                  value={localSettings.position_size_value || 100}
                  onChange={(e) => updateLocal("position_size_value", parseFloat(e.target.value))}
                />
                <p className="text-sm text-muted-foreground">
                  {localSettings.position_sizing_type === 'fixed_usdt' 
                    ? "Wartość notional pozycji w USDT" 
                    : "Procent kapitału na transakcję"}
                </p>
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Domyślna dźwignia</Label>
                <Input
                  type="number"
                  value={localSettings.default_leverage || 10}
                  onChange={(e) => updateLocal("default_leverage", parseInt(e.target.value))}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Użyj dźwigni z alertu</Label>
                  <div className="text-sm text-muted-foreground">
                    Priorytet dla dźwigni z TradingView
                  </div>
                </div>
                <Switch
                  checked={localSettings.use_alert_leverage ?? true}
                  onCheckedChange={(checked) => updateLocal("use_alert_leverage", checked)}
                />
              </div>

              <Separator />

              <div className="space-y-2">
                <Label>Maksymalna liczba otwartych pozycji</Label>
                <Input
                  type="number"
                  value={localSettings.max_open_positions || 3}
                  onChange={(e) => updateLocal("max_open_positions", parseInt(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label>Dzienny limit straty (USDT)</Label>
                <Input
                  type="number"
                  value={localSettings.daily_loss_limit || 500}
                  onChange={(e) => updateLocal("daily_loss_limit", parseFloat(e.target.value))}
                />
              </div>
            </div>
          )}

        </CardContent>
      </Card>

      {/* Fee Calculator - Always visible */}
      <FeeCalculator
        margin={localSettings.max_margin_per_trade || 2}
        leverage={localSettings.default_leverage || 10}
        maxLoss={localSettings.max_loss_per_trade || 1}
        tp1RrRatio={localSettings.tp1_rr_ratio || 1.5}
        tp2RrRatio={localSettings.tp2_rr_ratio || 2.5}
        tp3RrRatio={localSettings.tp3_rr_ratio || 3.5}
        tpLevels={localSettings.tp_levels || 1}
        feeAwareBreakeven={localSettings.fee_aware_breakeven ?? true}
        accountBalance={100}
        onMarginChange={localSettings.money_mode !== 'copy_admin' ? (value) => updateLocal("max_margin_per_trade", value) : undefined}
        onLeverageChange={localSettings.money_mode !== 'copy_admin' ? (value) => updateLocal("default_leverage", value) : undefined}
        onMaxLossChange={localSettings.money_mode !== 'copy_admin' ? (value) => updateLocal("max_loss_per_trade", value) : undefined}
        onTP1RRChange={localSettings.money_mode !== 'copy_admin' ? (value) => updateLocal("tp1_rr_ratio", value) : undefined}
        onTP2RRChange={localSettings.money_mode !== 'copy_admin' ? (value) => updateLocal("tp2_rr_ratio", value) : undefined}
        onTP3RRChange={localSettings.money_mode !== 'copy_admin' ? (value) => updateLocal("tp3_rr_ratio", value) : undefined}
        onTPLevelsChange={localSettings.sltp_mode !== 'copy_admin' ? (value) => updateLocal("tp_levels", value) : undefined}
        onFeeAwareBreakevenChange={localSettings.sltp_mode !== 'copy_admin' ? (value) => updateLocal("fee_aware_breakeven", value) : undefined}
        onAccountBalanceChange={() => {}}
      />

      {/* SL/TP Mode */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5" />
            Kalkulator SL/TP
          </CardTitle>
          <CardDescription>
            Stop Loss i Take Profit strategie
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={localSettings.sltp_mode || 'copy_admin'}
            onValueChange={(value) => updateLocal("sltp_mode", value)}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="copy_admin" id="sltp-copy" />
              <Label htmlFor="sltp-copy" className="flex items-center gap-2 cursor-pointer">
                <Copy className="h-4 w-4" />
                Kopiuj ustawienia admina
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="custom" id="sltp-own" />
              <Label htmlFor="sltp-own" className="flex items-center gap-2 cursor-pointer">
                <User className="h-4 w-4" />
                Własne ustawienia
              </Label>
            </div>
          </RadioGroup>

          {localSettings.sltp_mode === 'copy_admin' && (
            <Alert>
              <Copy className="h-4 w-4" />
              <AlertDescription>
                Kopiujesz ustawienia SL/TP od administratora. Bot będzie używał tych samych kalkulacji co admin.
              </AlertDescription>
            </Alert>
          )}

          {localSettings.sltp_mode === 'custom' && (
            <div className="space-y-4 pt-4 border-t">
              <Alert>
                <AlertDescription>
                  Podstawowe ustawienia SL/TP. Dla zaawansowanych opcji skontaktuj się z administratorem.
                </AlertDescription>
              </Alert>
              
              <div className="space-y-2">
                <Label>Stop Loss (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={localSettings.simple_sl_percent || 1.5}
                  onChange={(e) => updateLocal("simple_sl_percent", parseFloat(e.target.value))}
                />
              </div>

              <div className="space-y-2">
                <Label>Take Profit (%)</Label>
                <Input
                  type="number"
                  step="0.1"
                  value={localSettings.simple_tp_percent || 3.0}
                  onChange={(e) => updateLocal("simple_tp_percent", parseFloat(e.target.value))}
                />
              </div>

              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Breakeven po TP1</Label>
                  <div className="text-sm text-muted-foreground">
                    Przenieś SL na breakeven po pierwszym TP
                  </div>
                </div>
                <Switch
                  checked={localSettings.sl_to_breakeven ?? true}
                  onCheckedChange={(checked) => updateLocal("sl_to_breakeven", checked)}
                />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Tier Filtering Mode */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <SettingsIcon className="h-5 w-5" />
            Filtrowanie Tier
          </CardTitle>
          <CardDescription>
            Które tier alertów bot powinien akceptować
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <RadioGroup
            value={localSettings.tier_mode || 'copy_admin'}
            onValueChange={(value) => updateLocal("tier_mode", value)}
          >
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="copy_admin" id="tier-copy" />
              <Label htmlFor="tier-copy" className="flex items-center gap-2 cursor-pointer">
                <Copy className="h-4 w-4" />
                Kopiuj ustawienia admina
              </Label>
            </div>
            <div className="flex items-center space-x-2">
              <RadioGroupItem value="custom" id="tier-own" />
              <Label htmlFor="tier-own" className="flex items-center gap-2 cursor-pointer">
                <User className="h-4 w-4" />
                Własne ustawienia
              </Label>
            </div>
          </RadioGroup>

          {localSettings.tier_mode === 'copy_admin' && (
            <Alert>
              <Copy className="h-4 w-4" />
              <AlertDescription>
                Kopiujesz filtrowanie tier od administratora. Bot będzie akceptował te same tier co admin.
              </AlertDescription>
            </Alert>
          )}

          {localSettings.tier_mode === 'custom' && (
            <div className="space-y-4 pt-4 border-t">
              <div className="flex items-center justify-between">
                <div className="space-y-0.5">
                  <Label>Włącz filtrowanie tier</Label>
                  <div className="text-sm text-muted-foreground">
                    Bot będzie odrzucał alerty poza wybranymi tier
                  </div>
                </div>
                <Switch
                  checked={localSettings.filter_by_tier ?? false}
                  onCheckedChange={(checked) => updateLocal("filter_by_tier", checked)}
                />
              </div>

              {localSettings.filter_by_tier && (
                <Alert>
                  <AlertDescription>
                    Skonfiguruj dozwolone tier w zaawansowanych ustawieniach. Dostępne: Platinum, Premium, Standard, Quick.
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
