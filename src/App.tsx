import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { Layout } from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Alerts from "./pages/Alerts";
import Diagnostics from "./pages/Diagnostics";
import History from "./pages/History";
import Stats from "./pages/Stats";
import Integration from "./pages/Integration";
import Settings from "./pages/Settings";
import UserSettings from "./pages/UserSettings";
import Logs from "./pages/Logs";
import Auth from "./pages/Auth";
import ResetPassword from "./pages/ResetPassword";
import Admin from "./pages/Admin";
import ApiKeys from "./pages/ApiKeys";
import MigrateApiKeys from "./pages/MigrateApiKeys";
import Profile from "./pages/Profile";
import Security from "./pages/Security";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/auth" element={<Auth />} />
          <Route path="/reset-password" element={<ResetPassword />} />
          <Route path="*" element={
            <Layout>
              <Routes>
                <Route path="/" element={<Dashboard />} />
                <Route path="/alerts" element={<Alerts />} />
                <Route path="/diagnostics" element={<Diagnostics />} />
                <Route path="/history" element={<History />} />
                <Route path="/stats" element={<Stats />} />
                <Route path="/integration" element={<Integration />} />
                <Route path="/settings" element={<UserSettings />} />
                <Route path="/admin/settings" element={<Settings />} />
                <Route path="/logs" element={<Logs />} />
                <Route path="/admin" element={<Admin />} />
                <Route path="/settings/api-keys" element={<ApiKeys />} />
                <Route path="/settings/profile" element={<Profile />} />
                <Route path="/settings/security" element={<Security />} />
                <Route path="/migrate-api-keys" element={<MigrateApiKeys />} />
                <Route path="*" element={<NotFound />} />
              </Routes>
            </Layout>
          } />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
