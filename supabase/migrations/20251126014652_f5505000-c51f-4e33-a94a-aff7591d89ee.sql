-- Create enums for roles and settings modes
CREATE TYPE app_role AS ENUM ('admin', 'user');
CREATE TYPE settings_mode AS ENUM ('custom', 'copy_admin');

-- Create profiles table
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT,
  display_name TEXT,
  avatar_url TEXT,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

-- Create user_roles table
CREATE TABLE public.user_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL,
  role app_role NOT NULL DEFAULT 'user',
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE (user_id, role)
);

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- Create security definer function to check roles
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.user_roles
    WHERE user_id = _user_id
      AND role = _role
  )
$$;

-- Create user_settings table with flexible modes
CREATE TABLE public.user_settings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE NOT NULL UNIQUE,
  
  -- Mode selectors (independent for each category)
  tier_mode settings_mode DEFAULT 'copy_admin',
  sltp_mode settings_mode DEFAULT 'copy_admin',
  money_mode settings_mode DEFAULT 'copy_admin',
  
  -- Bot control (always user-specific)
  bot_active BOOLEAN DEFAULT true,
  
  -- Tier filtering settings (used when tier_mode = 'custom')
  filter_by_tier BOOLEAN DEFAULT false,
  allowed_tiers TEXT[] DEFAULT ARRAY['Platinum', 'Premium', 'Standard', 'Quick'],
  excluded_tiers TEXT[] DEFAULT ARRAY[]::text[],
  
  -- SL/TP settings (used when sltp_mode = 'custom')
  calculator_type calculator_type DEFAULT 'simple_percent',
  sl_method sl_method DEFAULT 'percent_entry',
  simple_sl_percent NUMERIC DEFAULT 1.5,
  simple_tp_percent NUMERIC DEFAULT 3.0,
  simple_tp2_percent NUMERIC,
  simple_tp3_percent NUMERIC,
  rr_ratio NUMERIC DEFAULT 2.0,
  rr_adaptive BOOLEAN DEFAULT false,
  rr_sl_percent_margin NUMERIC DEFAULT 2.0,
  atr_sl_multiplier NUMERIC DEFAULT 2.0,
  atr_tp_multiplier NUMERIC DEFAULT 3.0,
  atr_tp2_multiplier NUMERIC,
  atr_tp3_multiplier NUMERIC,
  sl_to_breakeven BOOLEAN DEFAULT true,
  breakeven_trigger_tp INTEGER DEFAULT 1,
  trailing_stop BOOLEAN DEFAULT false,
  trailing_stop_trigger_tp INTEGER DEFAULT 1,
  trailing_stop_distance NUMERIC DEFAULT 1.0,
  tp_strategy tp_strategy DEFAULT 'partial_close',
  tp_levels INTEGER DEFAULT 1,
  tp1_close_percent NUMERIC DEFAULT 100,
  tp2_close_percent NUMERIC DEFAULT 0,
  tp3_close_percent NUMERIC DEFAULT 0,
  tp1_rr_ratio NUMERIC DEFAULT 1.5,
  tp2_rr_ratio NUMERIC DEFAULT 2.5,
  tp3_rr_ratio NUMERIC DEFAULT 3.5,
  adaptive_tp_spacing BOOLEAN DEFAULT false,
  adaptive_tp_high_volatility_multiplier NUMERIC DEFAULT 1.3,
  adaptive_tp_low_volatility_multiplier NUMERIC DEFAULT 0.9,
  momentum_based_tp BOOLEAN DEFAULT false,
  momentum_weak_multiplier NUMERIC DEFAULT 0.9,
  momentum_moderate_multiplier NUMERIC DEFAULT 1.1,
  momentum_strong_multiplier NUMERIC DEFAULT 1.3,
  adaptive_rr BOOLEAN DEFAULT false,
  adaptive_rr_weak_signal NUMERIC DEFAULT 0.8,
  adaptive_rr_standard NUMERIC DEFAULT 1.0,
  adaptive_rr_strong NUMERIC DEFAULT 1.2,
  adaptive_rr_very_strong NUMERIC DEFAULT 1.5,
  
  -- Money management settings (used when money_mode = 'custom')
  position_sizing_type TEXT DEFAULT 'fixed_usdt',
  position_size_value NUMERIC DEFAULT 100,
  max_open_positions INTEGER DEFAULT 3,
  daily_loss_limit NUMERIC DEFAULT 500,
  daily_loss_percent NUMERIC DEFAULT 5.0,
  loss_limit_type TEXT DEFAULT 'fixed_usdt',
  default_leverage INTEGER DEFAULT 10,
  use_alert_leverage BOOLEAN DEFAULT true,
  symbol_leverage_overrides JSONB DEFAULT '{}'::jsonb,
  require_profit_for_same_direction BOOLEAN DEFAULT true,
  pnl_threshold_percent NUMERIC DEFAULT 0.5,
  alert_strength_threshold NUMERIC DEFAULT 0.20,
  duplicate_alert_handling BOOLEAN DEFAULT true,
  
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.user_settings ENABLE ROW LEVEL SECURITY;

-- Create trigger function for automatic profile and settings creation
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Insert profile
  INSERT INTO public.profiles (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  );
  
  -- Insert default user role
  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');
  
  -- Insert default user settings (all modes set to copy_admin by default)
  INSERT INTO public.user_settings (user_id)
  VALUES (NEW.id);
  
  RETURN NEW;
END;
$$;

-- Create trigger on auth.users
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Create trigger to update updated_at on profiles
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- Create trigger to update updated_at on user_settings
CREATE TRIGGER update_user_settings_updated_at
  BEFORE UPDATE ON public.user_settings
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();

-- RLS Policies for profiles
CREATE POLICY "Users can view their own profile"
  ON public.profiles
  FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON public.profiles
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can update their own profile"
  ON public.profiles
  FOR UPDATE
  USING (auth.uid() = id);

CREATE POLICY "Admins can update all profiles"
  ON public.profiles
  FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for user_roles
CREATE POLICY "Users can view their own roles"
  ON public.user_roles
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all roles"
  ON public.user_roles
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can insert roles"
  ON public.user_roles
  FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can update roles"
  ON public.user_roles
  FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Only admins can delete roles"
  ON public.user_roles
  FOR DELETE
  USING (public.has_role(auth.uid(), 'admin'));

-- RLS Policies for user_settings
CREATE POLICY "Users can view their own settings"
  ON public.user_settings
  FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all settings"
  ON public.user_settings
  FOR SELECT
  USING (public.has_role(auth.uid(), 'admin'));

CREATE POLICY "Users can update their own settings"
  ON public.user_settings
  FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can update all settings"
  ON public.user_settings
  FOR UPDATE
  USING (public.has_role(auth.uid(), 'admin'));