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
  };
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
  sections.push("");

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
