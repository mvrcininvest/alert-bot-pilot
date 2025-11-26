import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { z } from 'zod';
import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import logoAristoEdge from '@/assets/logo-aristoedge.png';
import { supabase } from '@/integrations/supabase/client';

const emailSchema = z.object({
  email: z.string().email('Nieprawidłowy adres email'),
});

const passwordSchema = z.object({
  password: z.string().min(6, 'Hasło musi mieć minimum 6 znaków'),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Hasła nie są identyczne",
  path: ["confirmPassword"],
});

export default function ResetPassword() {
  const navigate = useNavigate();
  const { resetPassword, updatePassword } = useAuth();
  const [loading, setLoading] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isRecoveryMode, setIsRecoveryMode] = useState(false);

  // Email form (request reset)
  const [email, setEmail] = useState('');

  // Password form (set new password)
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  useEffect(() => {
    // Check if we're in recovery mode (user clicked link from email)
    const checkRecoveryMode = async () => {
      const { data } = await supabase.auth.getSession();
      
      // If there's a session and user came from recovery email, show password form
      if (data.session?.user) {
        setIsRecoveryMode(true);
      }
    };

    checkRecoveryMode();
  }, []);

  const handleRequestReset = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    
    try {
      emailSchema.parse({ email });
      setLoading(true);
      await resetPassword(email);
      setEmail('');
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(newErrors);
      }
    } finally {
      setLoading(false);
    }
  };

  const handleUpdatePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrors({});
    
    try {
      passwordSchema.parse({ password: newPassword, confirmPassword });
      setLoading(true);
      const result = await updatePassword(newPassword);
      
      if (result.error === null) {
        // Password updated successfully, redirect to login
        setTimeout(() => {
          navigate('/auth');
        }, 2000);
      }
    } catch (error) {
      if (error instanceof z.ZodError) {
        const newErrors: Record<string, string> = {};
        error.errors.forEach((err) => {
          if (err.path[0]) {
            newErrors[err.path[0] as string] = err.message;
          }
        });
        setErrors(newErrors);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center p-4 bg-gradient-to-br from-background via-background/95 to-primary/5">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="flex flex-col items-center mb-8 animate-fade-in">
          <img src={logoAristoEdge} alt="AristoEdge" className="h-16 w-auto mb-4" />
          <h1 className="text-3xl font-bold text-gradient mb-2">AristoEdge Pro</h1>
          <p className="text-muted-foreground text-sm">Resetowanie hasła</p>
        </div>

        {/* Reset Card */}
        <Card className="backdrop-blur-lg bg-card/80 border-primary/20 shadow-2xl">
          <CardHeader>
            <CardTitle>
              {isRecoveryMode ? 'Ustaw nowe hasło' : 'Zapomniałeś hasła?'}
            </CardTitle>
            <CardDescription>
              {isRecoveryMode 
                ? 'Wprowadź nowe hasło dla swojego konta'
                : 'Podaj swój adres email - wyślemy Ci link do zmiany hasła'
              }
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!isRecoveryMode ? (
              // Email form - request reset link
              <form onSubmit={handleRequestReset} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="email">Adres email</Label>
                  <Input
                    id="email"
                    type="email"
                    placeholder="twoj@email.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    className={errors.email ? 'border-destructive' : ''}
                  />
                  {errors.email && (
                    <p className="text-sm text-destructive">{errors.email}</p>
                  )}
                </div>

                <div className="space-y-3">
                  <Button
                    type="submit"
                    className="w-full"
                    disabled={loading}
                  >
                    {loading ? 'Wysyłanie...' : 'Wyślij link resetujący'}
                  </Button>

                  <Link to="/auth">
                    <Button
                      type="button"
                      variant="ghost"
                      className="w-full gap-2"
                    >
                      <ArrowLeft className="h-4 w-4" />
                      Powrót do logowania
                    </Button>
                  </Link>
                </div>

                <div className="mt-4 p-3 rounded-lg bg-primary/5 border border-primary/20">
                  <p className="text-xs text-muted-foreground">
                    ℹ️ Link do zmiany hasła będzie ważny przez 1 godzinę
                  </p>
                </div>
              </form>
            ) : (
              // Password form - set new password
              <form onSubmit={handleUpdatePassword} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="new-password">Nowe hasło</Label>
                  <Input
                    id="new-password"
                    type="password"
                    placeholder="••••••••"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    className={errors.password ? 'border-destructive' : ''}
                  />
                  {errors.password && (
                    <p className="text-sm text-destructive">{errors.password}</p>
                  )}
                </div>

                <div className="space-y-2">
                  <Label htmlFor="confirm-password">Potwierdź nowe hasło</Label>
                  <Input
                    id="confirm-password"
                    type="password"
                    placeholder="••••••••"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    className={errors.confirmPassword ? 'border-destructive' : ''}
                  />
                  {errors.confirmPassword && (
                    <p className="text-sm text-destructive">{errors.confirmPassword}</p>
                  )}
                </div>

                <Button
                  type="submit"
                  className="w-full"
                  disabled={loading}
                >
                  {loading ? 'Zmienianie hasła...' : 'Zmień hasło'}
                </Button>
              </form>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
