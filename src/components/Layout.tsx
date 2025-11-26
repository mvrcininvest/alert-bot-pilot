import { Home, AlertCircle, History, BarChart3, Settings, FileText, Webhook, Power, AlertTriangle, LogOut, Shield, KeyRound } from "lucide-react";
import { NavLink } from "./NavLink";
import { cn } from "@/lib/utils";
import logoAristoEdge from "@/assets/logo-aristoedge.png";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { useNavigate } from "react-router-dom";
import { useEffect, useState } from "react";

const navigation = [
  { name: "Dashboard", href: "/", icon: Home },
  { name: "Alerty", href: "/alerts", icon: AlertCircle },
  { name: "Diagnostyka", href: "/diagnostics", icon: AlertCircle },
  { name: "Historia", href: "/history", icon: History },
  { name: "Statystyki", href: "/stats", icon: BarChart3 },
  { name: "Logi", href: "/logs", icon: FileText },
  { name: "Integracja", href: "/integration", icon: Webhook },
  { name: "Ustawienia", href: "/settings", icon: Settings },
  { name: "API Keys", href: "/settings/api-keys", icon: KeyRound },
];

const adminNavigation = [
  { name: "Panel Admina", href: "/admin", icon: Shield },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, loading, isAdmin, signOut } = useAuth();
  const navigate = useNavigate();
  const [checkingApiKeys, setCheckingApiKeys] = useState(true);
  const [hasApiKeys, setHasApiKeys] = useState(false);

  // Check if user has API keys
  useEffect(() => {
    if (!user) {
      setCheckingApiKeys(false);
      return;
    }

    const checkApiKeys = async () => {
      try {
        // First check if user is banned
        const { data: profile } = await supabase
          .from('profiles')
          .select('is_banned, ban_reason')
          .eq('id', user.id)
          .single();

        if (profile?.is_banned) {
          await signOut();
          toast({
            title: "Konto zablokowane",
            description: profile.ban_reason || "Twoje konto zostało zablokowane. Skontaktuj się z administratorem.",
            variant: "destructive",
          });
          navigate('/auth');
          return;
        }

        // Then check API keys
        const { data, error } = await supabase.functions.invoke('manage-api-keys', {
          body: { action: 'get' }
        });

        if (!error && data?.exists && data?.isActive) {
          setHasApiKeys(true);
        } else {
          setHasApiKeys(false);
        }
      } catch (error) {
        console.error('Error checking API keys:', error);
        setHasApiKeys(false);
      } finally {
        setCheckingApiKeys(false);
      }
    };

    checkApiKeys();
  }, [user]);

  // Check if user is online (seen in last 2 minutes)
  useEffect(() => {
    if (!user || !isAdmin) return;

    // Update own last_seen
    const updateLastSeen = async () => {
      await supabase.rpc('update_last_seen');
    };
    
    updateLastSeen();
    const interval = setInterval(updateLastSeen, 60000); // Every minute

    return () => clearInterval(interval);
  }, [user, isAdmin]);

  // Redirect to API keys setup if user doesn't have keys
  useEffect(() => {
    const currentPath = window.location.pathname;
    const allowedPaths = ['/settings/api-keys', '/migrate-api-keys', '/auth'];
    
    if (!loading && !checkingApiKeys && user && !hasApiKeys && !allowedPaths.includes(currentPath)) {
      // Redirect to normal API keys setup page
      navigate('/settings/api-keys');
    }
  }, [user, loading, checkingApiKeys, hasApiKeys, navigate]);

  const emergencyShutdownMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke('emergency-shutdown');
      
      if (error) throw error;
      if (!data?.success) throw new Error(data?.message || 'Emergency shutdown failed');
      
      return data;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["open-positions"] });
      toast({
        title: "🚨 Awaryjne Wyłączenie Wykonane",
        description: `Zamknięto ${data.positions_closed} pozycji. Bot wyłączony.`,
      });
    },
    onError: (error) => {
      toast({
        title: "Błąd Awaryjnego Wyłączenia",
        description: error instanceof Error ? error.message : "Nie udało się wykonać awaryjnego wyłączenia",
        variant: "destructive",
      });
    },
  });

  const handleLogout = async () => {
    await signOut();
    navigate('/auth');
  };

  if (loading || checkingApiKeys) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="animate-pulse text-muted-foreground">Ładowanie...</div>
      </div>
    );
  }

  if (!user) {
    return null;
  }

  const displayName = user.user_metadata?.display_name || user.email?.split('@')[0] || 'User';
  const initials = displayName
    .split(' ')
    .map((n: string) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  // Show simplified layout for users without API keys on setup/migration pages
  const isOnSetupPage = ['/settings/api-keys', '/migrate-api-keys'].includes(window.location.pathname);
  const showSimplifiedLayout = !hasApiKeys && isOnSetupPage;

  return (
    <div className="min-h-screen">
      {/* Top Navigation Bar */}
      <header className="fixed top-0 left-0 right-0 z-50 glass-card border-b">
        <div className="flex h-16 items-center justify-between px-6">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <img src={logoAristoEdge} alt="AristoEdge" className="h-12 w-auto object-contain" />

            {/* Navigation - only show if user has API keys */}
            {!showSimplifiedLayout && (
              <nav className="hidden lg:flex items-center gap-1">
                {navigation.map((item) => (
                  <NavLink
                    key={item.name}
                    to={item.href}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-secondary/50"
                    activeClassName="text-primary bg-primary/10 hover:bg-primary/15"
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="hidden xl:inline">{item.name}</span>
                  </NavLink>
                ))}
                
                {/* Admin Navigation */}
                {isAdmin && adminNavigation.map((item) => (
                  <NavLink
                    key={item.name}
                    to={item.href}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-muted-foreground transition-all hover:text-foreground hover:bg-secondary/50 border-l border-border/50 ml-1 pl-4"
                    activeClassName="text-primary bg-primary/10 hover:bg-primary/15"
                  >
                    <item.icon className="h-4 w-4" />
                    <span className="hidden xl:inline">{item.name}</span>
                  </NavLink>
                ))}
              </nav>
            )}
          </div>

          {/* Right side - User Info & Actions */}
          <div className="flex items-center gap-4">
            {/* User Info */}
            <div className="hidden lg:flex items-center gap-3 px-3 py-2 rounded-lg bg-secondary/50 border border-border/50">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs font-semibold bg-primary text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium text-foreground">{displayName}</span>
                  {isAdmin && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 border border-primary/20">
                      <Shield className="h-3 w-3 text-primary" />
                      <span className="text-[10px] font-semibold text-primary">ADMIN</span>
                    </span>
                  )}
                </div>
                <span className="text-xs text-muted-foreground truncate max-w-[150px]">{user?.email}</span>
              </div>
              <Button
                variant="ghost"
                size="icon"
                onClick={handleLogout}
                className="h-8 w-8 text-muted-foreground hover:text-foreground"
                title="Wyloguj"
              >
                <LogOut className="h-4 w-4" />
              </Button>
            </div>

            {/* Bot Status & Emergency - only show if user has API keys */}
            {!showSimplifiedLayout && (
              <>
                <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-profit/10 border border-profit/20">
                  <div className="h-2 w-2 rounded-full bg-profit animate-pulse" />
                  <span className="text-xs font-medium text-profit">Bot Aktywny</span>
                </div>

                <Button
                  variant="destructive"
                  size="sm"
                  onClick={() => {
                    if (confirm('⚠️ UWAGA!\n\nTo zamknie WSZYSTKIE otwarte pozycje i wyłączy bota.\n\nCzy na pewno chcesz kontynuować?')) {
                      emergencyShutdownMutation.mutate();
                    }
                  }}
                  disabled={emergencyShutdownMutation.isPending}
                  className="gap-2 bg-destructive/90 hover:bg-destructive"
                >
                  <AlertTriangle className="h-4 w-4" />
                  <span className="hidden sm:inline">
                    {emergencyShutdownMutation.isPending ? 'Wyłączanie...' : 'Emergency'}
                  </span>
                </Button>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main content */}
      <main className="pt-24 px-6 pb-8">
        <div className="max-w-[1600px] mx-auto animate-fade-in">
          {children}
        </div>
      </main>
    </div>
  );
}
