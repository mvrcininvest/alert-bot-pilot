import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Copy, CheckCircle2, AlertCircle } from "lucide-react";
import { useState } from "react";
import { Button } from "@/components/ui/button";

export default function Integration() {
  const [copied, setCopied] = useState(false);
  const webhookUrl = "https://aoyqeieqqmpuhfvfzbrb.supabase.co/functions/v1/tradingview-webhook";

  const copyToClipboard = () => {
    navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-3xl font-bold">Integracja TradingView</h1>
        <p className="text-muted-foreground">Instrukcja konfiguracji alertów</p>
      </div>

      <Alert>
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Ważne!</AlertTitle>
        <AlertDescription>
          Przed rozpoczęciem upewnij się, że bot jest aktywny w ustawieniach i wszystkie parametry są skonfigurowane.
        </AlertDescription>
      </Alert>

      <Card>
        <CardHeader>
          <CardTitle>Webhook URL</CardTitle>
          <CardDescription>Użyj tego adresu URL w alertach TradingView</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-2">
            <code className="flex-1 bg-muted p-3 rounded-lg text-sm break-all">
              {webhookUrl}
            </code>
            <Button
              size="icon"
              variant="outline"
              onClick={copyToClipboard}
            >
              {copied ? <CheckCircle2 className="h-4 w-4 text-profit" /> : <Copy className="h-4 w-4" />}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Konfiguracja Alertu w TradingView</CardTitle>
          <CardDescription>Krok po kroku</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Badge>Krok 1</Badge>
            <p className="text-sm">
              W TradingView przejdź do swojego wskaźnika i kliknij "Create Alert"
            </p>
          </div>

          <div className="space-y-2">
            <Badge>Krok 2</Badge>
            <p className="text-sm">
              W sekcji "Notifications" zaznacz opcję "Webhook URL"
            </p>
          </div>

          <div className="space-y-2">
            <Badge>Krok 3</Badge>
            <p className="text-sm">
              Wklej powyższy Webhook URL
            </p>
          </div>

          <div className="space-y-2">
            <Badge>Krok 4</Badge>
            <p className="text-sm">
              W polu "Message" Twój wskaźnik powinien wysyłać JSON w formacie:
            </p>
            <pre className="bg-muted p-4 rounded-lg text-xs overflow-x-auto">
{`{
  "sl": 2.2073190569,
  "atr": 0.0071250931,
  "tp1": 2.2308846215,
  "tp2": 2.2389250931,
  "tp3": 2.2469655646,
  "mode": "Balanced",
  "side": "BUY",
  "tier": "Premium",
  "price": 2.2234,
  "symbol": "XRPUSDT.P",
  "main_tp": 2.2308846215,
  "leverage": 30,
  "strength": 0.431
}`}
            </pre>
          </div>

          <div className="space-y-2">
            <Badge>Krok 5</Badge>
            <p className="text-sm">
              Kliknij "Create" - gotowe! Bot będzie automatycznie odbierał i przetwarzał alerty.
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Wymagane Pola w Alertach</CardTitle>
          <CardDescription>Upewnij się, że Twój wskaźnik wysyła wszystkie te dane</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid gap-3">
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="font-medium">symbol</span>
              <span className="text-sm text-muted-foreground">Para handlowa (np. "XRPUSDT.P")</span>
            </div>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="font-medium">side</span>
              <span className="text-sm text-muted-foreground">"BUY" lub "SELL"</span>
            </div>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="font-medium">price</span>
              <span className="text-sm text-muted-foreground">Cena wejścia</span>
            </div>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="font-medium">sl</span>
              <span className="text-sm text-muted-foreground">Stop Loss</span>
            </div>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="font-medium">main_tp</span>
              <span className="text-sm text-muted-foreground">Główny Take Profit</span>
            </div>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="font-medium">leverage</span>
              <span className="text-sm text-muted-foreground">Dźwignia (np. 30)</span>
            </div>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="font-medium">atr</span>
              <span className="text-sm text-muted-foreground">Average True Range (opcjonalnie)</span>
            </div>
            <div className="flex items-center justify-between border-b border-border pb-2">
              <span className="font-medium">strength</span>
              <span className="text-sm text-muted-foreground">Siła sygnału 0-1 (opcjonalnie)</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="font-medium">tier</span>
              <span className="text-sm text-muted-foreground">Premium/Standard/Basic (opcjonalnie)</span>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Testowanie</CardTitle>
          <CardDescription>Sprawdź czy wszystko działa poprawnie</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm">
            1. Wyślij testowy alert z TradingView
          </p>
          <p className="text-sm">
            2. Sprawdź stronę "Alerty" - nowy alert powinien się pojawić
          </p>
          <p className="text-sm">
            3. Jeśli bot jest aktywny i filtry są OK, pozycja zostanie otwarta automatycznie
          </p>
          <p className="text-sm">
            4. Sprawdź "Otwarte Pozycje" aby zobaczyć nową pozycję
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
