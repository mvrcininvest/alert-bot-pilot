import { Home, AlertCircle, History, BarChart3, Settings, FileText, Webhook, Power, AlertTriangle, LogOut } from "lucide-react";
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
import { useEffect } from "react";

const navigation = [
  { name: "Dashboard", href: "/", icon: Home },
  { name: "Alerty", href: "/alerts", icon: AlertCircle },
  { name: "Diagnostyka", href: "/diagnostics", icon: AlertCircle },
  { name: "Historia", href: "/history", icon: History },
  { name: "Statystyki", href: "/stats", icon: BarChart3 },
  { name: "Logi", href: "/logs", icon: FileText },
  { name: "Integracja", href: "/integration", icon: Webhook },
  { name: "Ustawienia", href: "/settings", icon: Settings },
];

export function Layout({ children }: { children: React.ReactNode }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { user, loading, signOut } = useAuth();
  const navigate = useNavigate();

  // Redirect to auth if not logged in
  useEffect(() => {
    if (!loading && !user) {
      navigate('/auth');
    }
  }, [user, loading, navigate]);

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

  if (loading) {
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

  return (
    <div className="min-h-screen">
      {/* Top Navigation Bar */}
      <header className="fixed top-0 left-0 right-0 z-50 glass-card border-b">
        <div className="flex h-16 items-center justify-between px-6">
          {/* Logo */}
          <div className="flex items-center gap-8">
            <img src={logoAristoEdge} alt="AristoEdge" className="h-12 w-auto object-contain" />

            {/* Navigation */}
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
            </nav>
          </div>

          {/* Right side - User Info, Status & Emergency */}
          <div className="flex items-center gap-4">
            {/* User Info */}
            <div className="hidden lg:flex items-center gap-3 px-3 py-2 rounded-lg bg-secondary/50 border border-border/50">
              <Avatar className="h-8 w-8">
                <AvatarFallback className="text-xs font-semibold bg-primary text-primary-foreground">
                  {initials}
                </AvatarFallback>
              </Avatar>
              <div className="flex flex-col">
                <span className="text-sm font-medium text-foreground">{displayName}</span>
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

            {/* Bot Status */}
            <div className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-profit/10 border border-profit/20">
              <div className="h-2 w-2 rounded-full bg-profit animate-pulse" />
              <span className="text-xs font-medium text-profit">Bot Aktywny</span>
            </div>

            {/* Emergency Shutdown */}
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
