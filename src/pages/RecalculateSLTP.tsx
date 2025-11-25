import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { Loader2, RefreshCw } from "lucide-react";

export default function RecalculateSLTP() {
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<any>(null);

  const handleRecalculate = async () => {
    setLoading(true);
    setResults(null);
    
    try {
      const { data, error } = await supabase.functions.invoke('recalculate-sltp', {
        body: {}
      });

      if (error) {
        toast.error(`Błąd: ${error.message}`);
        console.error('Error:', error);
        return;
      }

      setResults(data);
      toast.success(`Zaktualizowano ${data.updated}/${data.total} pozycji`);
      console.log('Results:', data);
    } catch (err) {
      toast.error('Wystąpił błąd podczas przeliczania');
      console.error('Error:', err);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="container mx-auto p-6 space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Przelicz SL/TP</h1>
        <p className="text-muted-foreground mt-2">
          Narzędzie do przeliczenia poziomów SL i TP dla otwartych pozycji zgodnie z aktualnymi ustawieniami bota
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Aktualizacja poziomów SL/TP</CardTitle>
          <CardDescription>
            Ta funkcja przelicza i aktualizuje poziomy Stop Loss i Take Profit dla wszystkich obecnie otwartych pozycji.
            Nowe wartości będą zgodne z aktualnymi ustawieniami bota (calculator_type, sl_method, tp_levels, etc.).
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="bg-muted p-4 rounded-lg space-y-2">
            <h3 className="font-semibold">⚠️ Ważne informacje:</h3>
            <ul className="list-disc list-inside space-y-1 text-sm text-muted-foreground">
              <li>Funkcja aktualizuje tylko wartości w bazie danych</li>
              <li>Oko Saurona automatycznie zaktualizuje zlecenia na giełdzie przy następnym cyklu sprawdzania</li>
              <li>Proces może zająć kilka sekund dla wielu pozycji</li>
              <li>Pozycje z statusem "open" zostaną przeliczone</li>
            </ul>
          </div>

          <Button 
            onClick={handleRecalculate} 
            disabled={loading}
            size="lg"
            className="w-full"
          >
            {loading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Przeliczanie...
              </>
            ) : (
              <>
                <RefreshCw className="mr-2 h-4 w-4" />
                Przelicz SL/TP dla otwartych pozycji
              </>
            )}
          </Button>

          {results && (
            <div className="space-y-4 mt-6">
              <div className="bg-primary/10 p-4 rounded-lg">
                <h3 className="font-semibold text-lg mb-2">✅ Wyniki przeliczenia</h3>
                <div className="grid grid-cols-2 gap-4 text-sm">
                  <div>
                    <p className="text-muted-foreground">Zaktualizowane pozycje:</p>
                    <p className="text-2xl font-bold">{results.updated}</p>
                  </div>
                  <div>
                    <p className="text-muted-foreground">Łącznie pozycji:</p>
                    <p className="text-2xl font-bold">{results.total}</p>
                  </div>
                </div>
              </div>

              {results.results && results.results.length > 0 && (
                <div className="space-y-2">
                  <h4 className="font-semibold">Szczegóły zmian:</h4>
                  {results.results.map((result: any, idx: number) => (
                    <Card key={idx} className="p-3">
                      <div className="flex items-center justify-between">
                        <div>
                          <p className="font-semibold">{result.symbol}</p>
                          {result.success ? (
                            <div className="text-xs space-y-1 mt-1">
                              <p className="text-muted-foreground">
                                SL: {result.old.sl?.toFixed(2)} → <span className="text-primary font-semibold">{result.new.sl?.toFixed(2)}</span>
                              </p>
                              {result.new.tp1 && (
                                <p className="text-muted-foreground">
                                  TP1: {result.old.tp1?.toFixed(2)} → <span className="text-primary font-semibold">{result.new.tp1?.toFixed(2)}</span>
                                </p>
                              )}
                              {result.new.tp2 && (
                                <p className="text-muted-foreground">
                                  TP2: {result.old.tp2?.toFixed(2)} → <span className="text-primary font-semibold">{result.new.tp2?.toFixed(2)}</span>
                                </p>
                              )}
                            </div>
                          ) : (
                            <p className="text-xs text-destructive">{result.error}</p>
                          )}
                        </div>
                        <div>
                          {result.success ? (
                            <span className="text-green-500 text-xl">✓</span>
                          ) : (
                            <span className="text-destructive text-xl">✗</span>
                          )}
                        </div>
                      </div>
                    </Card>
                  ))}
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
