import { format } from "date-fns";
import { pl } from "date-fns/locale";

interface Position {
  id: string;
  symbol: string;
  side: string;
  entry_price: number;
  close_price: number | null;
  quantity: number;
  leverage: number;
  realized_pnl: number | null;
  created_at: string;
  closed_at: string | null;
  close_reason: string | null;
  tp1_filled: boolean | null;
  tp2_filled: boolean | null;
  tp3_filled: boolean | null;
}

export function exportToCSV(positions: Position[], filename: string = "trading-stats") {
  const headers = [
    "Data zamknięcia",
    "Symbol",
    "Strona",
    "Cena wejścia",
    "Cena wyjścia",
    "Wielkość",
    "Dźwignia",
    "PnL",
    "Powód zamknięcia",
    "TP1",
    "TP2",
    "TP3",
    "Czas trwania (min)",
  ];

  const rows = positions.map(p => {
    const duration = p.created_at && p.closed_at
      ? ((new Date(p.closed_at).getTime() - new Date(p.created_at).getTime()) / (1000 * 60)).toFixed(0)
      : "N/A";

    return [
      p.closed_at ? format(new Date(p.closed_at), "yyyy-MM-dd HH:mm:ss", { locale: pl }) : "N/A",
      p.symbol,
      p.side,
      p.entry_price.toFixed(8),
      p.close_price?.toFixed(8) || "N/A",
      p.quantity.toFixed(8),
      p.leverage,
      p.realized_pnl?.toFixed(2) || "N/A",
      p.close_reason || "N/A",
      p.tp1_filled ? "TAK" : "NIE",
      p.tp2_filled ? "TAK" : "NIE",
      p.tp3_filled ? "TAK" : "NIE",
      duration,
    ];
  });

  const csvContent = [
    headers.join(","),
    ...rows.map(row => row.map(cell => `"${cell}"`).join(",")),
  ].join("\n");

  const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}-${format(new Date(), "yyyy-MM-dd")}.csv`);
  link.style.visibility = "hidden";
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}

interface StatsExport {
  summary: {
    totalTrades: number;
    winRate: number;
    totalPnL: number;
    profitFactor: number;
    expectancy: number;
    avgWin: number;
    avgLoss: number;
    maxDrawdown: number;
    largestWin?: number;
    largestLoss?: number;
    avgDurationMinutes?: number;
    bestWinStreak?: number;
    worstLossStreak?: number;
  };
  advancedMetrics?: {
    sharpeRatio: number;
    sortinoRatio: number;
    calmarRatio: number;
    recoveryFactor: number;
    payoffRatio: number;
  };
  bySession?: Array<{
    session: string;
    trades: number;
    wins: number;
    winRate: number;
    avgPnL: number;
    totalPnL: number;
  }>;
  byCloseReason?: Array<{
    reason: string;
    count: number;
    percentage: number;
  }>;
  bySignalStrength?: Array<{
    range: string;
    trades: number;
    winRate: number;
    avgPnL: number;
    totalPnL: number;
  }>;
  byDuration?: Array<{
    range: string;
    trades: number;
    winRate: number;
    avgPnL: number;
    totalPnL: number;
  }>;
  byHour?: Array<{
    hour: number;
    trades: number;
    winRate: number;
    avgPnL: number;
  }>;
  byDayOfWeek?: Array<{
    day: string;
    trades: number;
    winRate: number;
    avgPnL: number;
  }>;
  byLeverage?: Array<{
    leverage: number;
    trades: number;
    winRate: number;
    avgPnL: number;
    totalPnL: number;
  }>;
  bySymbol?: Array<{
    symbol: string;
    trades: number;
    winRate: number;
    pnl: number;
  }>;
  byTier?: Array<{
    tier: string;
    trades: number;
    winRate: number;
    pnl: number;
  }>;
  monthlyData?: Array<{
    month: string;
    totalPnL: number;
    trades: number;
    winRate: number;
  }>;
}

export function exportStatsToCSV(stats: StatsExport, filename: string = "stats-summary") {
  const sections: string[] = [];

  // Summary section
  sections.push("=== PODSUMOWANIE ===");
  sections.push(`Łączna liczba trade'ów,${stats.summary.totalTrades}`);
  sections.push(`Win Rate,${stats.summary.winRate.toFixed(2)}%`);
  sections.push(`Total PnL,$${stats.summary.totalPnL.toFixed(2)}`);
  sections.push(`Profit Factor,${stats.summary.profitFactor.toFixed(2)}`);
  sections.push(`Expectancy,$${stats.summary.expectancy.toFixed(2)}`);
  sections.push(`Średni Win,$${stats.summary.avgWin.toFixed(2)}`);
  sections.push(`Średni Loss,$${stats.summary.avgLoss.toFixed(2)}`);
  sections.push(`Max Drawdown,$${stats.summary.maxDrawdown.toFixed(2)}`);
  if (stats.summary.largestWin !== undefined) {
    sections.push(`Największy Win,$${stats.summary.largestWin.toFixed(2)}`);
  }
  if (stats.summary.largestLoss !== undefined) {
    sections.push(`Największy Loss,$${stats.summary.largestLoss.toFixed(2)}`);
  }
  if (stats.summary.avgDurationMinutes !== undefined) {
    sections.push(`Średni czas trwania,${stats.summary.avgDurationMinutes.toFixed(0)} min`);
  }
  if (stats.summary.bestWinStreak !== undefined) {
    sections.push(`Najlepsza seria Win,${stats.summary.bestWinStreak}`);
  }
  if (stats.summary.worstLossStreak !== undefined) {
    sections.push(`Najgorsza seria Loss,${stats.summary.worstLossStreak}`);
  }
  sections.push("");

  // Advanced Metrics
  if (stats.advancedMetrics) {
    sections.push("=== ZAAWANSOWANE METRYKI ===");
    sections.push(`Sharpe Ratio,${stats.advancedMetrics.sharpeRatio.toFixed(2)}`);
    sections.push(`Sortino Ratio,${stats.advancedMetrics.sortinoRatio.toFixed(2)}`);
    sections.push(`Calmar Ratio,${stats.advancedMetrics.calmarRatio.toFixed(2)}`);
    sections.push(`Recovery Factor,${stats.advancedMetrics.recoveryFactor.toFixed(2)}`);
    sections.push(`Payoff Ratio,${stats.advancedMetrics.payoffRatio.toFixed(2)}`);
    sections.push("");
  }

  // By Session
  if (stats.bySession && stats.bySession.length > 0) {
    sections.push("=== WEDŁUG SESJI ===");
    sections.push("Sesja,Trade'y,Winy,Win Rate,Średni PnL,Total PnL");
    stats.bySession.forEach(s => {
      sections.push(`${s.session},${s.trades},${s.wins},${s.winRate.toFixed(1)}%,$${s.avgPnL.toFixed(2)},$${s.totalPnL.toFixed(2)}`);
    });
    sections.push("");
  }

  // By Close Reason
  if (stats.byCloseReason && stats.byCloseReason.length > 0) {
    sections.push("=== WEDŁUG POWODU ZAMKNIĘCIA ===");
    sections.push("Powód,Liczba,Procent");
    stats.byCloseReason.forEach(r => {
      sections.push(`${r.reason},${r.count},${r.percentage.toFixed(1)}%`);
    });
    sections.push("");
  }

  // By Signal Strength
  if (stats.bySignalStrength && stats.bySignalStrength.length > 0) {
    sections.push("=== WEDŁUG SIŁY SYGNAŁU ===");
    sections.push("Zakres,Trade'y,Win Rate,Średni PnL,Total PnL");
    stats.bySignalStrength.forEach(s => {
      sections.push(`${s.range},${s.trades},${s.winRate.toFixed(1)}%,$${s.avgPnL.toFixed(2)},$${s.totalPnL.toFixed(2)}`);
    });
    sections.push("");
  }

  // By Duration
  if (stats.byDuration && stats.byDuration.length > 0) {
    sections.push("=== WEDŁUG CZASU TRWANIA ===");
    sections.push("Zakres,Trade'y,Win Rate,Średni PnL,Total PnL");
    stats.byDuration.forEach(d => {
      sections.push(`${d.range},${d.trades},${d.winRate.toFixed(1)}%,$${d.avgPnL.toFixed(2)},$${d.totalPnL.toFixed(2)}`);
    });
    sections.push("");
  }

  // By Hour
  if (stats.byHour && stats.byHour.length > 0) {
    sections.push("=== WEDŁUG GODZINY ===");
    sections.push("Godzina,Trade'y,Win Rate,Średni PnL");
    stats.byHour.forEach(h => {
      sections.push(`${h.hour}:00,${h.trades},${h.winRate.toFixed(1)}%,$${h.avgPnL.toFixed(2)}`);
    });
    sections.push("");
  }

  // By Day of Week
  if (stats.byDayOfWeek && stats.byDayOfWeek.length > 0) {
    sections.push("=== WEDŁUG DNIA TYGODNIA ===");
    sections.push("Dzień,Trade'y,Win Rate,Średni PnL");
    stats.byDayOfWeek.forEach(d => {
      sections.push(`${d.day},${d.trades},${d.winRate.toFixed(1)}%,$${d.avgPnL.toFixed(2)}`);
    });
    sections.push("");
  }

  // By Leverage
  if (stats.byLeverage && stats.byLeverage.length > 0) {
    sections.push("=== WEDŁUG DŹWIGNI ===");
    sections.push("Leverage,Trade'y,Win Rate,Średni PnL,Total PnL");
    stats.byLeverage.forEach(l => {
      sections.push(`${l.leverage}x,${l.trades},${l.winRate.toFixed(1)}%,$${l.avgPnL.toFixed(2)},$${l.totalPnL.toFixed(2)}`);
    });
    sections.push("");
  }

  // By Symbol
  if (stats.bySymbol && stats.bySymbol.length > 0) {
    sections.push("=== WEDŁUG SYMBOLU ===");
    sections.push("Symbol,Trade'y,Win Rate,PnL");
    stats.bySymbol.forEach(s => {
      sections.push(`${s.symbol},${s.trades},${s.winRate.toFixed(1)}%,$${s.pnl.toFixed(2)}`);
    });
    sections.push("");
  }

  // By Tier
  if (stats.byTier && stats.byTier.length > 0) {
    sections.push("=== WEDŁUG TIER ===");
    sections.push("Tier,Trade'y,Win Rate,PnL");
    stats.byTier.forEach(t => {
      sections.push(`${t.tier},${t.trades},${t.winRate.toFixed(1)}%,$${t.pnl.toFixed(2)}`);
    });
    sections.push("");
  }

  // Monthly Data
  if (stats.monthlyData && stats.monthlyData.length > 0) {
    sections.push("=== MIESIĘCZNE PORÓWNANIE ===");
    sections.push("Miesiąc,Trade'y,Win Rate,PnL");
    stats.monthlyData.forEach(m => {
      sections.push(`${m.month},${m.trades},${m.winRate.toFixed(1)}%,$${m.totalPnL.toFixed(2)}`);
    });
  }

  const csvContent = sections.join("\n");
  const blob = new Blob(["\ufeff" + csvContent], { type: "text/csv;charset=utf-8;" });
  const link = document.createElement("a");
  const url = URL.createObjectURL(blob);
  
  link.setAttribute("href", url);
  link.setAttribute("download", `${filename}-${format(new Date(), "yyyy-MM-dd")}.csv`);
  link.style.visibility = "hidden";
  
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
}
