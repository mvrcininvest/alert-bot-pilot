import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Shield, User, CheckCircle, XCircle, Loader2, RefreshCw } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';

interface UserData {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  created_at: string;
  roles: string[];
  bot_active: boolean;
  email_confirmed: boolean;
}

export default function Admin() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!authLoading && !isAdmin) {
      toast({
        variant: "destructive",
        title: "Brak dostępu",
        description: "Nie masz uprawnień do tej strony.",
      });
      navigate('/');
    }
  }, [isAdmin, authLoading, navigate, toast]);

  const fetchUsers = async () => {
    setLoading(true);
    try {
      // Fetch profiles with roles and settings
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email, display_name, is_active, created_at')
        .order('created_at', { ascending: false });

      if (profilesError) throw profilesError;

      // Fetch roles for all users
      const { data: roles, error: rolesError } = await supabase
        .from('user_roles')
        .select('user_id, role');

      if (rolesError) throw rolesError;

      // Fetch settings for all users
      const { data: settings, error: settingsError } = await supabase
        .from('user_settings')
        .select('user_id, bot_active');

      if (settingsError) throw settingsError;

      // Check email confirmation from auth.users
      const { data: authData, error: authError } = await supabase.auth.admin.listUsers();
      const authUsers = authData?.users || [];

      // Combine data
      const usersData: UserData[] = (profiles || []).map(profile => {
        const userRoles = (roles || [])
          .filter(r => r.user_id === profile.id)
          .map(r => r.role);
        
        const userSettings = settings?.find(s => s.user_id === profile.id);
        const authUser = authUsers?.find((u: any) => u.id === profile.id);

        return {
          ...profile,
          roles: userRoles,
          bot_active: userSettings?.bot_active ?? true,
          email_confirmed: authUser?.email_confirmed_at !== null,
        };
      });

      setUsers(usersData);
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Błąd ładowania użytkowników",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isAdmin) {
      fetchUsers();
    }
  }, [isAdmin]);

  const toggleUserActive = async (userId: string, currentStatus: boolean) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({ is_active: !currentStatus })
        .eq('id', userId);

      if (error) throw error;

      toast({
        title: "Status zmieniony",
        description: `Konto zostało ${!currentStatus ? 'aktywowane' : 'dezaktywowane'}.`,
      });

      fetchUsers();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Błąd zmiany statusu",
        description: error.message,
      });
    }
  };

  const toggleAdminRole = async (userId: string, hasAdminRole: boolean) => {
    try {
      if (hasAdminRole) {
        // Remove admin role
        const { error } = await supabase
          .from('user_roles')
          .delete()
          .eq('user_id', userId)
          .eq('role', 'admin');

        if (error) throw error;

        toast({
          title: "Rola usunięta",
          description: "Uprawnienia administratora zostały odebrane.",
        });
      } else {
        // Add admin role
        const { error } = await supabase
          .from('user_roles')
          .insert({ user_id: userId, role: 'admin' });

        if (error) throw error;

        toast({
          title: "Rola nadana",
          description: "Użytkownik otrzymał uprawnienia administratora.",
        });
      }

      fetchUsers();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Błąd zmiany roli",
        description: error.message,
      });
    }
  };

  if (authLoading || !isAdmin) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gradient flex items-center gap-3">
            <Shield className="h-8 w-8 text-primary" />
            Panel Administracyjny
          </h1>
          <p className="text-muted-foreground mt-2">
            Zarządzanie użytkownikami, rolami i uprawnieniami
          </p>
        </div>
        <Button
          onClick={fetchUsers}
          variant="outline"
          className="gap-2"
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Odśwież
        </Button>
      </div>

      {/* Stats Cards */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Wszyscy użytkownicy</CardDescription>
            <CardTitle className="text-3xl">{users.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Aktywni</CardDescription>
            <CardTitle className="text-3xl text-profit">
              {users.filter(u => u.is_active).length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Administratorzy</CardDescription>
            <CardTitle className="text-3xl text-primary">
              {users.filter(u => u.roles.includes('admin')).length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Boty aktywne</CardDescription>
            <CardTitle className="text-3xl text-accent">
              {users.filter(u => u.bot_active).length}
            </CardTitle>
          </CardHeader>
        </Card>
      </div>

      {/* Users Table */}
      <Card>
        <CardHeader>
          <CardTitle>Lista Użytkowników</CardTitle>
          <CardDescription>
            Zarządzaj kontami użytkowników, rolami i uprawnieniami
          </CardDescription>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8">
              <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
            </div>
          ) : users.length === 0 ? (
            <div className="text-center py-8 text-muted-foreground">
              Brak użytkowników w systemie
            </div>
          ) : (
            <div className="rounded-md border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Użytkownik</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Bot</TableHead>
                    <TableHead>Email</TableHead>
                    <TableHead>Data utworzenia</TableHead>
                    <TableHead className="text-right">Akcje</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {users.map((userData) => {
                    const initials = (userData.display_name || userData.email)
                      .split(' ')
                      .map(n => n[0])
                      .join('')
                      .toUpperCase()
                      .slice(0, 2);

                    const isCurrentUser = userData.id === user?.id;
                    const hasAdminRole = userData.roles.includes('admin');

                    return (
                      <TableRow key={userData.id}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                {initials}
                              </AvatarFallback>
                            </Avatar>
                            <span className="font-medium">
                              {userData.display_name || 'Użytkownik'}
                              {isCurrentUser && (
                                <span className="text-xs text-muted-foreground ml-2">(Ty)</span>
                              )}
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {userData.email}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {userData.roles.map(role => (
                              <Badge
                                key={role}
                                variant={role === 'admin' ? 'default' : 'secondary'}
                                className="text-xs"
                              >
                                {role === 'admin' ? (
                                  <Shield className="h-3 w-3 mr-1" />
                                ) : (
                                  <User className="h-3 w-3 mr-1" />
                                )}
                                {role}
                              </Badge>
                            ))}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={userData.is_active ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {userData.is_active ? (
                              <>
                                <CheckCircle className="h-3 w-3 mr-1" />
                                Aktywny
                              </>
                            ) : (
                              <>
                                <XCircle className="h-3 w-3 mr-1" />
                                Nieaktywny
                              </>
                            )}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={userData.bot_active ? 'default' : 'outline'}
                            className="text-xs"
                          >
                            {userData.bot_active ? 'ON' : 'OFF'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={userData.email_confirmed ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {userData.email_confirmed ? '✓' : '✗'}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {new Date(userData.created_at).toLocaleDateString('pl-PL')}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            <Button
                              variant={hasAdminRole ? 'destructive' : 'default'}
                              size="sm"
                              onClick={() => toggleAdminRole(userData.id, hasAdminRole)}
                              disabled={isCurrentUser}
                              title={isCurrentUser ? 'Nie możesz zmienić własnej roli' : ''}
                            >
                              <Shield className="h-3 w-3 mr-1" />
                              {hasAdminRole ? 'Odbierz' : 'Nadaj'}
                            </Button>
                            <Switch
                              checked={userData.is_active}
                              onCheckedChange={() => toggleUserActive(userData.id, userData.is_active)}
                              disabled={isCurrentUser}
                              title={isCurrentUser ? 'Nie możesz dezaktywować własnego konta' : ''}
                            />
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
