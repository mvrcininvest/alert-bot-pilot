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
  const [migrating, setMigrating] = useState(true); // Start with migrating=true
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
        toast({
          title: "Already Configured",
          description: "Your API keys are already set up. Redirecting to dashboard...",
        });
        setTimeout(() => navigate('/'), 1500);
        return;
      }

      if (!data.success) {
        // No keys to migrate - redirect to manual setup
        toast({
          title: "No Keys Found",
          description: "No global API keys found. Please configure them manually.",
        });
        setTimeout(() => navigate('/settings/api-keys'), 1500);
        return;
      }

      setSuccess(true);
      toast({
        title: "Migration Successful",
        description: "Your API keys have been migrated and encrypted successfully!",
      });
      
      setTimeout(() => navigate('/'), 2000);
    } catch (error: any) {
      console.error('Migration error:', error);
      
      // If no keys found in secrets, redirect to manual setup
      if (error.message?.includes('not found')) {
        toast({
          title: "Manual Setup Required",
          description: "Redirecting to API keys configuration...",
        });
        setTimeout(() => navigate('/settings/api-keys'), 1500);
      } else {
        toast({
          title: "Migration Failed",
          description: error.message || "Failed to migrate API keys. Please try manual setup.",
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
          <CardTitle className="text-2xl">API Keys Migration Required</CardTitle>
          <CardDescription>
            We're upgrading to a more secure system. Your existing Bitget API keys need to be migrated to the new encrypted storage.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {!success ? (
            <>
              <Alert>
                <AlertCircle className="h-4 w-4" />
                <AlertDescription className="text-sm">
                  <strong>What happens during migration:</strong>
                  <ul className="mt-2 space-y-1 list-disc list-inside">
                    <li>Your existing API keys will be encrypted with AES-256</li>
                    <li>Keys will be securely stored in your personal account</li>
                    <li>No manual input required - fully automated</li>
                    <li>Takes less than 5 seconds</li>
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
                    Migrating Keys...
                  </>
                ) : (
                  <>
                    Migrate API Keys
                    <ArrowRight className="ml-2 h-5 w-5" />
                  </>
                )}
              </Button>

              <p className="text-xs text-center text-muted-foreground">
                This is a one-time process. Your trading will continue uninterrupted.
              </p>
            </>
          ) : (
            <Alert className="border-primary/50 bg-primary/5">
              <CheckCircle2 className="h-4 w-4 text-primary" />
              <AlertDescription>
                <p className="font-medium text-primary">Migration Complete!</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Your API keys have been successfully migrated. Redirecting to dashboard...
                </p>
              </AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
