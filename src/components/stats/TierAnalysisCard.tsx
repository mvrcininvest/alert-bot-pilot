import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Award } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface TierStats {
  tier: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnL: number;
  avgWin: number;
  avgLoss: number;
}

interface TierAnalysisCardProps {
  tierStats: TierStats[];
}

const tierColors: Record<string, string> = {
  Platinum: "bg-purple-500/10 text-purple-500 border-purple-500/20",
  Premium: "bg-blue-500/10 text-blue-500 border-blue-500/20",
  Standard: "bg-green-500/10 text-green-500 border-green-500/20",
  Quick: "bg-orange-500/10 text-orange-500 border-orange-500/20",
};

export function TierAnalysisCard({ tierStats }: TierAnalysisCardProps) {
  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Award className="h-5 w-5 text-primary" />
          Analiza według Tier
        </CardTitle>
      </CardHeader>
      <CardContent>
        {tierStats.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Tier</TableHead>
                  <TableHead className="text-center">Trade'y</TableHead>
                  <TableHead className="text-center">Win Rate</TableHead>
                  <TableHead className="text-right">PnL</TableHead>
                  <TableHead className="text-right">Śr. Win</TableHead>
                  <TableHead className="text-right">Śr. Loss</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tierStats.map((tier) => (
                  <TableRow key={tier.tier}>
                    <TableCell>
                      <Badge variant="outline" className={tierColors[tier.tier] || "bg-muted"}>
                        {tier.tier}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-center font-medium">
                      {tier.trades}
                      <span className="text-xs text-muted-foreground ml-1">
                        ({tier.wins}W/{tier.losses}L)
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={tier.winRate >= 50 ? "text-profit" : "text-loss"}>
                        {tier.winRate.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className={`text-right font-bold ${tier.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                      ${tier.totalPnL.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right text-profit">
                      ${tier.avgWin.toFixed(2)}
                    </TableCell>
                    <TableCell className="text-right text-loss">
                      ${tier.avgLoss.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">Brak danych tier do analizy</p>
        )}
      </CardContent>
    </Card>
  );
}
