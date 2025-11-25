import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";
import { X } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

export default function Positions() {
  const { toast } = useToast();
  
  const { data: positions, isLoading, refetch } = useQuery({
    queryKey: ["open-positions"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("positions")
        .select("*")
        .eq("status", "open")
        .order("created_at", { ascending: false });
      
      if (error) throw error;
      return data || [];
    },
    refetchInterval: 5000, // Refetch every 5 seconds for live updates
  });

  const handleClosePosition = async (positionId: string) => {
    const confirmed = window.confirm('Czy na pewno chcesz zamknąć tę pozycję?');
    if (!confirmed) return;

    try {
      const { data, error } = await supabase.functions.invoke('close-position', {
        body: { position_id: positionId, reason: 'manual' }
      });

      if (error) throw error;

      toast({
        title: "Pozycja zamknięta",
        description: `PnL: $${data?.realized_pnl?.toFixed(2) || '0.00'}`,
      });

      refetch();
    } catch (error) {
      console.error('Error closing position:', error);
      toast({
        title: "Błąd",
        description: "Nie udało się zamknąć pozycji",
        variant: "destructive",
      });
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold">Otwarte Pozycje</h1>
          <p className="text-muted-foreground">Monitoring aktywnych pozycji tradingowych</p>
        </div>
        <Button 
          variant="destructive" 
          onClick={async () => {
            const confirmed = window.confirm('Czy na pewno chcesz zamknąć WSZYSTKIE pozycje?');
            if (!confirmed) return;
            
            for (const pos of positions || []) {
              await handleClosePosition(pos.id);
            }
          }}
          disabled={!positions || positions.length === 0}
        >
          Zamknij Wszystkie
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Pozycje ({positions?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>Quantity</TableHead>
                  <TableHead>Leverage</TableHead>
                  <TableHead>SL</TableHead>
                  <TableHead>TP1</TableHead>
                  <TableHead>TP2</TableHead>
                  <TableHead>TP3</TableHead>
                  <TableHead>Current Price</TableHead>
                  <TableHead>PnL</TableHead>
                  <TableHead>Czas</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center py-8">
                      Ładowanie...
                    </TableCell>
                  </TableRow>
                ) : positions && positions.length > 0 ? (
                  positions.map((position) => {
                    const pnl = Number(position.unrealized_pnl || 0);
                    const pnlPercent = position.entry_price 
                      ? ((Number(position.current_price || position.entry_price) - Number(position.entry_price)) / Number(position.entry_price)) * 100
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
                        <TableCell>{Number(position.quantity).toFixed(4)}</TableCell>
                        <TableCell>{position.leverage}x</TableCell>
                        <TableCell className="text-loss">${Number(position.sl_price).toFixed(4)}</TableCell>
                        <TableCell className="text-profit">
                          {position.tp1_price ? `$${Number(position.tp1_price).toFixed(4)}` : "-"}
                          {position.tp1_filled && <span className="ml-1">✓</span>}
                        </TableCell>
                        <TableCell className="text-profit">
                          {position.tp2_price ? `$${Number(position.tp2_price).toFixed(4)}` : "-"}
                          {position.tp2_filled && <span className="ml-1">✓</span>}
                        </TableCell>
                        <TableCell className="text-profit">
                          {position.tp3_price ? `$${Number(position.tp3_price).toFixed(4)}` : "-"}
                          {position.tp3_filled && <span className="ml-1">✓</span>}
                        </TableCell>
                        <TableCell>${Number(position.current_price || position.entry_price).toFixed(4)}</TableCell>
                        <TableCell className={pnl >= 0 ? "text-profit font-medium" : "text-loss font-medium"}>
                          ${pnl.toFixed(2)}
                          <div className="text-xs">{pnlPercent.toFixed(2)}%</div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {format(new Date(position.created_at), "dd.MM HH:mm")}
                        </TableCell>
                        <TableCell>
                          <Button
                            size="icon"
                            variant="ghost"
                            onClick={() => handleClosePosition(position.id)}
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={13} className="text-center py-8 text-muted-foreground">
                      Brak otwartych pozycji
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>

      {positions && positions.length > 0 && (
        <div className="grid gap-4 md:grid-cols-3">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Całkowity PnL</CardTitle>
            </CardHeader>
            <CardContent>
              <div className={`text-2xl font-bold ${
                positions.reduce((sum, p) => sum + Number(p.unrealized_pnl || 0), 0) >= 0 
                  ? "text-profit" 
                  : "text-loss"
              }`}>
                ${positions.reduce((sum, p) => sum + Number(p.unrealized_pnl || 0), 0).toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Średnia pozycja</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                ${(positions.reduce((sum, p) => sum + Number(p.unrealized_pnl || 0), 0) / positions.length).toFixed(2)}
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Winning/Losing</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="text-2xl font-bold">
                <span className="text-profit">{positions.filter(p => Number(p.unrealized_pnl || 0) > 0).length}</span>
                {" / "}
                <span className="text-loss">{positions.filter(p => Number(p.unrealized_pnl || 0) < 0).length}</span>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
