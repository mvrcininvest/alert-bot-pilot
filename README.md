# Trading Bot - Zaawansowany System Tradingowy

Profesjonalny bot tradingowy z integracją TradingView i Bitget, z zaawansowanymi kalkulatorami SL/TP, systemami adaptacyjnymi i kompleksowym monitoringiem pozycji.

## 🚀 Funkcje

### Podstawowe
- ✅ **Dashboard** - Przegląd aktywności i statystyk
- ✅ **Odbieranie alertów z TradingView** - Webhook endpoint
- ✅ **Integracja z Bitget API** - Otwieranie/zamykanie pozycji
- ✅ **Historia alertów i pozycji** - Pełna dokumentacja tradów
- ✅ **Zaawansowane statystyki** - Win rate, profit factor, breakdown per pair

### Zarządzanie Pozycjami
- ✅ **3 typy kalkulatorów SL/TP**:
  - Simple Percent (% od entry)
  - Risk:Reward (R:R ratio)
  - ATR-based (dynamiczny)
- ✅ **4 metody Stop Loss**:
  - % od Margin
  - % od Ceny Entry
  - Stała kwota USDT
  - Bazowany na ATR
- ✅ **Multiple Take Profits** (TP1, TP2, TP3)
- ✅ **Breakeven** - Automatyczne przesunięcie SL na entry
- ✅ **Trailing Stop** - Przesuwanie SL wraz z ceną

### Systemy Adaptacyjne
- ✅ **Adaptive TP Spacing** - Dostosowanie odległości TP do zmienności
- ✅ **Momentum-Based TP** - Modyfikacja TP na podstawie siły momentum
- ✅ **Adaptive Risk:Reward** - Dynamiczne R:R według siły sygnału

### Risk Management
- ✅ **Max otwartych pozycji** - Limit jednocześnie otwartych tradów
- ✅ **Dzienny limit strat** - Automatyczne zatrzymanie po przekroczeniu
- ✅ **Filtrowanie po tier** (Premium/Standard/Basic)
- ✅ **Min strength threshold** - Tylko silne sygnały

### Monitoring 24/7
- ✅ **Cron job co minutę** - Automatyczne sprawdzanie pozycji
- ✅ **Wykrywanie rozbieżności** - Quantity, SL, TP verification
- ✅ **Auto-repair** - Automatyczna naprawa problemów
- ✅ **Monitoring logs** - Historia wszystkich sprawdzeń

## 🛠️ Technologie

- **Frontend**: React + TypeScript + Tailwind CSS
- **Backend**: Supabase (PostgreSQL + Edge Functions)
- **Trading**: Bitget API
- **Alerts**: TradingView Webhooks

## 📋 Konfiguracja

### 1. Bitget API Keys
Dodaj swoje klucze API z Bitget jako sekrety w projekcie:
- `BITGET_API_KEY`
- `BITGET_SECRET_KEY`  
- `BITGET_PASSPHRASE`

### 2. TradingView Webhook
Webhook URL: `https://aoyqeieqqmpuhfvfzbrb.supabase.co/functions/v1/tradingview-webhook`

Skonfiguruj alerty w TradingView aby wysyłały JSON w formacie:
```json
{
  "symbol": "XRPUSDT.P",
  "side": "BUY",
  "price": 2.2234,
  "sl": 2.2073190569,
  "tp1": 2.2308846215,
  "tp2": 2.2389250931,
  "tp3": 2.2469655646,
  "main_tp": 2.2308846215,
  "atr": 0.0071250931,
  "leverage": 30,
  "strength": 0.431,
  "tier": "Premium",
  "mode": "Balanced"
}
```

### 3. Ustawienia Bota
Skonfiguruj parametry w zakładce "Ustawienia":
- Position Sizing (fixed USDT / % kapitału)
- SL/TP Calculator (wybór typu i parametry)
- Adaptive Systems (włącz/wyłącz)
- Risk Management (limity)
- Monitoring (interwał, auto-repair)

## 🔧 Edge Functions

### tradingview-webhook
Odbiera alerty z TradingView, waliduje i przetwarza sygnały.

### bitget-trader
Otwiera pozycje na Bitget z obliczonymi SL/TP.

### bitget-api
Helper functions dla komunikacji z Bitget API.

### position-monitor
Cron job - sprawdza wszystkie otwarte pozycje co minutę.

### close-position
Zamyka pozycje i aktualizuje performance metrics.

## 📊 Struktura Bazy Danych

- **alerts** - Historia wszystkich alertów
- **positions** - Otwarte i zamknięte pozycje
- **settings** - Konfiguracja bota
- **performance_metrics** - Agregowane statystyki
- **monitoring_logs** - Logi monitoringu pozycji

## 🎯 Workflow

1. TradingView wysyła alert → **tradingview-webhook**
2. Webhook sprawdza filtry (tier, strength) → **bitget-trader**
3. Trader kalkuluje SL/TP i otwiera pozycję → **Bitget API**
4. Pozycja zapisana w bazie → **positions table**
5. **position-monitor** sprawdza co minutę:
   - Czy quantity się zgadza
   - Czy SL/TP są ustawione
   - Czy ceny są prawidłowe
   - Breakeven / Trailing Stop
6. Po zamknięciu → update **performance_metrics**

## 🔐 Bezpieczeństwo

- Row Level Security (RLS) na wszystkich tabelach
- Secrets w Supabase (nie w kodzie)
- Webhook authentication (opcjonalnie via TRADINGVIEW_WEBHOOK_SECRET)
- Service Role Key tylko w edge functions

## 📈 Development

### Local Setup

```sh
# Clone the repository
git clone <YOUR_GIT_URL>

# Navigate to project
cd <YOUR_PROJECT_NAME>

# Install dependencies
npm i

# Start dev server
npm run dev
```

### Deployment

Simply open [Lovable](https://lovable.dev/projects/80280f0d-d8bb-44de-9233-2d686c4d5d4a) and click on Share -> Publish.

## 🤝 Wsparcie

Bot gotowy do testowania! Skonfiguruj API keys i rozpocznij trading.

**URL projektu**: https://lovable.dev/projects/80280f0d-d8bb-44de-9233-2d686c4d5d4a
