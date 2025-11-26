import { useState, useEffect, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Key, ArrowRight, CheckCircle2, AlertCircle } from "lucide-react";

export default function MigrateApiKeys() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [migrating, setMigrating] = useState(true);
  const [success, setSuccess] = useState(false);
  const hasAttemptedMigration = useRef(false);

  const handleMigrate = async () => {
    if (hasAttemptedMigration.current) return;
    hasAttemptedMigration.current = true;

    try {
      setMigrating(true);
      
      const { data, error } = await supabase.functions.invoke('migrate-user-api-keys');

      if (error) throw error;

      if (data.alreadyExists) {
        // Keys already configured - redirect immediately without showing UI
        window.location.href = '/';
        return;
      }

      if (!data.success) {
        // No keys to migrate - redirect to manual setup
        navigate('/settings/api-keys');
        return;
      }

      setSuccess(true);
      toast({
        title: "Migracja zakończona pomyślnie",
        description: "Twoje klucze API zostały zaszyfrowane i przeniesione!",
      });
      
      // Force full page reload to refresh hasApiKeys state
      setTimeout(() => {
        window.location.href = '/';
      }, 2000);
    } catch (error: any) {
      console.error('Migration error:', error);
      
      // If no keys found in secrets, redirect to manual setup
      if (error.message?.includes('not found')) {
        navigate('/settings/api-keys');
      } else {
        toast({
          title: "Błąd migracji",
          description: error.message || "Nie udało się przenieść kluczy. Spróbuj ręcznej konfiguracji.",
          variant: "destructive",
        });
        setTimeout(() => navigate('/settings/api-keys'), 2000);
      }
    } finally {
      setMigrating(false);
    }
  };

  // Auto-trigger migration on mount
  useEffect(() => {
    handleMigrate();
  }, []);

  return (
    <div className="container max-w-2xl mx-auto p-6 min-h-screen flex items-center justify-center">
      <Card className="w-full">
        <CardHeader className="text-center">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-primary/10 flex items-center justify-center">
              <Key className="h-8 w-8 text-primary" />
            </div>
          </div>
          <CardTitle className="text-2xl">Migracja kluczy API wymagana</CardTitle>
          <CardDescription>
            Aktualizujemy system zabezpieczeń. Twoje istniejące klucze API Bitget muszą zostać przeniesione do nowego zaszyfrowanego magazynu.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!success ? (
            <>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  <strong>Co dzieje się podczas migracji:</strong>
                  <ul className="mt-2 space-y-1 list-disc list-inside">
                    <li>Twoje istniejące klucze API zostaną zaszyfrowane AES-256</li>
                    <li>Klucze będą bezpiecznie przechowywane na Twoim koncie</li>
                    <li>Nie wymaga ręcznego wprowadzania - w pełni automatyczne</li>
                    <li>Zajmuje mniej niż 5 sekund</li>
                  </ul>
                </AlertDescription>
              </Alert>

              <Button 
                onClick={handleMigrate} 
                disabled={migrating}
                className="w-full"
                size="lg"
              >
                {migrating ? (
                  <>
                    <Loader2 className="mr-2 h-5 w-5 animate-spin" />
                    Migrowanie kluczy...
                  </>
                ) : (
                  <>
                    Migruj klucze API
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                To jednorazowy proces. Twój trading będzie kontynuowany bez przerwy.
              </p>
            </>
          ) : (
            <Alert className="border-primary/50 bg-primary/5">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <AlertDescription>
                <p className="font-medium text-primary">Migracja zakończona!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Twoje klucze API zostały pomyślnie przeniesione. Przekierowywanie do panelu...
                </p>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
