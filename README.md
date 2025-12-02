# AristoEdge Trading Bot 🤖⚡

**Profesjonalny system tradingowy z zaawansowanym zarządzaniem ryzykiem, fee-aware calculations i multi-category leverage management**

System łączy alerty z TradingView z automatycznym wykonywaniem na Bitget, oferując sophisticated position sizing, inteligentne kalkulatory SL/TP oraz kompleksowy monitoring 24/7.

---

## 📋 Spis Treści

- [Kluczowe Funkcje](#-kluczowe-funkcje)
- [Scalping Mode](#-scalping-mode-fee-aware-trading)
- [Kategorie Symboli](#-kategorie-symboli)
- [Kalkulatory SL/TP](#-kalkulatory-sltp)
- [Systemy Adaptacyjne](#-systemy-adaptacyjne)
- [Risk Management](#-risk-management)
- [Position Monitoring](#-position-monitoring-247)
- [Admin vs User Settings](#-admin-vs-user-settings)
- [Architektura](#-architektura)
- [Konfiguracja](#-konfiguracja)
- [Deployment](#-deployment)

---

## 🎯 Kluczowe Funkcje

### 🔥 Scalping Mode (Fee-Aware Trading)
- **Maksymalizacja zyskowności** poprzez uwzględnienie opłat transakcyjnych w każdej decyzji
- **Dynamiczne SL%** kalkulowane na podstawie max margin, max loss i leverage
- **Real R:R calculations** - pokazuje rzeczywisty stosunek zysku do ryzyka po opłatach
- **Intelligent Presets** - automatyczne generowanie profitable strategii per kategoria
- **Fee-Aware Breakeven** - przesunięcie SL na breakeven uwzględniające round-trip fees

### 🎨 Multi-Category Management
System automatycznie rozpoznaje kategorię symbolu i stosuje dedykowane limity:

| Kategoria | Symbole | Max Leverage | Use Case |
|-----------|---------|--------------|----------|
| **BTC_ETH** 🟠 | BTCUSDT, ETHUSDT | 150x | Najbardziej płynne, najniższe spread |
| **MAJOR** 🔵 | XRPUSDT, SOLUSDT, BNBUSDT | 100x | Duże cap altcoiny, średnia zmienność |
| **ALTCOIN** 🟢 | Wszystkie pozostałe | 75x | Wyższa zmienność, większe spread |

**Per-category settings:**
- Własne max leverage (w ramach limitu kategorii)
- Dedykowane max margin i max loss
- Osobne strategie TP (tp_levels, tp1/tp2/tp3 R:R, close %)
- Automatyczne override głównych ustawień dla danej kategorii

### 📊 Intelligent Position Sizing

**3 tryby wielkości pozycji:**

1. **Fixed USDT (Notional)** - stała wartość pozycji w USDT
   ```
   Position Size = Fixed Value (np. 100 USDT)
   Margin = Position Size ÷ Leverage
   ```

2. **Percentage of Capital** - % dostępnego kapitału
   ```
   Position Size = Account Balance × Percentage
   Margin = Position Size ÷ Leverage
   ```

3. **Scalping Mode** (Zalecany) - maksymalna kontrola ryzyka
   ```
   Inputs: Max Margin (USDT), Max Loss (USDT), Leverage
   
   Obliczenia:
   1. Notional = Max Margin × Leverage
   2. SL% = Max Loss ÷ Notional (z limitem min/max)
   3. Round-trip fees = Notional × Taker Fee × 2
   4. Real Max Loss = Max Loss + Round-trip fees
   5. TP% = SL% × R:R ratio
   6. Gross Profit = Notional × TP%
   7. Net Profit = Gross Profit - Round-trip fees
   8. Real R:R = Net Profit ÷ Real Max Loss
   
   ✅ Tylko strategie z Real R:R >= 1.0 są profitable!
   ```

### 🧮 Kalkulatory SL/TP

#### 1. **Simple Percent** (Prosty)
Najłatwiejszy do zrozumienia - stałe % od ceny entry:
```
SL = Entry ± (Entry × sl_percent / 100)
TP = Entry ± (Entry × tp_percent / 100)

Przykład (LONG):
Entry: 100 USDT
SL 1.5%: 98.5 USDT
TP 3%: 103 USDT
```

#### 2. **Risk:Reward** (R:R Ratio)
Zaawansowany - definiujesz stosunek zysku do ryzyka:
```
SL Distance = Entry × (sl_margin / (margin × leverage))
TP Distance = SL Distance × rr_ratio

Przykład:
Max Margin: 2 USDT
Max Loss: 1 USDT  
Leverage: 50x
R:R: 1.5:1

SL Distance = 1 ÷ (2 × 50) = 1%
TP Distance = 1% × 1.5 = 1.5%
```

**Multiple TP levels:**
- TP1, TP2, TP3 z osobnymi R:R ratios
- Częściowe zamykanie pozycji (np. 50% na TP1, 30% na TP2, 20% na TP3)
- TP1 close % kontroluje ile pozycji zamykamy na pierwszym TP

#### 3. **ATR-Based** (Dynamiczny)
Bazowany na zmienności rynku (Average True Range):
```
SL = Entry ± (ATR × atr_sl_multiplier)
TP = Entry ± (ATR × atr_tp_multiplier)

Przykład:
ATR = 0.05
SL multiplier: 1.5
TP multiplier: 3.0

SL Distance = 0.05 × 1.5 = 0.075 (7.5%)
TP Distance = 0.05 × 3.0 = 0.150 (15%)
```

### 🔄 Systemy Adaptacyjne

#### Adaptive TP Spacing
Dostosowuje odległość między poziomami TP na podstawie zmienności:
```
Wysoka zmienność (ATR > threshold):
  TP distance × high_volatility_multiplier (np. 1.3)
  
Niska zmienność (ATR < threshold):
  TP distance × low_volatility_multiplier (np. 0.8)
```

#### Momentum-Based TP
Modyfikuje TP na podstawie siły sygnału ze Strength indicator:
```
Słaby sygnał (strength < 0.33):
  TP × weak_multiplier (np. 0.8)
  
Umiarkowany sygnał (0.33 - 0.66):
  TP × moderate_multiplier (np. 1.0)
  
Silny sygnał (strength > 0.66):
  TP × strong_multiplier (np. 1.2)
```

#### Adaptive Risk:Reward
Dostosowuje R:R ratio według siły sygnału:
```
Bardzo silny (strength > 0.75):
  R:R = 2.0:1 (aggressive)
  
Silny (0.50 - 0.75):
  R:R = 1.5:1 (balanced)
  
Standardowy (0.25 - 0.50):
  R:R = 1.2:1 (conservative)
  
Słaby (< 0.25):
  R:R = 1.0:1 lub odrzuć
```

---

## 🛡️ Risk Management

### Max Open Positions
Limit jednocześnie otwartych pozycji (domyślnie 3):
```
✅ 2 pozycje otwarte → Nowa pozycja OK
❌ 3 pozycje otwarte → Nowa pozycja ODRZUCONA
```

### Daily Loss Limit
Dwa typy limitów dziennych strat:

1. **Fixed USDT**
   ```
   Daily Loss Limit: 50 USDT
   Dzisiejsze straty: 45 USDT → Nowa pozycja OK
   Dzisiejsze straty: 52 USDT → Bot ZATRZYMANY do północy
   ```

2. **Percentage of Daily Turnover**
   ```
   Daily Loss %: 5%
   Daily Turnover: 1000 USDT
   Max Loss Today: 50 USDT
   ```

### Tier Filtering
Filtrowanie alertów według poziomu sygnału:
```
Tiers: Premium, Standard, Basic

Allow only: ["Premium", "Standard"]
→ Basic alerts ODRZUCONE

Exclude: ["Basic"]
→ Premium i Standard ZAAKCEPTOWANE
```

### Alert Strength Threshold
Minimalny próg siły sygnału (0-1):
```
Min Strength: 0.25

Alert strength: 0.30 → ✅ ZAAKCEPTOWANY
Alert strength: 0.15 → ❌ ODRZUCONY
```

### Duplicate Alert Handling
Inteligentne zarządzanie wieloma alertami na tym samym symbolu:

**Alert w tym samym kierunku (LONG → LONG):**
```
Słabszy lub < 20 pkt mocniejszy → ❌ Odrzuć
≥ 20 pkt mocniejszy → ✅ Zwiększ pozycję
```

**Alert w przeciwnym kierunku (LONG → SHORT):**
```
Słabszy lub < 20 pkt mocniejszy → ❌ Odrzuć

≥ 20 pkt mocniejszy + pozycja na minusie/break-even:
  → ✅ Zamknij starą i otwórz nową

≥ 20 pkt mocniejszy + pozycja na plusie (>0.5% wartości):
  → ❌ Odrzuć (chroń zysk)
```

### Symbol-Specific Leverage Overrides
Osobna dźwignia dla wybranych symboli:
```
Default Leverage: 50x

Overrides:
  BTCUSDT: 100x
  ETHUSDT: 75x
  DOGEUSDT: 30x
```

---

## 🔍 Position Monitoring 24/7

### Cron Job (co 60s)
Edge function `position-monitor` sprawdza wszystkie otwarte pozycje:

**Weryfikacja:**
1. ✅ Czy quantity się zgadza z Bitget
2. ✅ Czy SL jest ustawiony
3. ✅ Czy wszystkie TP są ustawione
4. ✅ Czy ceny SL/TP są prawidłowe (±1% tolerancja)

### Auto-Repair
Automatyczna naprawa wykrytych problemów:
```
Problem: SL nie jest ustawiony
Action: Ustaw SL według obliczonej ceny

Problem: TP2 quantity nie zgadza się
Action: Anuluj i postaw nowy order

Problem: SL cena się zmieniła
Action: Anuluj stary SL, postaw nowy
```

### Breakeven & Trailing Stop

**Breakeven:**
```
Trigger: TP1 hit
Action: Przesuń SL na Entry (+ fees jeśli fee_aware_breakeven = true)

Fee-Aware Breakeven:
  Entry: 100 USDT
  Round-trip fees: 0.12 USDT (0.12%)
  New SL: 100.12 USDT (break-even po opłatach)
```

**Trailing Stop:**
```
Trigger: Po TP określonym w ustawieniach (np. TP2)
Distance: X% od bieżącej ceny

Przykład (LONG):
  Current Price: 105 USDT
  Trailing Distance: 2%
  Trailing SL: 102.9 USDT (105 - 2%)
  
  Price moves to 110 → SL moves to 107.8 USDT
  Price moves to 108 → SL stays at 107.8 (only moves up)
```

### Monitoring Logs
Każde sprawdzenie zapisywane w `monitoring_logs`:
```json
{
  "check_type": "full_check",
  "status": "issues_found",
  "issues": [
    "SL order missing",
    "TP2 quantity mismatch: expected 0.5, actual 0.4"
  ],
  "actions_taken": "Created SL order, Adjusted TP2",
  "position_id": "xxx",
  "created_at": "2025-11-29T10:30:00Z"
}
```

---

## 👥 Admin vs User Settings

### Settings Architecture

**Admin Settings** (`settings` table):
- Jeden wiersz - globalne ustawienia
- Źródło dla "copy_admin" mode użytkowników
- Kontrola kategorii symboli

**User Settings** (`user_settings` table):
- Jeden wiersz per użytkownik
- Trzy tryby dla różnych sekcji:
  - `money_mode`: "custom" | "copy_admin"
  - `sltp_mode`: "custom" | "copy_admin"  
  - `tier_mode`: "custom" | "copy_admin"

### Copy Admin Mode
Użytkownik może skopiować ustawienia admina dla każdej sekcji osobno:

```typescript
// User Settings
money_mode: "copy_admin"     → Position sizing z admin
sltp_mode: "custom"          → Własne SL/TP settings
tier_mode: "copy_admin"      → Tier filtering z admin

// Backend (getUserSettings) automatycznie:
if (userSettings.money_mode === 'copy_admin') {
  settings.position_sizing_type = adminSettings.position_sizing_type;
  settings.position_size_value = adminSettings.position_size_value;
  settings.max_margin_per_trade = adminSettings.max_margin_per_trade;
  // ... itd
}
```

### Category Settings Override
Kategorie nadpisują główne ustawienia (zarówno admin jak i user):

```typescript
// Główne ustawienia
max_leverage: 50x
max_margin: 2 USDT
tp_levels: 3

// Category settings dla ALTCOIN
category_settings: {
  ALTCOIN: {
    max_leverage: 30,      // Override: 30x zamiast 50x
    max_margin: 1.5,       // Override: 1.5 USDT
    tp_levels: 2,          // Override: 2 TP zamiast 3
    tp1_rr_ratio: 1.2,
    tp1_close_percent: 60
  }
}

// Dla DOGEUSDT (ALTCOIN):
→ Użyte zostanie max_leverage = 30x (category override)
→ Użyte zostanie max_margin = 1.5 USDT (category override)
→ Użyte zostanie tp_levels = 2 (category override)
```

### User Settings Interface
Zakładka "Ustawienia Użytkownika" (`/user-settings`):
- Przełączniki "Kopiuj admin" / "Własne" dla każdej sekcji
- Jeśli "Kopiuj admin" - pokazuje read-only wartości z admin
- Jeśli "Własne" - pełna edycja wszystkich parametrów
- Category settings również z trybem copy/custom

---

## 🏗️ Architektura

### Tech Stack
```
Frontend:  React 18 + TypeScript + Tailwind CSS + Shadcn/ui
Backend:   Supabase (PostgreSQL 15 + Edge Functions)
Trading:   Bitget Futures API v1
Alerts:    TradingView Webhooks
Charts:    Recharts
State:     TanStack Query (React Query)
```

### Database Schema

#### Core Tables

**`alerts`** - Historia wszystkich alertów z TradingView
```sql
id, symbol, side, entry_price, sl, tp1, tp2, tp3, main_tp,
leverage, strength, tier, mode, atr, status, error_message,
created_at, executed_at, latency_ms, latency_webhook_ms,
latency_execution_ms, user_id, position_id, is_test
```

**`positions`** - Otwarte i zamknięte pozycje
```sql
id, symbol, side, entry_price, quantity, leverage, sl_price,
tp1_price, tp2_price, tp3_price, tp1_quantity, tp2_quantity, tp3_quantity,
tp1_filled, tp2_filled, tp3_filled, sl_order_id, tp1_order_id, 
tp2_order_id, tp3_order_id, bitget_order_id, status, close_reason,
close_price, current_price, unrealized_pnl, realized_pnl,
created_at, closed_at, updated_at, last_check_at, check_errors,
last_error, metadata, user_id, alert_id
```

**`metadata`** (jsonb) - Dodatkowe dane pozycji:
- `settings_snapshot`: Pełne ustawienia MM użyte przy otwarciu (position_sizing_type, max_margin_per_trade, max_loss_per_trade, effective_leverage, sl_percent, tp1_rr, etc.)
- `mm_data`: Obliczone dane dla starych pozycji (calculated_margin, symbol_category, margin_bucket, position_sizing_type="legacy_unknown")
- `execution_details`: Szczegóły wykonania trade'a

**`settings`** - Admin settings (global)
```sql
id, bot_active, position_sizing_type, position_size_value,
calculator_type, sl_method, simple_sl_percent, simple_tp_percent,
rr_ratio, tp_strategy, tp_levels, tp1_close_percent, tp1_rr_ratio,
tp2_close_percent, tp2_rr_ratio, tp3_close_percent, tp3_rr_ratio,
max_open_positions, daily_loss_limit, daily_loss_percent,
loss_limit_type, max_loss_per_trade, max_margin_per_trade,
filter_by_tier, allowed_tiers, excluded_tiers, alert_strength_threshold,
default_leverage, use_alert_leverage, use_max_leverage_global,
symbol_leverage_overrides, sl_to_breakeven, breakeven_trigger_tp,
trailing_stop, trailing_stop_distance, trailing_stop_trigger_tp,
adaptive_rr, adaptive_rr_weak_signal, adaptive_rr_standard,
adaptive_rr_strong, adaptive_rr_very_strong, adaptive_tp_spacing,
adaptive_tp_low_volatility_multiplier, adaptive_tp_high_volatility_multiplier,
momentum_based_tp, momentum_weak_multiplier, momentum_moderate_multiplier,
momentum_strong_multiplier, monitor_interval_seconds, auto_repair,
duplicate_alert_handling, require_profit_for_same_direction,
pnl_threshold_percent, sl_percent_min, sl_percent_max, atr_sl_multiplier,
atr_tp_multiplier, atr_tp2_multiplier, atr_tp3_multiplier,
fee_aware_breakeven, category_settings, profile_name,
created_at, updated_at
```

**`user_settings`** - Per-user settings
```sql
id, user_id, bot_active,
money_mode, sltp_mode, tier_mode,
[wszystkie pola z settings],
include_fees_in_calculations, taker_fee_rate, min_profitable_tp_percent,
category_settings, created_at, updated_at
```

**`monitoring_logs`** - Logi monitoringu pozycji
```sql
id, position_id, check_type, status, expected_data, actual_data,
issues, actions_taken, error_message, created_at
```

**`latency_alerts`** - Alerty o wysokim latency
```sql
id, alert_id, user_id, latency_ms, threshold_ms,
acknowledged_at, acknowledged_by, created_at
```

**`bot_logs`** - Szczegółowe logi edge functions
```sql
id, function_name, level, message, metadata,
position_id, alert_id, created_at
```

**`performance_metrics`** - Agregowane statystyki
```sql
id, date, symbol, total_trades, winning_trades, losing_trades,
total_pnl, total_fees, created_at
```

**`profiles`** - User profiles
```sql
id, email, display_name, avatar_url, is_active, is_banned,
ban_reason, banned_at, banned_by, last_seen_at,
notify_position_opened, notify_position_closed, notify_bot_status,
notify_loss_alerts, notify_daily_summary, created_at, updated_at
```

### Database Functions

**`get_money_management_stats()`** - Agreguje statystyki według ustawień MM
- Grupuje po: `position_sizing_type`, `margin_bucket`, `symbol_category`
- Używa `settings_snapshot` (nowe pozycje) lub `mm_data` (legacy)
- Zwraca: count, win_rate, avg_pnl, total_pnl

**`get_tier_stats()`** - Statystyki per tier

**`get_leverage_stats()`** - Statystyki per leverage

**`get_rr_stats()`** - Statystyki per R:R ratio

**`get_margin_bucket_stats()`** - Statystyki per margin bucket

**`get_tp_distribution_stats()`** - Statystyki per close reason

### Edge Functions

#### `tradingview-webhook`
**Odbiera alerty z TradingView**

Flow:
1. Walidacja webhooków (opcjonalnie TRADINGVIEW_WEBHOOK_SECRET)
2. Parsowanie i walidacja JSON payload
3. Sprawdzenie czy bot jest aktywny
4. Sprawdzenie czy user ma API keys
5. Tier filtering (allowed_tiers, excluded_tiers)
6. Strength threshold check
7. Max open positions check
8. Daily loss limit check
9. Duplicate alert handling
10. Zapis do `alerts` table
11. Invoke `bitget-trader`

#### `bitget-trader`
**Wykonuje trade na Bitget**

Flow:
1. Pobranie user settings (getUserSettings)
2. Apply category settings dla symbolu
3. Position sizing calculation
4. Leverage determination (alert/global_max/custom/per-symbol)
5. SL/TP calculation (simple_percent/risk_reward/atr_based)
6. Adaptive systems (adaptive_rr, momentum_tp, adaptive_spacing)
7. Minimum position size check (5 USDT notional dla Bitget)
8. Symbol quantity precision handling
9. Create market order na Bitget
10. Set SL order (stop-loss market)
11. Set TP orders (take-profit market) - 1/2/3 levels
12. Zapis pozycji do `positions` table
13. Link position_id do alert
14. Logging

**Minimum Position Size** (from `minimums.ts`):
```typescript
BTCUSDT, ETHUSDT, wszystkie major: 5 USDT notional minimum
Wszystkie symbole: 5 USDT (Bitget requirement)

adjustPositionSizeToMinimum() automatycznie zwiększa quantity jeśli < 5 USDT
```

#### `bitget-api`
**Helper functions dla Bitget API**

Actions:
- `get_account` - Pobiera saldo i marginy
- `get_positions` - Lista otwartych pozycji
- `set_leverage` - Ustawia dźwignię dla symbolu
- `close_position` - Zamyka pozycję market order
- `cancel_order` - Anuluje pending order
- `place_order` - Tworzy nowy order

Features:
- Signature generation (HMAC-SHA256)
- Timestamp synchronization
- Error handling i retry logic
- Rate limiting protection

#### `position-monitor`
**Cron job - monitoring pozycji co minutę**

Checks:
1. Quantity verification (DB vs Bitget)
2. SL order exists & price correct (±1% tolerance)
3. TP orders exist & prices correct
4. Unrealized PnL update
5. Breakeven logic (after TP trigger)
6. Trailing Stop logic (after TP trigger)

Auto-Repair Actions:
- Recreate missing SL/TP orders
- Update incorrect order prices
- Fix quantity mismatches
- Log all issues & actions

#### `close-position`
**Zamyka pozycję ręcznie lub automatycznie**

Flow:
1. Cancel all pending orders (SL/TP)
2. Close position via market order
3. Get fill price & realized PnL
4. Update `positions` table:
   - status = 'closed'
   - close_reason
   - close_price
   - realized_pnl
   - closed_at
5. Update `performance_metrics` (daily aggregates)

#### `emergency-shutdown`
**Awaryjne zamknięcie wszystkich pozycji**

Use case: Kryzysowa sytuacja, chcesz zamknąć wszystko natychmiast
```
Zamyka wszystkie otwarte pozycje dla user_id
Anuluje wszystkie pending orders
Dezaktywuje bota (bot_active = false)
```

#### Utility Functions

**`import-history`** - Import historii tradów z CSV
**`sync-positions-history`** - Sync pozycji z Bitget
**`repair-history-data`** - Naprawa danych historycznych
**`repair-positions-history`** - Naprawa pozycji
**`link-positions-alerts`** - Linkowanie pozycji do alertów
**`fix-positions-data`** - Fix quantity i PnL
**`recalculate-sltp`** - Przeliczeń SL/TP dla otwartych pozycji
**`repair-mm-data`** - Naprawa danych Money Management dla historycznych pozycji
  - Oblicza i zapisuje `margin_bucket`, `symbol_category` dla starych pozycji
  - Oznacza pozycje bez `settings_snapshot` jako "legacy_unknown"
  - Pozwala włączyć stare pozycje do statystyk MM

---

## 📊 Statystyki i Analytics

### Dashboard
- **Total PnL** - Suma realized PnL ze wszystkich zamkniętych pozycji
- **Win Rate %** - (Winning trades / Total trades) × 100
- **Total Trades** - Liczba wszystkich zamkniętych pozycji
- **Open Positions** - Liczba obecnie otwartych
- **Today's PnL** - PnL z dzisiejszych zamkniętych pozycji
- **Alerts Today** - Liczba odebranych alertów dzisiaj

### Advanced Metrics

**Equity Curve** - Cumulative PnL w czasie
```
X: Data
Y: Skumulowany PnL
Smooth line chart pokazujący wzrost/spadek kapitału
```

**Monthly Comparison** - Breakdown per miesiąc
```
Total Trades | Win Rate | Total PnL | Avg PnL
Porównanie miesiąc do miesiąca
```

**Per-Symbol Breakdown**
```
Symbol | Trades | Win Rate | Avg PnL | Total PnL | Best | Worst
Najlepsze i najgorsze symbole
```

**Close Reason Analysis**
```
Reason        | Count | Win Rate | Avg PnL
TP1           | 45    | 95%      | +2.34
TP2           | 23    | 87%      | +4.12
TP3           | 12    | 75%      | +7.89
SL            | 18    | 0%       | -1.45
Manual        | 5     | 60%      | +0.89
Trailing Stop | 8     | 88%      | +5.23
```

**Leverage Analysis**
```
Leverage | Trades | Win Rate | Avg PnL | Total PnL
10x      | 45     | 82%      | +1.23   | +55.35
25x      | 67     | 78%      | +2.45   | +164.15
50x      | 34     | 71%      | +3.12   | +106.08
100x     | 12     | 58%      | +4.89   | +58.68
```

**Tier Performance**
```
Tier     | Trades | Win Rate | Avg PnL | Total PnL
Premium  | 89     | 87%      | +2.89   | +257.21
Standard | 45     | 76%      | +1.67   | +75.15
Basic    | 23     | 65%      | +0.89   | +20.47
```

**Signal Strength Correlation**
```
Strength Range | Trades | Win Rate | Avg PnL
0.75 - 1.00    | 34     | 91%      | +3.45
0.50 - 0.75    | 56     | 82%      | +2.12
0.25 - 0.50    | 67     | 74%      | +1.34
0.00 - 0.25    | 23     | 58%      | +0.67
```

**R:R Ratio Analysis** (from `get_rr_stats()`)
```
TP1 R:R | Trades | Win Rate | Avg PnL | Total PnL
2.0:1   | 45     | 89%      | +3.12   | +140.40
1.5:1   | 67     | 84%      | +2.34   | +156.78
1.2:1   | 34     | 78%      | +1.67   | +56.78
1.0:1   | 23     | 65%      | +0.89   | +20.47
```

**Duration Analysis**
```
Hold Time      | Trades | Win Rate | Avg PnL
< 1 hour       | 34     | 76%      | +1.23
1-4 hours      | 67     | 82%      | +2.45
4-12 hours     | 45     | 79%      | +2.89
12-24 hours    | 23     | 71%      | +3.12
> 24 hours     | 12     | 58%      | +2.67
```

**Volatility (ATR) Analysis**
```
ATR Range        | Trades | Win Rate | Avg PnL
Low (< 1%)       | 45     | 85%      | +1.89
Medium (1-3%)    | 67     | 79%      | +2.34
High (3-5%)      | 34     | 72%      | +3.12
Very High (> 5%) | 12     | 58%      | +4.56
```

**Session Analysis** (time of day)
```
Session          | Trades | Win Rate | Avg PnL
Asian (00-08)    | 34     | 78%      | +2.12
European (08-16) | 67     | 82%      | +2.45
American (16-24) | 56     | 76%      | +2.23
```

**Mode Analysis**
```
Mode          | Trades | Win Rate | Avg PnL
Aggressive    | 45     | 71%      | +3.45
Balanced      | 89     | 81%      | +2.34
Conservative  | 34     | 87%      | +1.67
Scalping      | 23     | 79%      | +1.23
```

**Money Management Analysis** (from `get_money_management_stats()`)

Statystyki pogrupowane według ustawień money management używanych przy otwarciu pozycji.

**Position Sizing Types**
```
Type              | Trades | Win Rate | Avg PnL | Total PnL
Fixed USDT        | 45     | 78%      | +1.89   | +85.05
Percentage        | 23     | 82%      | +2.12   | +48.76
Scalping Mode     | 67     | 85%      | +2.45   | +164.15
Legacy (Unknown)  | 34     | 72%      | +1.23   | +41.82
```

**Margin Buckets** (tylko dla Scalping Mode)
```
Margin Range | Trades | Win Rate | Avg PnL | Total PnL
<1 USDT      | 34     | 88%      | +1.12   | +38.08
1-2 USDT     | 45     | 84%      | +2.34   | +105.30
2-5 USDT     | 23     | 79%      | +3.12   | +71.76
>5 USDT      | 12     | 71%      | +4.56   | +54.72
```

**Symbol Categories**
```
Category  | Trades | Win Rate | Avg PnL | Total PnL
BTC_ETH   | 45     | 87%      | +3.12   | +140.40
MAJOR     | 67     | 82%      | +2.34   | +156.78
ALTCOIN   | 56     | 76%      | +1.89   | +105.84
```

**Uwaga:** Pozycje z etykietą "Legacy (Unknown)" pochodzą z okresu przed 
implementacją śledzenia MM. Margin i kategoria są obliczone na podstawie danych 
pozycji, ale dokładny typ position sizing nie jest znany.

Uruchom funkcję `repair-mm-data` aby uzupełnić stare pozycje o obliczone dane MM.

---

## 🔧 Konfiguracja

### 1. Supabase Setup

Projekt używa **Lovable Cloud** - Supabase jest już skonfigurowany automatycznie.

**Secrets** (Ustawione via Lovable UI → Cloud → Secrets):
```
BITGET_API_KEY         - API Key z Bitget
BITGET_SECRET_KEY      - Secret Key z Bitget  
BITGET_PASSPHRASE      - Passphrase z Bitget
ENCRYPTION_KEY         - Do szyfrowania user API keys (auto-generated)
TRADINGVIEW_WEBHOOK_SECRET - Opcjonalny webhook auth (dobra praktyka)
```

**Environment Variables** (Auto-set by Lovable):
```
VITE_SUPABASE_URL              - URL projektu Supabase
VITE_SUPABASE_PUBLISHABLE_KEY  - Anon/public key
SUPABASE_SERVICE_ROLE_KEY      - Service role (tylko edge functions)
```

### 2. Bitget API Keys

**Wymagane uprawnienia:**
- ✅ Read (odczyt konta, pozycji)
- ✅ Trade (otwieranie/zamykanie pozycji)
- ❌ Withdraw (NIE - nie potrzebny, ze względów bezpieczeństwa)

**Gdzie dodać:**
1. Admin → Settings → API Keys
2. Lub Settings → Secrets → Add Bitget keys

### 3. TradingView Webhook

**Webhook URL:**
```
https://aoyqeieqqmpuhfvfzbrb.supabase.co/functions/v1/tradingview-webhook
```

**JSON Format** (Message w Alert):
```json
{
  "symbol": "{{ticker}}",
  "side": "BUY",
  "price": {{close}},
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

**Wymagane pola:**
- `symbol` - Ticker symbolu (BTCUSDT, ETHUSDT, etc.)
- `side` - "BUY" lub "SELL"
- `price` - Aktualna cena entry
- `sl` - Stop Loss price
- `main_tp` - Główny Take Profit (zawsze wymagany)

**Opcjonalne:**
- `tp1`, `tp2`, `tp3` - Multiple TP levels
- `atr` - Average True Range (dla ATR-based calculator)
- `leverage` - Dźwignia z alertu (jeśli use_alert_leverage = true)
- `strength` - Siła sygnału 0-1 (dla adaptive systems i filtering)
- `tier` - Premium/Standard/Basic (dla tier filtering)
- `mode` - Aggressive/Balanced/Conservative (dla mode filtering)

**Security (Zalecane):**
Ustaw `TRADINGVIEW_WEBHOOK_SECRET` i dodaj do webhook URL:
```
?secret=YOUR_SECRET_HERE
```

### 4. Admin Settings

**Zakładka "Ogólne":**
- ✅ Bot Active - Włącz/wyłącz przyjmowanie alertów
- Profile Name - Nazwa profilu ustawień

**Zakładka "Pozycje":**
- Position Sizing Type: Fixed USDT / % kapitału / **Scalping Mode**
- Position Size Value (dla Fixed/Percentage)
- Max Margin / Max Loss (dla Scalping Mode)
- SL% Range (min/max dla Scalping Mode)

**Leverage:**
- Use Alert Leverage - Dźwignia z alertu TradingView
- Use Global Max - Max możliwa dla każdego symbolu (150/100/75 wg kategorii)
- Custom - Własna stała dźwignia
- Symbol Overrides - Per-symbol leverage

**Zakładka "SL/TP"** (jeśli nie Scalping Mode):
- Calculator Type: Simple % / Risk:Reward / ATR-based
- SL Method: % Margin / % Entry / Fixed USDT / ATR
- TP Levels: 1 / 2 / 3
- TP Close %: Ile % pozycji zamykać na każdym TP
- R:R Ratios dla każdego TP (Risk:Reward calculator)

**Zakładka "Adaptacyjne":**
- Adaptive R:R - Dostosowanie R:R do signal strength
- Adaptive TP Spacing - TP spacing według zmienności (ATR)
- Momentum-Based TP - TP multipliers według momentum

**Zakładka "Risk Mgmt":**
- Max Open Positions
- Daily Loss Limit (Fixed USDT lub % turnover)
- Tier Filtering (Allowed / Excluded tiers)
- Alert Strength Threshold
- Duplicate Alert Handling
- PnL Threshold (do require profit for same direction)

**Zakładka "Monitoring":**
- Monitor Interval (seconds) - Jak często sprawdzać pozycje (default 60s)
- Auto-Repair - Automatyczna naprawa problemów
- SL to Breakeven - Trigger after TP1/TP2/TP3
- Trailing Stop - Enable + Distance + Trigger after TP

**Zakładka "Kategorie":**
- BTC_ETH Settings (max leverage 150x, margin, loss, TP strategy)
- MAJOR Settings (max leverage 100x, margin, loss, TP strategy)
- ALTCOIN Settings (max leverage 75x, margin, loss, TP strategy)

### 5. User Settings

**URL:** `/user-settings`

Każdy użytkownik ma własne ustawienia z możliwością:
- "Kopiuj admin" - Używaj globalnych admin settings
- "Własne" - Twój własne custom settings

**Można miksować:**
```
Money Management: Kopiuj admin
SL/TP Settings: Własne
Tier Filtering: Kopiuj admin
```

---

## 📱 Frontend Pages

### `/` - Landing/Index
Public landing page, podstawowe info o bocie

### `/auth` - Login/Signup
Supabase Authentication (email/password)

### `/dashboard` - Dashboard
- Overview metrics (PnL, Win Rate, Trades)
- Aktywne pozycje
- Ostatnie alerty
- Quick stats

### `/alerts` - Historia Alertów
- Tabela wszystkich alertów
- Filtry: status, symbol, tier, date range
- Szczegóły każdego alertu
- Latency metrics

### `/history` - Historia Pozycji
- Tabela zamkniętych pozycji
- Filtry: symbol, side, close_reason, date range
- PnL breakdown
- Export do CSV (zawiera sekcję "WEDŁUG MONEY MANAGEMENT" z breakdown per sizing type, margin bucket, symbol category)

### `/stats` - Zaawansowane Statystyki
- Equity Curve
- Monthly Comparison
- Symbol Performance
- Leverage Analysis
- Tier Analysis
- R:R Analysis
- Duration Analysis
- Volatility Analysis
- Session Analysis
- Close Reason Breakdown
- Signal Strength Correlation
- Money Management Analysis (Position Sizing Types, Margin Buckets, Symbol Categories)

### `/admin/settings` - Admin Settings
ADMIN ONLY - Globalne ustawienia bota

### `/user-settings` - User Settings
Per-user settings z copy_admin mode

### `/diagnostics` - Diagnostyka
- Latency alerts
- System health
- Edge function logs
- Error monitoring

### `/logs` - Bot Logs
- Edge function logs (bot_logs table)
- Filtry: level, function_name, date range
- Log details i metadata

### `/profile` - User Profile
- Display name
- Avatar
- Email notifications settings
- Last seen activity

### `/api-keys` - API Keys Management
- Dodawanie/edycja Bitget API keys
- Encryption/Decryption
- Validation status

### `/security` - Security Settings
- Password change
- Two-Factor Authentication (future)
- Active sessions

---

## 🚀 Deployment

### Lovable Cloud (Rekomendowane)

1. **Automatic Deploy:**
   - Każdy commit to GitHub automatycznie deployuje
   - Edge functions deployowane automatycznie
   - Database migrations auto-applied

2. **Manual Publish:**
   - Kliknij "Publish" w Lovable UI
   - Frontend: Instant deploy (< 30s)
   - Backend: Edge functions updated

3. **Custom Domain:**
   - Settings → Domains → Add Custom Domain
   - DNS Configuration (CNAME)
   - SSL Certificate (automatic via Let's Encrypt)

### Self-Hosting (Zaawansowane)

**Requirements:**
- Node.js 18+
- PostgreSQL 15+
- Supabase CLI

**Build:**
```bash
npm install
npm run build
```

**Deploy Frontend:**
```bash
# Vercel
vercel --prod

# Netlify
netlify deploy --prod

# Custom server (nginx/apache)
# Serve ./dist folder
```

**Deploy Backend:**
```bash
# Supabase CLI
supabase login
supabase link --project-ref YOUR_PROJECT_ID
supabase db push
supabase functions deploy
```

**Environment Variables:**
```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=your_anon_key
```

---

## 🔐 Security & Best Practices

### Database Security

**Row Level Security (RLS):**
```sql
-- Wszystkie tabele mają RLS enabled
-- Users widzą tylko swoje dane
-- Admin ma dostęp do wszystkiego

ALTER TABLE positions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users see own positions"
ON positions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Admins see all"
ON positions FOR SELECT
USING (public.has_role(auth.uid(), 'admin'));
```

**Encrypted Secrets:**
- API keys szyfrowane w bazie (AES-256)
- ENCRYPTION_KEY w Supabase Vault
- Nigdy nie logować secrets

**Service Role Key:**
- Tylko w edge functions (server-side)
- Nigdy w frontend code
- Nie commitować do git

### API Security

**Bitget API:**
- Read + Trade permissions (NIE Withdraw!)
- IP Whitelist (opcjonalnie w Bitget)
- Signature verification (HMAC-SHA256)
- Timestamp validation

**TradingView Webhook:**
- HTTPS only
- Secret token validation (zalecane)
- Rate limiting
- IP whitelist (opcjonalnie via Cloudflare)

### Edge Function Security

**Authentication:**
```typescript
// Wszystkie funkcje sprawdzają auth (except webhook)
const { data: { user }, error } = await supabase.auth.getUser(
  req.headers.get('Authorization')?.split('Bearer ')[1]
);

if (!user) {
  return new Response(JSON.stringify({ error: 'Unauthorized' }), {
    status: 401,
    headers: corsHeaders
  });
}
```

**Input Validation:**
```typescript
// Zawsze waliduj input
if (!symbol || !side || !price) {
  return new Response(JSON.stringify({ error: 'Invalid input' }), {
    status: 400
  });
}
```

**Error Handling:**
```typescript
try {
  // ... logic
} catch (error) {
  console.error('Error:', error);
  // NIE zwracaj szczegółów błędu do klienta (security)
  return new Response(JSON.stringify({ error: 'Internal error' }), {
    status: 500
  });
}
```

---

## 🐛 Debugging & Troubleshooting

### Common Issues

**"Position not opened"**
```
Sprawdź:
1. Bot active? (settings.bot_active)
2. User ma API keys?
3. Tier filtering nie odrzuca?
4. Strength threshold spełniony?
5. Max open positions nie przekroczony?
6. Daily loss limit nie przekroczony?
7. Quantity >= 5 USDT (Bitget minimum)?

Debug:
- Sprawdź bot_logs w /logs
- Alert status w /alerts
- Error message w alert
```

**"SL/TP not set"**
```
Możliwe przyczyny:
1. Bitget API error (rate limit?)
2. Nieprawidłowa cena SL/TP (poza dozwolonym %?)
3. Quantity precision error
4. Insufficient margin

Fix:
- Position Monitor auto-repair ustawi brakujące orders
- Lub ręcznie via /history → position details → Repair
```

**"High latency alerts"**
```
Latency > 30s to problem!

Sprawdź:
1. TradingView → Supabase latency (webhook_latency_ms)
2. Supabase → Bitget latency (execution_latency_ms)

Fix:
- Może być Bitget API przeciążenie (peak hours)
- Może być problem z Supabase edge functions (cold start)
- Może być zbyt wolny internet TradingView servera
```

**"Duplicate positions"**
```
Duplikaty to feature, nie bug!

Duplicate Alert Handling kontroluje:
- Czy dodać do pozycji (same direction, stronger signal)
- Czy zamknąć i odwrócić (opposite direction, stronger signal)
- Czy odrzucić (protect profit, weak signal)

Wyłącz: settings.duplicate_alert_handling = false
```

### Logs & Monitoring

**Edge Function Logs:**
```
Lovable UI → Cloud → Edge Functions → [function name] → Logs
Lub /logs page (bot_logs table)
```

**Database Logs:**
```sql
-- Recent errors
SELECT * FROM bot_logs 
WHERE level = 'error' 
ORDER BY created_at DESC 
LIMIT 50;

-- Monitoring issues
SELECT * FROM monitoring_logs 
WHERE status != 'ok'
ORDER BY created_at DESC;
```

**Latency Monitoring:**
```sql
-- High latency alerts
SELECT * FROM latency_alerts 
WHERE acknowledged_at IS NULL
ORDER BY latency_ms DESC;

-- Average latencies
SELECT 
  AVG(latency_webhook_ms) as avg_webhook,
  AVG(latency_execution_ms) as avg_execution,
  AVG(latency_ms) as avg_total
FROM alerts
WHERE created_at > NOW() - INTERVAL '7 days';
```

---

## 📚 Resources

### Documentation
- [Lovable Docs](https://docs.lovable.dev)
- [Supabase Docs](https://supabase.com/docs)
- [Bitget API Docs](https://www.bitget.com/api-doc)
- [TradingView Webhooks](https://www.tradingview.com/support/solutions/43000529348-about-webhooks/)

### Code Structure
```
/
├── src/
│   ├── components/          # React components
│   │   ├── ui/              # Shadcn components
│   │   ├── stats/           # Statistics charts
│   │   ├── settings/        # Settings forms
│   │   └── admin/           # Admin components
│   ├── pages/               # Route pages
│   ├── hooks/               # Custom hooks
│   ├── lib/                 # Utilities
│   └── integrations/
│       └── supabase/        # Supabase client & types
├── supabase/
│   ├── functions/           # Edge functions
│   │   ├── tradingview-webhook/
│   │   ├── bitget-trader/
│   │   ├── bitget-api/
│   │   ├── position-monitor/
│   │   └── ...
│   ├── migrations/          # Database migrations
│   └── config.toml          # Supabase config
└── public/                  # Static assets
```

### License
MIT License - Free to use and modify

### Support
Masz pytania? Issues? Feature requests?
- GitHub Issues
- Discord Community
- Email: support@aristoedge.com

---

## 🎉 Getting Started

### Quick Start (5 minut)

1. **Clone & Install**
```bash
git clone <your-repo-url>
cd <project-name>
npm install
```

2. **Dodaj Bitget API Keys**
```
Admin → Settings → API Keys
Lub via Lovable UI → Secrets
```

3. **Skonfiguruj TradingView Alert**
```
Webhook URL: https://aoyqeieqqmpuhfvfzbrb.supabase.co/functions/v1/tradingview-webhook
Message: [JSON format z powyżej]
```

4. **Włącz Bota**
```
Admin → Settings → Bot Active = ON
```

5. **Test Alert**
```
Wyślij test alert z TradingView
Sprawdź /alerts czy przyszedł
Sprawdź /history czy pozycja otwarta
```

**GOTOWE! Bot działa! 🚀**

---

## 🔮 Roadmap

### V2.0 (Planned)
- [ ] Machine Learning signal filtering
- [ ] Multi-exchange support (Binance, OKX, Bybit)
- [ ] Backtesting engine
- [ ] Strategy optimizer (genetic algorithms)
- [ ] Mobile app (React Native)
- [ ] Advanced risk management (Kelly Criterion, etc.)
- [ ] Portfolio management (multi-account)
- [ ] Social trading (copy trading)
- [ ] Telegram notifications
- [ ] Discord bot integration

### V1.5 (In Progress)
- [x] Scalping Mode fee-aware calculations
- [x] Category-specific settings (BTC_ETH/MAJOR/ALTCOIN)
- [x] Real R:R calculations
- [x] Intelligent presets generator
- [ ] Advanced backtesting UI
- [ ] Strategy comparison tool
- [ ] Performance attribution analysis

---

**Built with ❤️ by AristoEdge Team**

*Happy Trading! 📈*
