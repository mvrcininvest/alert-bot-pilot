import { useEffect, useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Loader2, History, Activity, Settings, TrendingUp, Ban, Shield, CheckCircle, XCircle } from 'lucide-react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';

interface UserDetailDialogProps {
  userId: string | null;
  userEmail: string;
  userName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface BanHistoryItem {
  id: string;
  action: string;
  reason: string | null;
  performed_by: string;
  performed_at: string;
  performer_email?: string;
}

interface BotLog {
  id: string;
  level: string;
  message: string;
  function_name: string;
  created_at: string;
  metadata: any;
}

interface Position {
  id: string;
  symbol: string;
  side: string;
  entry_price: number;
  close_price: number | null;
  quantity: number;
  leverage: number;
  realized_pnl: number | null;
  status: string;
  created_at: string;
  closed_at: string | null;
}

interface UserSettings {
  bot_active: boolean;
  position_size_value: number;
  position_sizing_type: string;
  calculator_type: string;
  sl_method: string;
  tp_strategy: string;
  tp_levels: number;
  max_open_positions: number;
  default_leverage: number;
}

export default function UserDetailDialog({ userId, userEmail, userName, open, onOpenChange }: UserDetailDialogProps) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [banHistory, setBanHistory] = useState<BanHistoryItem[]>([]);
  const [botLogs, setBotLogs] = useState<BotLog[]>([]);
  const [positions, setPositions] = useState<Position[]>([]);
  const [settings, setSettings] = useState<UserSettings | null>(null);

  useEffect(() => {
    if (open && userId) {
      fetchUserDetails();
    }
  }, [open, userId]);

