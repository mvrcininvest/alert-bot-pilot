-- Add last_seen_at and is_banned to profiles
ALTER TABLE public.profiles
ADD COLUMN last_seen_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN is_banned BOOLEAN DEFAULT false,
ADD COLUMN ban_reason TEXT,
ADD COLUMN banned_at TIMESTAMP WITH TIME ZONE,
ADD COLUMN banned_by UUID;

-- Create index for performance
CREATE INDEX idx_profiles_last_seen ON public.profiles(last_seen_at DESC);
CREATE INDEX idx_profiles_is_banned ON public.profiles(is_banned);

-- Function to update last_seen_at
CREATE OR REPLACE FUNCTION public.update_last_seen()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.profiles
  SET last_seen_at = now()
  WHERE id = auth.uid();
END;
$$;

-- Enable realtime for profiles
ALTER PUBLICATION supabase_realtime ADD TABLE public.profiles;