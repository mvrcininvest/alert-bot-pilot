import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Wallet, TrendingUp, TrendingDown, Layers, Target } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface MMStats {
  position_sizing_type: string;
  count: number;
  win_rate: number;
  avg_pnl: number;
  total_pnl: number;
  margin_bucket?: string;
  symbol_category?: string;
}

interface MoneyManagementAnalysisProps {
  stats: MMStats[];
}

export function MoneyManagementAnalysisCard({ stats }: MoneyManagementAnalysisProps) {
  if (!stats || stats.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-5 w-5" />
            Money Management
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Brak danych do analizy</p>
        </CardContent>
      </Card>
    );
  }

  // Group by position_sizing_type
  const typesMap = new Map<string, MMStats[]>();
  stats.forEach(stat => {
    if (!typesMap.has(stat.position_sizing_type)) {
      typesMap.set(stat.position_sizing_type, []);
    }
    typesMap.get(stat.position_sizing_type)!.push(stat);
  });

  // Aggregate by type
  const typeAggregates = Array.from(typesMap.entries()).map(([type, items]) => {
    const totalTrades = items.reduce((sum, i) => sum + i.count, 0);
    const totalPnL = items.reduce((sum, i) => sum + i.total_pnl, 0);
    const avgWinRate = items.reduce((sum, i) => sum + (i.win_rate * i.count), 0) / totalTrades;
    
    return {
      type,
      trades: totalTrades,
      winRate: avgWinRate,
      totalPnL,
      avgPnL: totalPnL / totalTrades,
      items
    };
  }).sort((a, b) => b.totalPnL - a.totalPnL);

  const getTypeLabel = (type: string): string => {
    switch(type) {
      case 'fixed_usdt': return 'Fixed USDT';
      case 'percent': return 'Percentage';
      case 'scalping_mode': return 'Scalping Mode';
      case 'legacy_unknown': return 'Legacy (Unknown)';
      default: return type;
    }
  };

  const getTypeColor = (type: string): string => {
    switch(type) {
      case 'fixed_usdt': return 'bg-blue-500/10 text-blue-700 dark:text-blue-400';
      case 'percent': return 'bg-purple-500/10 text-purple-700 dark:text-purple-400';
      case 'scalping_mode': return 'bg-green-500/10 text-green-700 dark:text-green-400';
      case 'legacy_unknown': return 'bg-gray-500/10 text-gray-700 dark:text-gray-400';
      default: return 'bg-primary/10 text-primary';
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Wallet className="h-5 w-5" />
          Money Management Analysis
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        {/* Summary by Position Sizing Type */}
        <div>
          <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <Layers className="h-4 w-4" />
            Position Sizing Types
          </h3>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Trades</TableHead>
                <TableHead className="text-right">Win Rate</TableHead>
                <TableHead className="text-right">Avg PnL</TableHead>
                <TableHead className="text-right">Total PnL</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {typeAggregates.map((agg) => (
                <TableRow key={agg.type}>
                  <TableCell>
                    <Badge variant="outline" className={getTypeColor(agg.type)}>
                      {getTypeLabel(agg.type)}
                    </Badge>
                  </TableCell>
                  <TableCell className="text-right font-medium">{agg.trades}</TableCell>
                  <TableCell className="text-right">
                    <span className={agg.winRate >= 50 ? "text-success" : "text-destructive"}>
                      {agg.winRate.toFixed(1)}%
                    </span>
                  </TableCell>
                  <TableCell className="text-right">
                    <span className={agg.avgPnL >= 0 ? "text-success" : "text-destructive"}>
                      {agg.avgPnL >= 0 ? '+' : ''}{agg.avgPnL.toFixed(2)} USDT
                    </span>
                  </TableCell>
                  <TableCell className="text-right font-semibold">
                    <span className={agg.totalPnL >= 0 ? "text-success" : "text-destructive"}>
                      {agg.totalPnL >= 0 ? '+' : ''}{agg.totalPnL.toFixed(2)} USDT
                    </span>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Margin Buckets Analysis (for scalping_mode) */}
        {(() => {
          const scalpingStats = stats.filter(s => 
            s.position_sizing_type === 'scalping_mode' && s.margin_bucket
          );
          
          if (scalpingStats.length === 0) return null;

          return (
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Target className="h-4 w-4" />
                Scalping Mode - Margin Ranges
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Margin</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">Win Rate</TableHead>
                    <TableHead className="text-right">Avg PnL</TableHead>
                    <TableHead className="text-right">Total PnL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {scalpingStats.map((stat) => (
                    <TableRow key={`${stat.position_sizing_type}-${stat.margin_bucket}`}>
                      <TableCell>
                        <Badge variant="outline">
                          {stat.margin_bucket} USDT
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">{stat.count}</TableCell>
                      <TableCell className="text-right">
                        <span className={stat.win_rate >= 50 ? "text-success" : "text-destructive"}>
                          {stat.win_rate.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={stat.avg_pnl >= 0 ? "text-success" : "text-destructive"}>
                          {stat.avg_pnl >= 0 ? '+' : ''}{stat.avg_pnl.toFixed(2)} USDT
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        <span className={stat.total_pnl >= 0 ? "text-success" : "text-destructive"}>
                          {stat.total_pnl >= 0 ? '+' : ''}{stat.total_pnl.toFixed(2)} USDT
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          );
        })()}

        {/* Symbol Categories */}
        {(() => {
          const categoryStats = stats.filter(s => s.symbol_category);
          
          if (categoryStats.length === 0) return null;

          // Aggregate by category
          const categoryMap = new Map<string, { count: number; total_pnl: number; wins: number }>();
          categoryStats.forEach(stat => {
            const cat = stat.symbol_category!;
            if (!categoryMap.has(cat)) {
              categoryMap.set(cat, { count: 0, total_pnl: 0, wins: 0 });
            }
            const agg = categoryMap.get(cat)!;
            agg.count += stat.count;
            agg.total_pnl += stat.total_pnl;
            agg.wins += (stat.win_rate / 100) * stat.count;
          });

          const categoryAggregates = Array.from(categoryMap.entries())
            .map(([cat, data]) => ({
              category: cat,
              trades: data.count,
              winRate: (data.wins / data.count) * 100,
              totalPnL: data.total_pnl,
              avgPnL: data.total_pnl / data.count
            }))
            .sort((a, b) => b.totalPnL - a.totalPnL);

          return (
            <div>
              <h3 className="text-sm font-semibold mb-3 flex items-center gap-2">
                <Layers className="h-4 w-4" />
                Symbol Categories
              </h3>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Category</TableHead>
                    <TableHead className="text-right">Trades</TableHead>
                    <TableHead className="text-right">Win Rate</TableHead>
                    <TableHead className="text-right">Avg PnL</TableHead>
                    <TableHead className="text-right">Total PnL</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {categoryAggregates.map((cat) => (
                    <TableRow key={cat.category}>
                      <TableCell>
                        <Badge variant="outline" className="bg-primary/10">
                          {cat.category}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-medium">{cat.trades}</TableCell>
                      <TableCell className="text-right">
                        <span className={cat.winRate >= 50 ? "text-success" : "text-destructive"}>
                          {cat.winRate.toFixed(1)}%
                        </span>
                      </TableCell>
                      <TableCell className="text-right">
                        <span className={cat.avgPnL >= 0 ? "text-success" : "text-destructive"}>
                          {cat.avgPnL >= 0 ? '+' : ''}{cat.avgPnL.toFixed(2)} USDT
                        </span>
                      </TableCell>
                      <TableCell className="text-right font-semibold">
                        <span className={cat.totalPnL >= 0 ? "text-success" : "text-destructive"}>
                          {cat.totalPnL >= 0 ? '+' : ''}{cat.totalPnL.toFixed(2)} USDT
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          );
        })()}

        {/* Info about legacy data */}
        {stats.some(s => s.position_sizing_type === 'legacy_unknown') && (
          <div className="text-xs text-muted-foreground bg-muted/50 p-3 rounded-lg">
            <p className="font-semibold mb-1">ℹ️ Legacy Data</p>
            <p>
              Pozycje oznaczone jako "Legacy (Unknown)" pochodzą z okresu przed implementacją 
              śledzenia ustawień MM. Margin i kategoria symbolu są obliczone na podstawie 
              danych pozycji, ale dokładny typ position sizing nie jest znany.
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
