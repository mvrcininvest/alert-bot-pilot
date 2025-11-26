import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Separator } from '@/components/ui/separator';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Loader2, Upload, User, Mail, Bell, Save, X } from 'lucide-react';
import { Alert, AlertDescription } from '@/components/ui/alert';

interface ProfileData {
  display_name: string | null;
  avatar_url: string | null;
  email: string | null;
  notify_position_opened: boolean;
  notify_position_closed: boolean;
  notify_daily_summary: boolean;
  notify_loss_alerts: boolean;
  notify_bot_status: boolean;
}

export default function Profile() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [profile, setProfile] = useState<ProfileData>({
    display_name: '',
    avatar_url: null,
    email: '',
    notify_position_opened: true,
    notify_position_closed: true,
    notify_daily_summary: false,
    notify_loss_alerts: true,
    notify_bot_status: true,
  });

  useEffect(() => {
    if (user) {
      fetchProfile();
    }
  }, [user]);

  const fetchProfile = async () => {
    if (!user) return;
    
    setLoading(true);
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', user.id)
        .single();

      if (error) throw error;

      setProfile({
        display_name: data.display_name || '',
        avatar_url: data.avatar_url,
        email: data.email || user.email || '',
        notify_position_opened: data.notify_position_opened ?? true,
        notify_position_closed: data.notify_position_closed ?? true,
        notify_daily_summary: data.notify_daily_summary ?? false,
        notify_loss_alerts: data.notify_loss_alerts ?? true,
        notify_bot_status: data.notify_bot_status ?? true,
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Błąd ładowania profilu",
        description: error.message,
      });
    } finally {
      setLoading(false);
    }
  };

  const handleAvatarUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Validate file type
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/jpg'].includes(file.type)) {
      toast({
        variant: "destructive",
        title: "Nieprawidłowy format",
        description: "Dozwolone formaty: JPG, PNG, WEBP",
      });
      return;
    }

    // Validate file size (5MB)
    if (file.size > 5242880) {
      toast({
        variant: "destructive",
        title: "Plik za duży",
        description: "Maksymalny rozmiar pliku to 5MB",
      });
      return;
    }

    setUploadingAvatar(true);
    try {
      // Delete old avatar if exists
      if (profile.avatar_url) {
        const oldPath = profile.avatar_url.split('/').pop();
        if (oldPath) {
          await supabase.storage
            .from('avatars')
            .remove([`${user.id}/${oldPath}`]);
        }
      }

      // Upload new avatar
      const fileExt = file.name.split('.').pop();
      const fileName = `${Date.now()}.${fileExt}`;
      const filePath = `${user.id}/${fileName}`;

      const { error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      // Get public URL
      const { data: { publicUrl } } = supabase.storage
        .from('avatars')
        .getPublicUrl(filePath);

      // Update profile
      const { error: updateError } = await supabase
        .from('profiles')
        .update({ avatar_url: publicUrl })
        .eq('id', user.id);

      if (updateError) throw updateError;

      setProfile(prev => ({ ...prev, avatar_url: publicUrl }));
      
      toast({
        title: "Avatar zaktualizowany",
        description: "Twój awatar został pomyślnie zmieniony",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Błąd uploadu",
        description: error.message,
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleRemoveAvatar = async () => {
    if (!user || !profile.avatar_url) return;

    setUploadingAvatar(true);
    try {
      // Delete from storage
      const oldPath = profile.avatar_url.split('/').pop();
      if (oldPath) {
        await supabase.storage
          .from('avatars')
          .remove([`${user.id}/${oldPath}`]);
      }

      // Update profile
      const { error } = await supabase
        .from('profiles')
        .update({ avatar_url: null })
        .eq('id', user.id);

      if (error) throw error;

      setProfile(prev => ({ ...prev, avatar_url: null }));
      
      toast({
        title: "Avatar usunięty",
        description: "Twój awatar został usunięty",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Błąd usuwania",
        description: error.message,
      });
    } finally {
      setUploadingAvatar(false);
    }
  };

  const handleSaveProfile = async () => {
    if (!user) return;

    setSaving(true);
    try {
      const { error } = await supabase
        .from('profiles')
        .update({
          display_name: profile.display_name?.trim() || null,
          notify_position_opened: profile.notify_position_opened,
          notify_position_closed: profile.notify_position_closed,
          notify_daily_summary: profile.notify_daily_summary,
          notify_loss_alerts: profile.notify_loss_alerts,
          notify_bot_status: profile.notify_bot_status,
        })
        .eq('id', user.id);

      if (error) throw error;

      toast({
        title: "Profil zapisany",
        description: "Twoje zmiany zostały zapisane pomyślnie",
      });
    } catch (error: any) {
      toast({
        variant: "destructive",
        title: "Błąd zapisywania",
        description: error.message,
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const initials = (profile.display_name || profile.email || 'U')
    .split(' ')
    .map(n => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="space-y-6 max-w-4xl mx-auto">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-gradient flex items-center gap-3">
          <User className="h-8 w-8 text-primary" />
          Profil Użytkownika
        </h1>
        <p className="text-muted-foreground mt-2">
          Zarządzaj swoim profilem i preferencjami powiadomień
        </p>
      </div>

      {/* Profile Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle>Informacje Profilowe</CardTitle>
          <CardDescription>
            Zaktualizuj swoje dane osobowe i avatar
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Avatar Section */}
          <div className="flex items-center gap-6">
            <Avatar className="h-24 w-24">
              <AvatarImage src={profile.avatar_url || undefined} alt={profile.display_name || 'Avatar'} />
              <AvatarFallback className="text-2xl bg-primary/10 text-primary">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="flex-1 space-y-3">
              <div>
                <Label htmlFor="avatar-upload" className="text-sm font-medium">
                  Avatar
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  JPG, PNG lub WEBP. Maksymalnie 5MB.
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  disabled={uploadingAvatar}
                  asChild
                >
                  <label htmlFor="avatar-upload" className="cursor-pointer">
                    {uploadingAvatar ? (
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    ) : (
                      <Upload className="h-4 w-4 mr-2" />
                    )}
                    Prześlij nowy
                  </label>
                </Button>
                <input
                  id="avatar-upload"
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/jpg"
                  onChange={handleAvatarUpload}
                  className="hidden"
                />
                {profile.avatar_url && (
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={handleRemoveAvatar}
                    disabled={uploadingAvatar}
                  >
                    <X className="h-4 w-4 mr-2" />
                    Usuń
                  </Button>
                )}
              </div>
            </div>
          </div>

          <Separator />

          {/* Display Name */}
          <div className="space-y-2">
            <Label htmlFor="display_name">Nazwa Wyświetlana</Label>
            <Input
              id="display_name"
              value={profile.display_name || ''}
              onChange={(e) => setProfile(prev => ({ ...prev, display_name: e.target.value }))}
              placeholder="Twoja nazwa"
              maxLength={100}
            />
            <p className="text-xs text-muted-foreground">
              To nazwa będzie wyświetlana w systemie
            </p>
          </div>

          {/* Email (Read-only) */}
          <div className="space-y-2">
            <Label htmlFor="email">Email</Label>
            <div className="relative">
              <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                id="email"
                value={profile.email || ''}
                disabled
                className="pl-9"
              />
            </div>
            <Alert>
              <AlertDescription className="text-xs">
                Email nie może być zmieniony z tego miejsca. Skontaktuj się z administratorem, jeśli potrzebujesz zmienić adres email.
              </AlertDescription>
            </Alert>
          </div>
        </CardContent>
      </Card>

      {/* Notification Settings Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Bell className="h-5 w-5" />
            Powiadomienia Email
          </CardTitle>
          <CardDescription>
            Wybierz, o jakich zdarzeniach chcesz otrzymywać powiadomienia
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="notify_position_opened" className="text-base">
                Otwarte Pozycje
              </Label>
              <p className="text-sm text-muted-foreground">
                Powiadom mnie, gdy zostanie otwarta nowa pozycja
              </p>
            </div>
            <Switch
              id="notify_position_opened"
              checked={profile.notify_position_opened}
              onCheckedChange={(checked) => 
                setProfile(prev => ({ ...prev, notify_position_opened: checked }))
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="notify_position_closed" className="text-base">
                Zamknięte Pozycje
              </Label>
              <p className="text-sm text-muted-foreground">
                Powiadom mnie, gdy pozycja zostanie zamknięta
              </p>
            </div>
            <Switch
              id="notify_position_closed"
              checked={profile.notify_position_closed}
              onCheckedChange={(checked) => 
                setProfile(prev => ({ ...prev, notify_position_closed: checked }))
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="notify_loss_alerts" className="text-base">
                Alerty Strat
              </Label>
              <p className="text-sm text-muted-foreground">
                Powiadom mnie o stratach przekraczających limit dzienny
              </p>
            </div>
            <Switch
              id="notify_loss_alerts"
              checked={profile.notify_loss_alerts}
              onCheckedChange={(checked) => 
                setProfile(prev => ({ ...prev, notify_loss_alerts: checked }))
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="notify_bot_status" className="text-base">
                Status Bota
              </Label>
              <p className="text-sm text-muted-foreground">
                Powiadom mnie o zmianach statusu bota (uruchomienie, zatrzymanie, błędy)
              </p>
            </div>
            <Switch
              id="notify_bot_status"
              checked={profile.notify_bot_status}
              onCheckedChange={(checked) => 
                setProfile(prev => ({ ...prev, notify_bot_status: checked }))
              }
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="notify_daily_summary" className="text-base">
                Dzienny Raport
              </Label>
              <p className="text-sm text-muted-foreground">
                Otrzymuj dzienne podsumowanie wszystkich transakcji
              </p>
            </div>
            <Switch
              id="notify_daily_summary"
              checked={profile.notify_daily_summary}
              onCheckedChange={(checked) => 
                setProfile(prev => ({ ...prev, notify_daily_summary: checked }))
              }
            />
          </div>
        </CardContent>
      </Card>

      {/* Save Button */}
      <div className="flex justify-end">
        <Button onClick={handleSaveProfile} disabled={saving} size="lg">
          {saving ? (
            <>
              <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              Zapisywanie...
            </>
          ) : (
            <>
              <Save className="h-4 w-4 mr-2" />
              Zapisz Zmiany
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
