import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Loader2, Shield, Lock, Key, Smartphone, LogOut, AlertTriangle, CheckCircle2, Clock, Monitor } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';
import { format } from 'date-fns';
import { pl } from 'date-fns/locale';

interface AuthLog {
  id: string;
  timestamp: number;
  level: string;
  msg: string;
  path: string;
  status: string;
  event_message: string;
}

export default function Security() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [logsLoading, setLogsLoading] = useState(true);
  const [mfaLoading, setMfaLoading] = useState(false);
  
  // Password change
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  
  // MFA state
  const [mfaEnabled, setMfaEnabled] = useState(false);
  const [mfaFactors, setMfaFactors] = useState<any[]>([]);
  const [qrCode, setQrCode] = useState('');
  const [mfaSecret, setMfaSecret] = useState('');
  const [verifyCode, setVerifyCode] = useState('');
  const [showMfaSetup, setShowMfaSetup] = useState(false);
  
  // Auth logs
  const [authLogs, setAuthLogs] = useState<AuthLog[]>([]);

  useEffect(() => {
    if (user) {
      checkMfaStatus();
      fetchAuthLogs();
    }
  }, [user]);

  const checkMfaStatus = async () => {
    try {
      const { data, error } = await supabase.auth.mfa.listFactors();
      if (error) throw error;
      
      setMfaFactors(data?.totp || []);
      setMfaEnabled(data?.totp?.some((factor: any) => factor.status === 'verified') || false);
    } catch (error: any) {
      console.error('MFA check error:', error);
    }
  };

  const fetchAuthLogs = async () => {
    setLogsLoading(true);
    try {
      const { data, error } = await supabase.functions.invoke('get-auth-logs', {
        body: { limit: 20 }
      });

      if (error) throw error;
      setAuthLogs(data?.logs || []);
    } catch (error: any) {
      console.error('Error fetching auth logs:', error);
    } finally {
      setLogsLoading(false);
    }
  };

  const handlePasswordChange = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (newPassword !== confirmPassword) {
      toast({
        variant: "destructive",
        title: "Hasła nie pasują",
        description: "Nowe hasło i potwierdzenie muszą być identyczne",
      });
      return;
    }

    if (newPassword.length < 8) {
      toast({
        variant: "destructive",
        title: "Hasło za krótkie",
        description: "Hasło musi mieć co najmniej 8 znaków",
      });
      return;
    }

    setLoading(true);
    try {
      const { error } = await supabase.auth.updateUser({
        password: newPassword
      });

      if (error) throw error;

      toast({
        title: "Hasło zmienione",
        description: "Twoje hasło zostało pomyślnie zaktualizowane",
      });

      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Błąd zmiany hasła",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleEnableMfa = async () => {
    setMfaLoading(true);
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: user?.email || 'AristoEdge Account'
      });

      if (error) throw error;

      setQrCode(data.totp.qr_code);
      setMfaSecret(data.totp.secret);
      setShowMfaSetup(true);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Błąd włączania 2FA",
        description: error.message,
      });
    } finally {
      setMfaLoading(false);
    }
  };

  const handleVerifyMfa = async () => {
    if (!verifyCode || verifyCode.length !== 6) {
      toast({
        variant: "destructive",
        title: "Nieprawidłowy kod",
        description: "Kod musi składać się z 6 cyfr",
      });
      return;
    }

    setMfaLoading(true);
    try {
      const factors = await supabase.auth.mfa.listFactors();
      const factorId = factors.data?.totp?.[0]?.id;

      if (!factorId) throw new Error('No factor found');

      const { error } = await supabase.auth.mfa.challengeAndVerify({
        factorId,
        code: verifyCode
      });

      if (error) throw error;

      toast({
        title: "2FA włączone",
        description: "Dwuskładnikowa weryfikacja została pomyślnie aktywowana",
      });

      setShowMfaSetup(false);
      setVerifyCode('');
      checkMfaStatus();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Błąd weryfikacji",
        description: error.message,
      });
    } finally {
      setMfaLoading(false);
    }
  };

  const handleDisableMfa = async () => {
    if (!confirm('Czy na pewno chcesz wyłączyć dwuskładnikową weryfikację? To obniży bezpieczeństwo Twojego konta.')) {
      return;
    }

    setMfaLoading(true);
    try {
      const factors = await supabase.auth.mfa.listFactors();
      const factorId = factors.data?.totp?.[0]?.id;

      if (!factorId) throw new Error('No factor found');

      const { error } = await supabase.auth.mfa.unenroll({ factorId });

      if (error) throw error;

      toast({
        title: "2FA wyłączone",
        description: "Dwuskładnikowa weryfikacja została dezaktywowana",
      });

      checkMfaStatus();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Błąd wyłączania 2FA",
        description: error.message,
      });
    } finally {
      setMfaLoading(false);
    }
  };

  const handleSignOutAll = async () => {
    if (!confirm('Czy na pewno chcesz wylogować się ze wszystkich urządzeń? Będziesz musiał zalogować się ponownie.')) {
      return;
    }

    try {
      await supabase.auth.signOut({ scope: 'global' });
      
      toast({
        title: "Wylogowano ze wszystkich urządzeń",
        description: "Zostałeś wylogowany ze wszystkich aktywnych sesji",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Błąd wylogowania",
        description: error.message,
      });
    }
  };

  const formatTimestamp = (timestamp: number) => {
    return format(new Date(timestamp / 1000), 'dd MMM yyyy, HH:mm:ss', { locale: pl });
  };

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gradient flex items-center gap-3">
          <Shield className="h-8 w-8 text-primary" />
          Bezpieczeństwo
        </h1>
        <p className="text-muted-foreground mt-2">
          Zarządzaj bezpieczeństwem swojego konta
        </p>
      </div>

      {/* Password Change Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Lock className="h-5 w-5" />
            Zmiana Hasła
          </CardTitle>
          <CardDescription>
            Aktualizuj swoje hasło regularnie dla lepszego bezpieczeństwa
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handlePasswordChange} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="new_password">Nowe Hasło</Label>
              <Input
                id="new_password"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="Minimum 8 znaków"
                required
                minLength={8}
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="confirm_password">Potwierdź Nowe Hasło</Label>
              <Input
                id="confirm_password"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="Powtórz nowe hasło"
                required
                minLength={8}
              />
            </div>

            <Button type="submit" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Zmieniam...
                </>
              ) : (
                <>
                  <Lock className="h-4 w-4 mr-2" />
                  Zmień Hasło
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* 2FA Card */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Smartphone className="h-5 w-5" />
                Dwuskładnikowa Weryfikacja (2FA)
              </CardTitle>
              <CardDescription>
                Dodatkowa warstwa bezpieczeństwa dla Twojego konta
              </CardDescription>
            </div>
            <Badge variant={mfaEnabled ? "default" : "secondary"}>
              {mfaEnabled ? (
                <>
                  <CheckCircle2 className="h-3 w-3 mr-1" />
                  Włączone
                </>
              ) : (
                'Wyłączone'
              )}
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {!showMfaSetup ? (
            <>
              <Alert>
                <AlertTriangle className="h-4 w-4" />
                <AlertDescription>
                  {mfaEnabled 
                    ? 'Dwuskładnikowa weryfikacja jest włączona. Każde logowanie wymaga kodu z aplikacji uwierzytelniającej.'
                    : 'Włącz 2FA, aby znacząco zwiększyć bezpieczeństwo swojego konta. Będziesz potrzebować aplikacji takiej jak Google Authenticator lub Authy.'
                  }
                </AlertDescription>
              </Alert>

              {mfaEnabled ? (
                <Button 
                  variant="destructive" 
                  onClick={handleDisableMfa}
                  disabled={mfaLoading}
                >
                  {mfaLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Wyłączam...
                    </>
                  ) : (
                    'Wyłącz 2FA'
                  )}
                </Button>
              ) : (
                <Button onClick={handleEnableMfa} disabled={mfaLoading}>
                  {mfaLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Przygotowuję...
                    </>
                  ) : (
                    <>
                      <Smartphone className="h-4 w-4 mr-2" />
                      Włącz 2FA
                    </>
                  )}
                </Button>
              )}
            </>
          ) : (
            <div className="space-y-4">
              <Alert>
                <AlertDescription>
                  <ol className="list-decimal list-inside space-y-2 text-sm">
                    <li>Zainstaluj aplikację uwierzytelniającą (Google Authenticator, Authy, 1Password)</li>
                    <li>Zeskanuj kod QR poniżej lub wpisz ręcznie klucz tajny</li>
                    <li>Wpisz 6-cyfrowy kod z aplikacji, aby zakończyć konfigurację</li>
                  </ol>
                </AlertDescription>
              </Alert>

              {qrCode && (
                <div className="flex flex-col items-center gap-4 p-4 bg-white rounded-lg">
                  <img src={qrCode} alt="QR Code" className="w-64 h-64" />
                  <div className="text-center space-y-2">
                    <p className="text-sm font-medium">Lub wpisz ręcznie:</p>
                    <code className="text-xs bg-muted px-3 py-1 rounded">{mfaSecret}</code>
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="verify_code">Kod Weryfikacyjny</Label>
                <Input
                  id="verify_code"
                  value={verifyCode}
                  onChange={(e) => setVerifyCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="123456"
                  maxLength={6}
                  pattern="\d{6}"
                />
              </div>

              <div className="flex gap-2">
                <Button onClick={handleVerifyMfa} disabled={mfaLoading || verifyCode.length !== 6}>
                  {mfaLoading ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      Weryfikuję...
                    </>
                  ) : (
                    'Zweryfikuj i Włącz'
                  )}
                </Button>
                <Button variant="outline" onClick={() => setShowMfaSetup(false)}>
                  Anuluj
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active Sessions Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Monitor className="h-5 w-5" />
            Aktywne Sesje
          </CardTitle>
          <CardDescription>
            Zarządzaj urządzeniami z dostępem do Twojego konta
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="flex items-center gap-3">
              <div className="h-10 w-10 rounded-full bg-primary/10 flex items-center justify-center">
                <Monitor className="h-5 w-5 text-primary" />
              </div>
              <div>
                <p className="font-medium">Obecna Sesja</p>
                <p className="text-sm text-muted-foreground">To urządzenie • Aktywne teraz</p>
              </div>
            </div>
            <Badge variant="default">Aktywna</Badge>
          </div>

          <Button variant="destructive" onClick={handleSignOutAll}>
            <LogOut className="h-4 w-4 mr-2" />
            Wyloguj Wszystkie Urządzenia
          </Button>
        </CardContent>
      </Card>

      {/* Login History Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Clock className="h-5 w-5" />
            Historia Logowań
          </CardTitle>
          <CardDescription>
            Ostatnie 20 aktywności związanych z uwierzytelnianiem
          </CardDescription>
        </CardHeader>
        <CardContent>
          {logsLoading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : authLogs.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Brak dostępnych logów uwierzytelniania
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data i Czas</TableHead>
                    <TableHead>Akcja</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {authLogs.map((log) => (
                    <TableRow key={log.id}>
                      <TableCell className="text-sm">
                        {formatTimestamp(log.timestamp)}
                      </TableCell>
                      <TableCell className="text-sm">
                        {log.path === '/user' ? 'Weryfikacja sesji' : log.msg}
                      </TableCell>
                      <TableCell>
                        <Badge variant={log.status === '200' ? 'default' : 'destructive'}>
                          {log.status === '200' ? 'Sukces' : 'Błąd'}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
