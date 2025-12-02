import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Shield, Key, CheckCircle2, AlertCircle, Trash2, Eye, EyeOff } from "lucide-react";
import { useAuth } from "@/hooks/useAuth";

export default function ApiKeys() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const { user } = useAuth();
  
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [validating, setValidating] = useState(false);
  const [keysExist, setKeysExist] = useState(false);
  const [keysInfo, setKeysInfo] = useState<any>(null);
  const [showKeys, setShowKeys] = useState({ apiKey: false, secretKey: false });
  const isRedirecting = useRef(false);
  
  const [formData, setFormData] = useState({
    apiKey: "",
    secretKey: "",
  });

  useEffect(() => {
    if (user) {
      checkExistingKeys();
    }
  }, [user]);

  const checkExistingKeys = async () => {
    try {
      setChecking(true);
      const { data, error } = await supabase.functions.invoke('manage-api-keys', {
        body: { action: 'get' }
      });

      if (error) throw error;

      setKeysExist(data.exists);
      setKeysInfo(data);
    } catch (error: any) {
      console.error('Error checking keys:', error);
      toast({
        title: "Błąd",
        description: "Nie udało się sprawdzić istniejących kluczy API",
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (isRedirecting.current) return;
    
    if (!formData.apiKey || !formData.secretKey) {
      toast({
        title: "Błąd walidacji",
        description: "Wszystkie pola są wymagane",
        variant: "destructive",
      });
      return;
    }

    try {
      setLoading(true);
      
      const { data, error } = await supabase.functions.invoke('manage-api-keys', {
        body: {
          action: 'save',
          apiKey: formData.apiKey,
          secretKey: formData.secretKey,
        }
      });

      if (error) throw error;

      if (!data.validated) {
        toast({
          title: "Walidacja nie powiodła się",
          description: data.error || "Nieprawidłowe klucze API. Sprawdź swoje dane.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Sukces",
        description: "Klucze API zapisane i zwalidowane pomyślnie!",
      });
      
      setFormData({ apiKey: "", secretKey: "" });
      await checkExistingKeys();
      
      // Redirect to dashboard after successful setup with full reload
      if (!isRedirecting.current) {
        isRedirecting.current = true;
        setTimeout(() => {
          window.location.href = '/';
        }, 1500);
      }
    } catch (error: any) {
      console.error('Error saving keys:', error);
      toast({
        title: "Błąd",
        description: error.message || "Nie udało się zapisać kluczy API",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  const handleValidate = async () => {
    try {
      setValidating(true);
      
      const { data, error } = await supabase.functions.invoke('manage-api-keys', {
        body: { action: 'validate' }
      });

      if (error) throw error;

      toast({
        title: data.valid ? "Walidacja pomyślna" : "Walidacja nie powiodła się",
        description: data.message,
        variant: data.valid ? "default" : "destructive",
      });
      
      if (data.valid) {
        await checkExistingKeys();
      }
    } catch (error: any) {
      console.error('Error validating keys:', error);
      toast({
        title: "Błąd",
        description: "Nie udało się zwalidować kluczy API",
        variant: "destructive",
      });
    } finally {
      setValidating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Czy na pewno chcesz usunąć swoje klucze API? Ta akcja jest nieodwracalna.")) {
      return;
    }

    try {
      setLoading(true);
      
      const { error } = await supabase.functions.invoke('manage-api-keys', {
        body: { action: 'delete' }
      });

      if (error) throw error;

      toast({
        title: "Sukces",
        description: "Klucze API usunięte pomyślnie",
      });
      
      await checkExistingKeys();
    } catch (error: any) {
      console.error('Error deleting keys:', error);
      toast({
        title: "Błąd",
        description: "Nie udało się usunąć kluczy API",
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  };

  if (checking) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="h-8 w-8 animate-spin" />
      </div>
    );
  }

  return (
    <div className="container max-w-4xl mx-auto p-6 space-y-6">
      {!keysExist && (
        <Alert className="border-destructive/50 bg-destructive/5">
          <AlertCircle className="h-4 w-4 text-destructive" />
          <AlertDescription>
            <p className="font-medium">Klucze API wymagane</p>
            <p className="text-sm text-muted-foreground mt-1">
              Musisz skonfigurować i zwalidować swoje klucze API Bybit przed uzyskaniem dostępu do bota tradingowego.
            </p>
          </AlertDescription>
        </Alert>
      )}
      
      <div className="flex items-center gap-3">
        <Shield className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold">Klucze API Bybit</h1>
          <p className="text-muted-foreground">Bezpiecznie zarządzaj swoimi danymi uwierzytelniającymi do tradingu</p>
        </div>
      </div>

      {keysExist && keysInfo && (
        <Alert className="border-primary/50 bg-primary/5">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <AlertDescription>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">Klucze API są skonfigurowane i zaszyfrowane</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Ostatnia walidacja: {keysInfo.lastValidated 
                    ? new Date(keysInfo.lastValidated).toLocaleString('pl-PL') 
                    : 'Nigdy'}
                </p>
              </div>
              <div className="flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleValidate}
                  disabled={validating}
                >
                  {validating ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Walidacja...
                    </>
                  ) : (
                    'Sprawdź połączenie'
                  )}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={loading}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Usuń
                </Button>
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Key className="h-5 w-5" />
            {keysExist ? 'Aktualizuj klucze API' : 'Dodaj klucze API'}
          </CardTitle>
          <CardDescription>
            Twoje klucze są szyfrowane AES-256 i walidowane przed zapisem
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiKey">Klucz API</Label>
              <div className="relative">
                <Input
                  id="apiKey"
                  type={showKeys.apiKey ? "text" : "password"}
                  placeholder="Wprowadź swój klucz API Bybit"
                  value={formData.apiKey}
                  onChange={(e) => setFormData({ ...formData, apiKey: e.target.value })}
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => setShowKeys({ ...showKeys, apiKey: !showKeys.apiKey })}
                >
                  {showKeys.apiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="secretKey">Klucz sekretny</Label>
              <div className="relative">
                <Input
                  id="secretKey"
                  type={showKeys.secretKey ? "text" : "password"}
                  placeholder="Wprowadź swój klucz sekretny Bybit"
                  value={formData.secretKey}
                  onChange={(e) => setFormData({ ...formData, secretKey: e.target.value })}
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => setShowKeys({ ...showKeys, secretKey: !showKeys.secretKey })}
                >
                  {showKeys.secretKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>Informacja bezpieczeństwa:</strong> Twoje klucze API będą zaszyfrowane
                przy użyciu szyfrowania AES-256 przed zapisaniem. Są one walidowane
                z API Bybit aby upewnić się, że działają poprawnie.
              </AlertDescription>
            </Alert>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {keysExist ? 'Aktualizacja i walidacja...' : 'Zapisywanie i walidacja...'}
                </>
              ) : (
                <>
                  <Shield className="mr-2 h-4 w-4" />
                  {keysExist ? 'Aktualizuj klucze' : 'Zapisz klucze'}
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Jak uzyskać swoje klucze API</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="list-decimal list-inside space-y-2 text-sm">
            <li>Zaloguj się na swoje konto Bybit</li>
            <li>Przejdź do sekcji zarządzania API (Account & Security → API)</li>
            <li>Utwórz nowy klucz API z uprawnieniami do tradingu (Contract Trade)</li>
            <li>Skopiuj klucz API i klucz sekretny</li>
            <li>Wklej je do formularza powyżej</li>
          </ol>
          
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>Ważne:</strong> Upewnij się, że Twój klucz API ma niezbędne uprawnienia
              do tradingu (składanie zleceń, przeglądanie pozycji itp.), ale zalecamy NIE włączać
              uprawnień do wypłat ze względów bezpieczeństwa.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
