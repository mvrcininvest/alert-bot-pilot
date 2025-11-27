import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Target } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface ZoneStats {
  zoneType: string;
  trades: number;
  wins: number;
  winRate: number;
  avgPnL: number;
  totalPnL: number;
}

interface ZoneTypeCardProps {
  zoneStats: ZoneStats[];
}

const zoneColors: Record<string, string> = {
  "OB": "bg-blue-500/10 text-blue-500 border-blue-500/20",
  "FVG": "bg-purple-500/10 text-purple-500 border-purple-500/20",
  "Breaker": "bg-orange-500/10 text-orange-500 border-orange-500/20",
  "Liquidity": "bg-green-500/10 text-green-500 border-green-500/20",
  "POI": "bg-pink-500/10 text-pink-500 border-pink-500/20",
  "Unknown": "bg-muted text-muted-foreground border-border",
};

export function ZoneTypeCard({ zoneStats }: ZoneTypeCardProps) {
  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Target className="h-5 w-5 text-primary" />
          Zone Type Analysis
        </CardTitle>
      </CardHeader>
      <CardContent>
        {zoneStats.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Typ Zony</TableHead>
                  <TableHead className="text-center">Trade'y</TableHead>
                  <TableHead className="text-center">Win Rate</TableHead>
                  <TableHead className="text-right">Śr. PnL</TableHead>
                  <TableHead className="text-right">Total PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {zoneStats.map((zone) => (
                  <TableRow key={zone.zoneType}>
                    <TableCell>
                      <Badge variant="outline" className={zoneColors[zone.zoneType] || zoneColors.Unknown}>
                        {zone.zoneType}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center font-medium">
                      {zone.trades}
                      <span className="text-xs text-muted-foreground ml-1">
                        ({zone.wins}W)
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={zone.winRate >= 50 ? "text-profit font-semibold" : "text-loss"}>
                        {zone.winRate.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className={`text-right ${zone.avgPnL >= 0 ? "text-profit" : "text-loss"}`}>
                      ${zone.avgPnL.toFixed(2)}
                    </TableCell>
                    <TableCell className={`text-right font-bold ${zone.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                      ${zone.totalPnL.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">Brak danych zone type</p>
        )}
      </CardContent>
    </Card>
  );
}
