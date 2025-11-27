import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Clock } from "lucide-react";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";

interface SessionStats {
  session: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  totalPnL: number;
  avgPnL: number;
}

interface SessionAnalysisCardProps {
  sessionStats: SessionStats[];
}

const sessionColors: Record<string, string> = {
  "Asia": "bg-orange-500/10 text-orange-500 border-orange-500/20",
  "London": "bg-blue-500/10 text-blue-500 border-blue-500/20",
  "NY": "bg-green-500/10 text-green-500 border-green-500/20",
  "Unknown": "bg-muted text-muted-foreground border-border",
};

const sessionEmoji: Record<string, string> = {
  "Asia": "🌅",
  "London": "🇬🇧",
  "NY": "🗽",
  "Unknown": "❓",
};

export function SessionAnalysisCard({ sessionStats }: SessionAnalysisCardProps) {
  return (
    <Card className="glass-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Clock className="h-5 w-5 text-primary" />
          Analiza według Sesji
        </CardTitle>
      </CardHeader>
      <CardContent>
        {sessionStats.length > 0 ? (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Sesja</TableHead>
                  <TableHead className="text-center">Trade'y</TableHead>
                  <TableHead className="text-center">Win Rate</TableHead>
                  <TableHead className="text-right">Total PnL</TableHead>
                  <TableHead className="text-right">Śr. PnL</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {sessionStats.map((session) => (
                  <TableRow key={session.session}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="text-lg">{sessionEmoji[session.session] || sessionEmoji.Unknown}</span>
                        <Badge variant="outline" className={sessionColors[session.session] || sessionColors.Unknown}>
                          {session.session}
                        </Badge>
                      </div>
                    </TableCell>
                    <TableCell className="text-center font-medium">
                      {session.trades}
                      <span className="text-xs text-muted-foreground ml-1">
                        ({session.wins}W/{session.losses}L)
                      </span>
                    </TableCell>
                    <TableCell className="text-center">
                      <span className={session.winRate >= 50 ? "text-profit" : "text-loss"}>
                        {session.winRate.toFixed(1)}%
                      </span>
                    </TableCell>
                    <TableCell className={`text-right font-bold ${session.totalPnL >= 0 ? "text-profit" : "text-loss"}`}>
                      ${session.totalPnL.toFixed(2)}
                    </TableCell>
                    <TableCell className={`text-right ${session.avgPnL >= 0 ? "text-profit" : "text-loss"}`}>
                      ${session.avgPnL.toFixed(2)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        ) : (
          <p className="text-center text-muted-foreground py-8">Brak danych sesji do analizy</p>
        )}
      </CardContent>
    </Card>
  );
}