  const fetchUserDetails = async () => {
    if (!userId) return;
    
    setLoading(true);
    try {
      // Fetch ban history
      const { data: banData, error: banError } = await supabase
        .from('ban_history')
        .select('*, profiles!ban_history_performed_by_fkey(email)')
        .eq('user_id', userId)
        .order('performed_at', { ascending: false });

      if (banError) throw banError;
      
      setBanHistory((banData || []).map(item => ({
        ...item,
        performer_email: (item.profiles as any)?.email
      })));

      // Fetch bot logs (last 50)
      const { data: logsData, error: logsError } = await supabase
        .from('bot_logs')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(50);

      if (logsError) throw logsError;
      setBotLogs(logsData || []);

      // Fetch positions
      const { data: positionsData, error: positionsError } = await supabase
        .from('positions')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(100);

      if (positionsError) throw positionsError;
      setPositions(positionsData || []);

      // Fetch user settings
      const { data: settingsData, error: settingsError } = await supabase
        .from('user_settings')
        .select('*')
        .eq('user_id', userId)
        .single();

      if (settingsError && settingsError.code !== 'PGRST116') throw settingsError;
      setSettings(settingsData);

    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Błąd ładowania danych",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const formatDate = (dateString: string) => {
    return format(new Date(dateString), 'dd MMM yyyy, HH:mm', { locale: pl });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="text-2xl">
            Szczegóły użytkownika: {userName || userEmail}
          </DialogTitle>
        </DialogHeader>

        {loading ? (
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <Tabs defaultValue="bans" className="w-full">
            <TabsList className="grid w-full grid-cols-4">
              <TabsTrigger value="bans" className="gap-2">
                <Ban className="h-4 w-4" />
                Historia Banów
              </TabsTrigger>
              <TabsTrigger value="logs" className="gap-2">
                <Activity className="h-4 w-4" />
                Logi Aktywności
              </TabsTrigger>
              <TabsTrigger value="settings" className="gap-2">
                <Settings className="h-4 w-4" />
                Ustawienia
              </TabsTrigger>
              <TabsTrigger value="positions" className="gap-2">
                <TrendingUp className="h-4 w-4" />
                Pozycje
              </TabsTrigger>
            </TabsList>

            {/* Ban History Tab */}
            <TabsContent value="bans">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <History className="h-5 w-5" />
                    Historia Banów
                  </CardTitle>
                  <CardDescription>
                    Pełna historia wszystkich banów i odbanowań tego użytkownika
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {banHistory.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      <Shield className="h-12 w-12 mx-auto mb-3 opacity-20" />
                      Brak historii banów
                    </div>
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Data</TableHead>
                            <TableHead>Akcja</TableHead>
                            <TableHead>Powód</TableHead>
                            <TableHead>Przez kogo</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {banHistory.map((item) => (
                            <TableRow key={item.id}>
                              <TableCell className="text-sm">
                                {formatDate(item.performed_at)}
                              </TableCell>
                              <TableCell>
                                <Badge variant={item.action === 'banned' ? 'destructive' : 'default'}>
                                  {item.action === 'banned' ? 'Zbanowany' : 'Odbanowany'}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-sm">
                                {item.reason || '-'}
                              </TableCell>
                              <TableCell className="text-sm">
                                {item.performer_email || 'System'}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Bot Logs Tab */}
            <TabsContent value="logs">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Activity className="h-5 w-5" />
                    Logi Systemowe (ostatnie 50)
                  </CardTitle>
                  <CardDescription>
                    Historia aktywności bota i systemowych zdarzeń
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {botLogs.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Brak logów systemowych
                    </div>
                  ) : (
                    <div className="space-y-2 max-h-[400px] overflow-y-auto">
                      {botLogs.map((log) => (
                        <div
                          key={log.id}
                          className="p-3 rounded-lg border bg-card hover:bg-accent/5 transition-colors"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 space-y-1">
                              <div className="flex items-center gap-2">
                                <Badge
                                  variant={
                                    log.level === 'error' ? 'destructive' :
                                    log.level === 'warn' ? 'secondary' :
                                    'outline'
                                  }
                                  className="text-xs"
                                >
                                  {log.level.toUpperCase()}
                                </Badge>
                                <span className="text-xs font-mono text-muted-foreground">
                                  {log.function_name}
                                </span>
                              </div>
                              <p className="text-sm">{log.message}</p>
                              {log.metadata && (
                                <pre className="text-xs bg-muted p-2 rounded overflow-x-auto">
                                  {JSON.stringify(log.metadata, null, 2)}
                                </pre>
                              )}
                            </div>
                            <span className="text-xs text-muted-foreground whitespace-nowrap">
                              {formatDate(log.created_at)}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Settings Tab */}
            <TabsContent value="settings">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <Settings className="h-5 w-5" />
                    Ustawienia Tradingowe
                  </CardTitle>
                  <CardDescription>
                    Aktualna konfiguracja strategii i zarządzania ryzykiem
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {!settings ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Brak ustawień użytkownika
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-4">
                      <div className="space-y-3">
                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Status Bota</label>
                          <div className="flex items-center gap-2 mt-1">
                            {settings.bot_active ? (
                              <Badge variant="default" className="gap-1">
                                <CheckCircle className="h-3 w-3" />
                                Aktywny
                              </Badge>
                            ) : (
                              <Badge variant="secondary" className="gap-1">
                                <XCircle className="h-3 w-3" />
                                Nieaktywny
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Typ Kalkulatora</label>
                          <p className="text-sm font-medium mt-1">{settings.calculator_type}</p>
                        </div>

                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Metoda SL</label>
                          <p className="text-sm font-medium mt-1">{settings.sl_method}</p>
                        </div>

                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Strategia TP</label>
                          <p className="text-sm font-medium mt-1">{settings.tp_strategy}</p>
                        </div>

                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Poziomy TP</label>
                          <p className="text-sm font-medium mt-1">{settings.tp_levels}</p>
                        </div>
                      </div>

                      <div className="space-y-3">
                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Wielkość Pozycji</label>
                          <p className="text-sm font-medium mt-1">
                            {settings.position_size_value} ({settings.position_sizing_type})
                          </p>
                        </div>

                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Max Otwarte Pozycje</label>
                          <p className="text-sm font-medium mt-1">{settings.max_open_positions}</p>
                        </div>

                        <div>
                          <label className="text-sm font-medium text-muted-foreground">Domyślna Dźwignia</label>
                          <p className="text-sm font-medium mt-1">{settings.default_leverage}x</p>
                        </div>
                      </div>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            {/* Positions Tab */}
            <TabsContent value="positions">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2">
                    <TrendingUp className="h-5 w-5" />
                    Historia Pozycji (ostatnie 100)
                  </CardTitle>
                  <CardDescription>
                    Wszystkie pozycje handlowe użytkownika
                  </CardDescription>
                </CardHeader>
                <CardContent>
                  {positions.length === 0 ? (
                    <div className="text-center py-8 text-muted-foreground">
                      Brak pozycji handlowych
                    </div>
                  ) : (
                    <div className="rounded-md border">
                      <Table>
                        <TableHeader>
                          <TableRow>
                            <TableHead>Symbol</TableHead>
                            <TableHead>Strona</TableHead>
                            <TableHead>Cena Wejścia</TableHead>
                            <TableHead>Cena Wyjścia</TableHead>
                            <TableHead>Ilość</TableHead>
                            <TableHead>Dźwignia</TableHead>
                            <TableHead>PnL</TableHead>
                            <TableHead>Status</TableHead>
                            <TableHead>Data</TableHead>
                          </TableRow>
                        </TableHeader>
                        <TableBody>
                          {positions.map((position) => (
                            <TableRow key={position.id}>
                              <TableCell className="font-mono font-medium">
                                {position.symbol}
                              </TableCell>
                              <TableCell>
                                <Badge variant={position.side === 'BUY' ? 'default' : 'secondary'}>
                                  {position.side}
                                </Badge>
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                ${position.entry_price}
                              </TableCell>
                              <TableCell className="font-mono text-sm">
                                {position.close_price ? `$${position.close_price}` : '-'}
                              </TableCell>
                              <TableCell className="text-sm">
                                {position.quantity}
                              </TableCell>
                              <TableCell>
                                <Badge variant="outline">{position.leverage}x</Badge>
                              </TableCell>
                              <TableCell>
                                {position.realized_pnl !== null ? (
                                  <span className={position.realized_pnl >= 0 ? 'text-profit' : 'text-loss'}>
                                    ${position.realized_pnl.toFixed(2)}
                                  </span>
                                ) : (
                                  '-'
                                )}
                              </TableCell>
                              <TableCell>
                                <Badge
                                  variant={
                                    position.status === 'open' ? 'default' :
                                    position.status === 'closed' ? 'secondary' :
                                    'destructive'
                                  }
                                >
                                  {position.status}
                                </Badge>
                              </TableCell>
                              <TableCell className="text-xs text-muted-foreground">
                                {formatDate(position.created_at)}
                              </TableCell>
                            </TableRow>
                          ))}
                        </TableBody>
                      </Table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </TabsContent>
          </Tabs>
        )}
      </DialogContent>
    </Dialog>
  );
}
