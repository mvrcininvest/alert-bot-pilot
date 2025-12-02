import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Loader2, AlertTriangle, RefreshCw, ExternalLink, Key } from 'lucide-react';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';

interface AlertError {
  id: string;
  created_at: string;
  user_id: string;
  user_email: string;
  symbol: string;
  side: 'BUY' | 'SELL';
  error_message: string;
  raw_data: any;
  entry_price: number;
  sl: number;
  main_tp: number;
}

interface ErrorStats {
  total: number;
  today: number;
  noApiKeys: number;
  maxPositions: number;
  other: number;
}

const ERROR_DESCRIPTIONS: Record<string, string> = {
  'User API keys not found or inactive': 'Użytkownik nie skonfigurował kluczy API Bybit',
  'Max open positions reached': 'Przekroczono limit otwartych pozycji',
  'Edge Function returned a non-2xx status code': 'Błąd edge function (sprawdź szczegóły)',
  'Bot not active': 'Bot użytkownika jest wyłączony',
  'Tier excluded': 'Tier alertu jest wykluczony w ustawieniach użytkownika',
  'Insufficient balance': 'Niewystarczające saldo na koncie',
  'Symbol banned': 'Symbol jest zbanowany',
  'Alert strength below threshold': 'Siła sygnału poniżej progu',
};

const getErrorCategory = (errorMessage: string): string => {
  if (!errorMessage) return 'other';
  const msg = errorMessage.toLowerCase();
  if (msg.includes('api key')) return 'noApiKeys';
  if (msg.includes('max') && msg.includes('position')) return 'maxPositions';
  return 'other';
};

const getErrorDescription = (errorMessage: string): string => {
  if (!errorMessage) return 'Nieznany błąd';
  return ERROR_DESCRIPTIONS[errorMessage] || errorMessage;
};

