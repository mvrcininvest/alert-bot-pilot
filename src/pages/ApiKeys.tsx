import { useState, useEffect } from "react";
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
  const [showKeys, setShowKeys] = useState({ apiKey: false, secretKey: false, passphrase: false });
  
  const [formData, setFormData] = useState({
    apiKey: "",
    secretKey: "",
    passphrase: "",
  });

  useEffect(() => {
    if (!user) {
      navigate("/auth");
      return;
    }
    checkExistingKeys();
  }, [user, navigate]);

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
        title: "Error",
        description: "Failed to check existing API keys",
        variant: "destructive",
      });
    } finally {
      setChecking(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.apiKey || !formData.secretKey || !formData.passphrase) {
      toast({
        title: "Validation Error",
        description: "All fields are required",
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
          passphrase: formData.passphrase,
        }
      });

      if (error) throw error;

      if (!data.validated) {
        toast({
          title: "Validation Failed",
          description: data.error || "Invalid API keys. Please check your credentials.",
          variant: "destructive",
        });
        return;
      }

      toast({
        title: "Success",
        description: "API keys saved and validated successfully!",
      });
      
      setFormData({ apiKey: "", secretKey: "", passphrase: "" });
      await checkExistingKeys();
    } catch (error: any) {
      console.error('Error saving keys:', error);
      toast({
        title: "Error",
        description: error.message || "Failed to save API keys",
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
        title: data.valid ? "Validation Successful" : "Validation Failed",
        description: data.message,
        variant: data.valid ? "default" : "destructive",
      });
      
      if (data.valid) {
        await checkExistingKeys();
      }
    } catch (error: any) {
      console.error('Error validating keys:', error);
      toast({
        title: "Error",
        description: "Failed to validate API keys",
        variant: "destructive",
      });
    } finally {
      setValidating(false);
    }
  };

  const handleDelete = async () => {
    if (!confirm("Are you sure you want to delete your API keys? This action cannot be undone.")) {
      return;
    }

    try {
      setLoading(true);
      
      const { error } = await supabase.functions.invoke('manage-api-keys', {
        body: { action: 'delete' }
      });

      if (error) throw error;

      toast({
        title: "Success",
        description: "API keys deleted successfully",
      });
      
      await checkExistingKeys();
    } catch (error: any) {
      console.error('Error deleting keys:', error);
      toast({
        title: "Error",
        description: "Failed to delete API keys",
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
      <div className="flex items-center gap-3">
        <Shield className="h-8 w-8 text-primary" />
        <div>
          <h1 className="text-3xl font-bold">Bitget API Keys</h1>
          <p className="text-muted-foreground">Securely manage your trading API credentials</p>
        </div>
      </div>

      {keysExist && keysInfo && (
        <Alert className="border-primary/50 bg-primary/5">
          <CheckCircle2 className="h-4 w-4 text-primary" />
          <AlertDescription>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium">API keys are configured and encrypted</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Last validated: {keysInfo.lastValidated 
                    ? new Date(keysInfo.lastValidated).toLocaleString() 
                    : 'Never'}
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
                      Validating...
                    </>
                  ) : (
                    'Validate Connection'
                  )}
                </Button>
                <Button
                  variant="destructive"
                  size="sm"
                  onClick={handleDelete}
                  disabled={loading}
                >
                  <Trash2 className="mr-2 h-4 w-4" />
                  Delete
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
            {keysExist ? 'Update API Keys' : 'Add API Keys'}
          </CardTitle>
          <CardDescription>
            Your keys are encrypted with AES-256 and validated before saving
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <div className="relative">
                <Input
                  id="apiKey"
                  type={showKeys.apiKey ? "text" : "password"}
                  placeholder="Enter your Bitget API Key"
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
              <Label htmlFor="secretKey">Secret Key</Label>
              <div className="relative">
                <Input
                  id="secretKey"
                  type={showKeys.secretKey ? "text" : "password"}
                  placeholder="Enter your Bitget Secret Key"
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

            <div className="space-y-2">
              <Label htmlFor="passphrase">Passphrase</Label>
              <div className="relative">
                <Input
                  id="passphrase"
                  type={showKeys.passphrase ? "text" : "password"}
                  placeholder="Enter your Bitget Passphrase"
                  value={formData.passphrase}
                  onChange={(e) => setFormData({ ...formData, passphrase: e.target.value })}
                  required
                />
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="absolute right-2 top-1/2 -translate-y-1/2"
                  onClick={() => setShowKeys({ ...showKeys, passphrase: !showKeys.passphrase })}
                >
                  {showKeys.passphrase ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </Button>
              </div>
            </div>

            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>Security Notice:</strong> Your API keys will be encrypted using AES-256
                encryption before storage. They are validated against Bitget's API to ensure
                they work correctly.
              </AlertDescription>
            </Alert>

            <Button type="submit" className="w-full" disabled={loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  {keysExist ? 'Updating & Validating...' : 'Saving & Validating...'}
                </>
              ) : (
                <>
                  <Shield className="mr-2 h-4 w-4" />
                  {keysExist ? 'Update Keys' : 'Save Keys'}
                </>
              )}
            </Button>
          </form>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>How to Get Your API Keys</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="list-decimal list-inside space-y-2 text-sm">
            <li>Log in to your Bitget account</li>
            <li>Go to API Management section</li>
            <li>Create a new API key with trading permissions</li>
            <li>Copy the API Key, Secret Key, and Passphrase</li>
            <li>Paste them into the form above</li>
          </ol>
          
          <Alert>
            <AlertCircle className="h-4 w-4" />
            <AlertDescription className="text-sm">
              <strong>Important:</strong> Make sure your API key has the necessary permissions
              for trading (place orders, view positions, etc.) but we recommend NOT enabling
              withdrawal permissions for security reasons.
            </AlertDescription>
          </Alert>
        </CardContent>
      </Card>
    </div>
  );
}
