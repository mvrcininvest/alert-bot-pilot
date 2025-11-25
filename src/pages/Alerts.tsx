import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { format } from "date-fns";

export default function Alerts() {
  const { data: alerts, isLoading } = useQuery({
    queryKey: ["alerts"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("alerts")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(100);
      
      if (error) throw error;
      return data || [];
    },
  });

  const getStatusColor = (status: string) => {
    switch (status) {
      case "executed": return "default";
      case "ignored": return "secondary";
      case "error": return "destructive";
      default: return "outline";
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Historia Alertów</h1>
        <p className="text-muted-foreground">Wszystkie alerty otrzymane z TradingView</p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Alerty ({alerts?.length || 0})</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Symbol</TableHead>
                  <TableHead>Side</TableHead>
                  <TableHead>Entry</TableHead>
                  <TableHead>SL</TableHead>
                  <TableHead>TP</TableHead>
                  <TableHead>Tier</TableHead>
                  <TableHead>Strength</TableHead>
                  <TableHead>Leverage</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8">
                      Ładowanie...
                    </TableCell>
                  </TableRow>
                ) : alerts && alerts.length > 0 ? (
                  alerts.map((alert) => (
                    <TableRow key={alert.id}>
                      <TableCell className="text-xs">
                        {format(new Date(alert.created_at), "dd.MM.yyyy HH:mm")}
                      </TableCell>
                      <TableCell className="font-medium">{alert.symbol}</TableCell>
                      <TableCell>
                        <Badge variant={alert.side === "BUY" ? "default" : "destructive"}>
                          {alert.side}
                        </Badge>
                      </TableCell>
                      <TableCell>${Number(alert.entry_price).toFixed(4)}</TableCell>
                      <TableCell className="text-loss">${Number(alert.sl).toFixed(4)}</TableCell>
                      <TableCell className="text-profit">${Number(alert.main_tp).toFixed(4)}</TableCell>
                      <TableCell>
                        <Badge variant="outline">{alert.tier}</Badge>
                      </TableCell>
                      <TableCell>{Number(alert.strength || 0).toFixed(2)}</TableCell>
                      <TableCell>{alert.leverage}x</TableCell>
                      <TableCell>
                        <Badge variant={getStatusColor(alert.status)}>
                          {alert.status}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))
                ) : (
                  <TableRow>
                    <TableCell colSpan={10} className="text-center py-8 text-muted-foreground">
                      Brak alertów
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