export default function AdminAlertErrors() {
  const { toast } = useToast();
  const [errors, setErrors] = useState<AlertError[]>([]);
  const [loading, setLoading] = useState(true);
  const [stats, setStats] = useState<ErrorStats>({
    total: 0,
    today: 0,
    noApiKeys: 0,
    maxPositions: 0,
    other: 0,
  });

  // Filters
  const [searchQuery, setSearchQuery] = useState('');
  const [symbolFilter, setSymbolFilter] = useState('all');
  const [errorTypeFilter, setErrorTypeFilter] = useState('all');
  const [selectedError, setSelectedError] = useState<AlertError | null>(null);
  const [detailDialogOpen, setDetailDialogOpen] = useState(false);

  const fetchErrors = async () => {
    setLoading(true);
    try {
      // Fetch error alerts with user emails
      const { data: alerts, error: alertsError } = await supabase
        .from('alerts')
        .select(`
          id,
          created_at,
          user_id,
          symbol,
          side,
          error_message,
          raw_data,
          entry_price,
          sl,
          main_tp
        `)
        .eq('status', 'error')
        .order('created_at', { ascending: false })
        .limit(500);

      if (alertsError) throw alertsError;

      // Get user emails
      const userIds = [...new Set(alerts?.map(a => a.user_id).filter(Boolean))];
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email')
        .in('id', userIds);

      if (profilesError) throw profilesError;

      const emailMap = new Map(profiles?.map(p => [p.id, p.email]));
      
      const errorsWithEmails: AlertError[] = (alerts || []).map(alert => ({
        ...alert as any,
        user_email: emailMap.get(alert.user_id!) || 'Nieznany',
      }));

      setErrors(errorsWithEmails);

      // Calculate stats
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      const todayErrors = errorsWithEmails.filter(e => 
        new Date(e.created_at) >= today
      );

      const categorized = errorsWithEmails.reduce((acc, error) => {
        const category = getErrorCategory(error.error_message);
        acc[category as keyof ErrorStats]++;
        return acc;
      }, { total: errorsWithEmails.length, today: todayErrors.length, noApiKeys: 0, maxPositions: 0, other: 0 });

      setStats(categorized);

    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Błąd",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchErrors();
    
    // Subscribe to new error alerts
    const channel = supabase
      .channel('alert-errors')
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'alerts',
          filter: 'status=eq.error'
        },
        () => {
          fetchErrors();
        }
      )
      .subscribe();

    return () => {
      channel.unsubscribe();
    };
  }, []);

  // Filter errors
  const filteredErrors = errors.filter(error => {
    if (searchQuery && !error.user_email.toLowerCase().includes(searchQuery.toLowerCase()) && 
        !error.symbol.toLowerCase().includes(searchQuery.toLowerCase())) {
      return false;
    }
    if (symbolFilter !== 'all' && error.symbol !== symbolFilter) {
      return false;
    }
    if (errorTypeFilter !== 'all') {
      const category = getErrorCategory(error.error_message);
      if (errorTypeFilter !== category) {
        return false;
      }
    }
    return true;
  });

  const uniqueSymbols = [...new Set(errors.map(e => e.symbol))].sort();

  const showErrorDetails = (error: AlertError) => {
    setSelectedError(error);
    setDetailDialogOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Wszystkie błędy</CardDescription>
            <CardTitle className="text-3xl">{stats.total}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Błędy dzisiaj</CardDescription>
            <CardTitle className="text-3xl text-destructive">{stats.today}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Brak API keys</CardDescription>
            <CardTitle className="text-3xl text-warning">{stats.noApiKeys}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Max pozycji</CardDescription>
            <CardTitle className="text-3xl text-accent">{stats.maxPositions}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Inne błędy</CardDescription>
            <CardTitle className="text-3xl text-muted-foreground">{stats.other}</CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Filters */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Filtry</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">Szukaj</Label>
              <Input
                placeholder="Email lub symbol..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">Symbol</Label>
              <Select value={symbolFilter} onValueChange={setSymbolFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Wszystkie</SelectItem>
                  {uniqueSymbols.map(symbol => (
                    <SelectItem key={symbol} value={symbol}>{symbol}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground mb-2 block">Typ błędu</Label>
              <Select value={errorTypeFilter} onValueChange={setErrorTypeFilter}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">Wszystkie</SelectItem>
                  <SelectItem value="noApiKeys">Brak API keys</SelectItem>
                  <SelectItem value="maxPositions">Max pozycji</SelectItem>
                  <SelectItem value="other">Inne</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button onClick={fetchErrors} variant="outline" className="w-full">
                <RefreshCw className="h-4 w-4 mr-2" />
                Odśwież
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Errors Table */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Błędy Alertów</CardTitle>
              <CardDescription>
                {filteredErrors.length === errors.length
                  ? `${errors.length} błędnych alertów`
                  : `Znaleziono ${filteredErrors.length} z ${errors.length} błędów`
                }
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : filteredErrors.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Brak błędów do wyświetlenia
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Użytkownik</TableHead>
                    <TableHead>Symbol</TableHead>
                    <TableHead>Side</TableHead>
                    <TableHead>Opis błędu</TableHead>
                    <TableHead>Akcje</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredErrors.map((error) => (
                    <TableRow key={error.id}>
                      <TableCell className="font-mono text-sm">
                        {format(new Date(error.created_at), 'dd.MM.yyyy HH:mm', { locale: pl })}
                      </TableCell>
                      <TableCell>
                        <div className="flex items-center gap-2">
                          <span className="text-sm">{error.user_email}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline">{error.symbol}</Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant={error.side === 'BUY' ? 'default' : 'secondary'}>
                          {error.side}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex items-start gap-2 max-w-md">
                          <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                          <span className="text-sm">{getErrorDescription(error.error_message)}</span>
                        </div>
                      </TableCell>
                      <TableCell>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => showErrorDetails(error)}
                        >
                          <ExternalLink className="h-4 w-4" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Error Details Dialog */}
      <Dialog open={detailDialogOpen} onOpenChange={setDetailDialogOpen}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Szczegóły błędu</DialogTitle>
            <DialogDescription>
              Pełne informacje o błędzie alertu
            </DialogDescription>
          </DialogHeader>
          
          {selectedError && (
            <div className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <Label className="text-xs text-muted-foreground">Użytkownik</Label>
                  <p className="text-sm font-medium">{selectedError.user_email}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Data</Label>
                  <p className="text-sm font-medium">
                    {format(new Date(selectedError.created_at), 'dd.MM.yyyy HH:mm:ss', { locale: pl })}
                  </p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Symbol</Label>
                  <p className="text-sm font-medium">{selectedError.symbol}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Strona</Label>
                  <Badge variant={selectedError.side === 'BUY' ? 'default' : 'secondary'}>
                    {selectedError.side}
                  </Badge>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Entry Price</Label>
                  <p className="text-sm font-medium">{selectedError.entry_price}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Stop Loss</Label>
                  <p className="text-sm font-medium">{selectedError.sl}</p>
                </div>
                <div>
                  <Label className="text-xs text-muted-foreground">Take Profit</Label>
                  <p className="text-sm font-medium">{selectedError.main_tp}</p>
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Komunikat błędu</Label>
                <div className="mt-1 p-3 bg-destructive/10 border border-destructive/20 rounded-md">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
                    <p className="text-sm">{getErrorDescription(selectedError.error_message)}</p>
                  </div>
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Raw Error Message</Label>
                <div className="mt-1 p-3 bg-muted rounded-md">
                  <p className="text-xs font-mono break-all">{selectedError.error_message}</p>
                </div>
              </div>

              <div>
                <Label className="text-xs text-muted-foreground">Raw Data (JSON)</Label>
                <div className="mt-1 p-3 bg-muted rounded-md overflow-x-auto">
                  <pre className="text-xs font-mono">
                    {JSON.stringify(selectedError.raw_data, null, 2)}
                  </pre>
                </div>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
