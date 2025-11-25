import { Home, AlertCircle, TrendingUp, History, BarChart3, Settings, Activity } from "lucide-react";
import { NavLink } from "./NavLink";
import { cn } from "@/lib/utils";

const navigation = [
  { name: "Dashboard", href: "/", icon: Home },
  { name: "Alerty", href: "/alerts", icon: AlertCircle },
  { name: "Otwarte Pozycje", href: "/positions", icon: TrendingUp },
  { name: "Historia", href: "/history", icon: History },
  { name: "Statystyki", href: "/stats", icon: BarChart3 },
  { name: "Ustawienia", href: "/settings", icon: Settings },
];

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background">
      {/* Sidebar */}
      <div className="fixed inset-y-0 left-0 z-50 w-64 bg-card border-r border-border">
        <div className="flex h-full flex-col">
          {/* Logo */}
          <div className="flex h-16 items-center gap-2 border-b border-border px-6">
            <Activity className="h-6 w-6 text-primary" />
            <span className="text-xl font-bold">TradingBot</span>
          </div>

          {/* Navigation */}
          <nav className="flex-1 space-y-1 px-3 py-4">
            {navigation.map((item) => (
              <NavLink
                key={item.name}
                to={item.href}
                className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground"
                activeClassName="bg-accent text-accent-foreground"
              >
                <item.icon className="h-5 w-5" />
                {item.name}
              </NavLink>
            ))}
          </nav>

          {/* Status */}
          <div className="border-t border-border p-4">
            <div className="flex items-center gap-2">
              <div className="h-2 w-2 rounded-full bg-profit animate-pulse" />
              <span className="text-xs text-muted-foreground">Bot aktywny</span>
            </div>
          </div>
        </div>
      </div>

      {/* Main content */}
      <div className="pl-64">
        <main className="p-6">{children}</main>
      </div>
    </div>
  );
}
