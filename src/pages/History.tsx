import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

export default function History() {
  const { data: closedPositions, isLoading } = useQuery({
    queryKey: ["closed-positions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("*")
        .eq("status", "closed")
        .order("closed_at", { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 30000, // Refresh every 30 seconds
  });

  const stats = closedPositions ? {
    totalPnL: closedPositions.reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0),
    winningTrades: closedPositions.filter(p => Number(p.realized_pnl || 0) > 0).length,
    losingTrades: closedPositions.filter(p => Number(p.realized_pnl || 0) < 0).length,
    avgWin: closedPositions.filter(p => Number(p.realized_pnl || 0) > 0).reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0) / closedPositions.filter(p => Number(p.realized_pnl || 0) > 0).length || 0,
    avgLoss: closedPositions.filter(p => Number(p.realized_pnl || 0) < 0).reduce((sum, p) => sum + Number(p.realized_pnl || 0), 0) / closedPositions.filter(p => Number(p.realized_pnl || 0) < 0).length || 0,
  } : null;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Historia Pozycji</h1>
        <p className="text-muted-foreground">Wszystkie zamknięte pozycje</p>
      </div>

      {stats && (
        <div className="grid gap-4 md:grid-cols-5">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Całkowity PnL</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${stats.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                ${stats.totalPnL.toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Winning Trades</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-profit">{stats.winningTrades}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Losing Trades</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-loss">{stats.losingTrades}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Avg Win</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-profit">${stats.avgWin.toFixed(2)}</div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-sm">Avg Loss</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold text-loss">${stats.avgLoss.toFixed(2)}</div>
            </CardContent>
          </Card>
        </div>
      )}

      <Card>
        <CardHeader>
          <CardTitle>Zamknięte Pozycje ({closedPositions?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Close</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>PnL</TableHead>
                  <TableHead>PnL %</TableHead>
                  <TableHead>Powód</TableHead>
                  <TableHead>Otwarcie</TableHead>
                  <TableHead>Zamknięcie</TableHead>
                  <TableHead>Czas trwania</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8">
                      Ładowanie...
                    </TableCell>
                  </TableRow>
                ) : closedPositions && closedPositions.length > 0 ? (
                  closedPositions.map((position) => {
                    const pnl = Number(position.realized_pnl || 0);
                    const pnlPercent = position.entry_price && position.close_price
                      ? ((Number(position.close_price) - Number(position.entry_price)) / Number(position.entry_price)) * 100
                      : 0;
                    
                    const duration = position.closed_at && position.created_at
                      ? Math.floor((new Date(position.closed_at).getTime() - new Date(position.created_at).getTime()) / 1000 / 60)
                      : 0;
                    
                    return (
                      <TableRow key={position.id}>
                        <TableCell className="font-medium">{position.symbol}</TableCell>
                        <TableCell>
                          <Badge variant={position.side === "BUY" ? "default" : "destructive"}>
                            {position.side}
                          </Badge>
                        </TableCell>
                        <TableCell>${Number(position.entry_price).toFixed(4)}</TableCell>
                        <TableCell>${Number(position.close_price).toFixed(4)}</TableCell>
                        <TableCell>{Number(position.quantity).toFixed(4)}</TableCell>
                        <TableCell className={pnl >= 0 ? "text-profit font-medium" : "text-loss font-medium"}>
                          ${pnl.toFixed(2)}
                        </TableCell>
                        <TableCell className={pnlPercent >= 0 ? "text-profit" : "text-loss"}>
                          {pnlPercent.toFixed(2)}%
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline">{position.close_reason || "Unknown"}</Badge>
                        </TableCell>
                        <TableCell className="text-xs">
                          {format(new Date(position.created_at), "dd.MM.yyyy HH:mm")}
                        </TableCell>
                        <TableCell className="text-xs">
                          {position.closed_at ? format(new Date(position.closed_at), "dd.MM.yyyy HH:mm") : "-"}
                        </TableCell>
                        <TableCell className="text-xs">{duration}min</TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={11} className="text-center py-8 text-muted-foreground">
                      Brak zamkniętych pozycji
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
