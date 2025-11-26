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
import { Shield, User, CheckCircle, XCircle, Loader2, RefreshCw, Ban, Clock, Activity } from 'lucide-react';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';

interface UserData {
  id: string;
  email: string;
  display_name: string;
  is_active: boolean;
  is_banned: boolean;
  ban_reason: string | null;
  banned_at: string | null;
  last_seen_at: string | null;
  created_at: string;
  roles: string[];
  bot_active: boolean;
  email_confirmed: boolean;
  has_api_keys: boolean;
}

export default function Admin() {
  const { user, isAdmin, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const { toast } = useToast();
  const [users, setUsers] = useState<UserData[]>([]);
  const [loading, setLoading] = useState(true);
  const [banDialogOpen, setBanDialogOpen] = useState(false);
  const [selectedUser, setSelectedUser] = useState<UserData | null>(null);
  const [banReason, setBanReason] = useState('');

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
      // Fetch profiles with additional fields
      const { data: profiles, error: profilesError } = await supabase
        .from('profiles')
        .select('id, email, display_name, is_active, is_banned, ban_reason, banned_at, last_seen_at, created_at')
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

      // Check API keys
      const { data: apiKeys, error: apiKeysError } = await supabase
        .from('user_api_keys')
        .select('user_id, is_active');

      if (apiKeysError) throw apiKeysError;

      // Check email confirmation from auth.users
      const { data: authData, error: authError } = await supabase.auth.admin.listUsers();
      const authUsers = authData?.users || [];

      // Combine data
      const usersData: UserData[] = (profiles || []).map(profile => {
        const userRoles = (roles || [])
          .filter(r => r.user_id === profile.id)
          .map(r => r.role);
        
        const userSettings = settings?.find(s => s.user_id === profile.id);
        const userApiKeys = apiKeys?.find(k => k.user_id === profile.id);
        const authUser = authUsers?.find((u: any) => u.id === profile.id);

        return {
          ...profile,
          roles: userRoles,
          bot_active: userSettings?.bot_active ?? true,
          email_confirmed: authUser?.email_confirmed_at !== null,
          has_api_keys: !!userApiKeys?.is_active,
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
      
      // Setup realtime subscription for profile updates
      const channel = supabase
        .channel('admin-profiles-changes')
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'profiles'
          },
          () => {
            fetchUsers(); // Refresh when profiles change
          }
        )
        .subscribe();

      return () => {
        supabase.removeChannel(channel);
      };
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

  const handleBanUser = async () => {
    if (!selectedUser || !banReason.trim()) {
      toast({
        variant: "destructive",
        title: "Błąd",
        description: "Powód bana jest wymagany",
      });
      return;
    }

    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          is_banned: true,
          ban_reason: banReason,
          banned_at: new Date().toISOString(),
          banned_by: user?.id,
          is_active: false, // Also deactivate account
        })
        .eq('id', selectedUser.id);

      if (error) throw error;

      toast({
        title: "Użytkownik zbanowany",
        description: `${selectedUser.display_name || selectedUser.email} został zbanowany.`,
      });

      setBanDialogOpen(false);
      setBanReason('');
      setSelectedUser(null);
      fetchUsers();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Błąd banowania",
        description: error.message,
      });
    }
  };

  const handleUnbanUser = async (userId: string) => {
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          is_banned: false,
          ban_reason: null,
          banned_at: null,
          banned_by: null,
          is_active: true, // Reactivate account
        })
        .eq('id', userId);

      if (error) throw error;

      toast({
        title: "Ban usunięty",
        description: "Użytkownik został odbanowany.",
      });

      fetchUsers();
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Błąd odbanowania",
        description: error.message,
      });
    }
  };

  const isUserOnline = (lastSeen: string | null): boolean => {
    if (!lastSeen) return false;
    const twoMinutesAgo = new Date(Date.now() - 2 * 60 * 1000);
    return new Date(lastSeen) > twoMinutesAgo;
  };

  const formatLastSeen = (lastSeen: string | null): string => {
    if (!lastSeen) return 'Nigdy';
    
    const now = new Date();
    const seen = new Date(lastSeen);
    const diffMs = now.getTime() - seen.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 2) return 'Online teraz';
    if (diffMins < 60) return `${diffMins} min temu`;
    if (diffHours < 24) return `${diffHours}h temu`;
    if (diffDays < 7) return `${diffDays} dni temu`;
    return seen.toLocaleDateString('pl-PL');
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
      <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Wszyscy użytkownicy</CardDescription>
            <CardTitle className="text-3xl">{users.length}</CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Online teraz</CardDescription>
            <CardTitle className="text-3xl text-profit">
              {users.filter(u => isUserOnline(u.last_seen_at)).length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Aktywni</CardDescription>
            <CardTitle className="text-3xl text-primary">
              {users.filter(u => u.is_active && !u.is_banned).length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Zbanowani</CardDescription>
            <CardTitle className="text-3xl text-destructive">
              {users.filter(u => u.is_banned).length}
            </CardTitle>
          </CardHeader>
        </Card>
        <Card>
          <CardHeader className="pb-3">
            <CardDescription>Z kluczami API</CardDescription>
            <CardTitle className="text-3xl text-accent">
              {users.filter(u => u.has_api_keys).length}
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
                    <TableHead>Status</TableHead>
                    <TableHead>Ostatnia aktywność</TableHead>
                    <TableHead>Role</TableHead>
                    <TableHead>Bot</TableHead>
                    <TableHead>API</TableHead>
                    <TableHead>Email</TableHead>
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
                      <TableRow key={userData.id} className={userData.is_banned ? 'opacity-60' : ''}>
                        <TableCell>
                          <div className="flex items-center gap-3">
                            <Avatar className="h-8 w-8">
                              <AvatarFallback className="text-xs bg-primary/10 text-primary">
                                {initials}
                              </AvatarFallback>
                            </Avatar>
                            <div className="flex flex-col">
                              <span className="font-medium flex items-center gap-2">
                                {userData.display_name || 'Użytkownik'}
                                {isUserOnline(userData.last_seen_at) && (
                                  <span className="h-2 w-2 rounded-full bg-profit animate-pulse" title="Online teraz" />
                                )}
                                {isCurrentUser && (
                                  <span className="text-xs text-muted-foreground">(Ty)</span>
                                )}
                              </span>
                              {userData.is_banned && (
                                <span className="text-xs text-destructive flex items-center gap-1">
                                  <Ban className="h-3 w-3" />
                                  Zbanowany
                                </span>
                              )}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {userData.email}
                        </TableCell>
                        <TableCell>
                          {userData.is_banned ? (
                            <Badge variant="destructive" className="text-xs">
                              <Ban className="h-3 w-3 mr-1" />
                              Zbanowany
                            </Badge>
                          ) : userData.is_active ? (
                            <Badge variant="default" className="text-xs">
                              <CheckCircle className="h-3 w-3 mr-1" />
                              Aktywny
                            </Badge>
                          ) : (
                            <Badge variant="secondary" className="text-xs">
                              <XCircle className="h-3 w-3 mr-1" />
                              Nieaktywny
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-2 text-sm">
                            {isUserOnline(userData.last_seen_at) ? (
                              <>
                                <Activity className="h-3 w-3 text-profit" />
                                <span className="text-profit font-medium">Online</span>
                              </>
                            ) : (
                              <>
                                <Clock className="h-3 w-3 text-muted-foreground" />
                                <span className="text-muted-foreground">{formatLastSeen(userData.last_seen_at)}</span>
                              </>
                            )}
                          </div>
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
                            variant={userData.bot_active ? 'default' : 'outline'}
                            className="text-xs"
                          >
                            {userData.bot_active ? 'ON' : 'OFF'}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={userData.has_api_keys ? 'default' : 'secondary'}
                            className="text-xs"
                          >
                            {userData.has_api_keys ? '✓' : '✗'}
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
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-2">
                            {userData.is_banned ? (
                              <Button
                                variant="outline"
                                size="sm"
                                onClick={() => handleUnbanUser(userData.id)}
                                disabled={isCurrentUser}
                              >
                                Odbanuj
                              </Button>
                            ) : (
                              <Button
                                variant="destructive"
                                size="sm"
                                onClick={() => {
                                  setSelectedUser(userData);
                                  setBanDialogOpen(true);
                                }}
                                disabled={isCurrentUser}
                              >
                                <Ban className="h-3 w-3 mr-1" />
                                Banuj
                              </Button>
                            )}
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
                              disabled={isCurrentUser || userData.is_banned}
                              title={isCurrentUser ? 'Nie możesz dezaktywować własnego konta' : userData.is_banned ? 'Odbanuj najpierw użytkownika' : ''}
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

      {/* Ban Dialog */}
      <Dialog open={banDialogOpen} onOpenChange={setBanDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Zbanuj użytkownika</DialogTitle>
            <DialogDescription>
              Zbanowanie użytkownika {selectedUser?.display_name || selectedUser?.email} zablokuje dostęp do systemu.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="ban-reason">Powód bana (wymagane)</Label>
              <Textarea
                id="ban-reason"
                placeholder="np. Naruszenie regulaminu, spam, nieodpowiednie zachowanie..."
                value={banReason}
                onChange={(e) => setBanReason(e.target.value)}
                rows={3}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => {
              setBanDialogOpen(false);
              setBanReason('');
              setSelectedUser(null);
            }}>
              Anuluj
            </Button>
            <Button variant="destructive" onClick={handleBanUser} disabled={!banReason.trim()}>
              <Ban className="h-4 w-4 mr-2" />
              Zbanuj użytkownika
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
