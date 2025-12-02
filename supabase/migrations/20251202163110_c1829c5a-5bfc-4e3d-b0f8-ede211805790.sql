-- Add session filtering columns to settings (admin)
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS session_filtering_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS allowed_sessions TEXT[] DEFAULT ARRAY['Asia', 'London', 'NY', 'Sydney'];
ALTER TABLE public.settings ADD COLUMN IF NOT EXISTS excluded_sessions TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Add session filtering columns to user_settings
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS session_filtering_enabled BOOLEAN DEFAULT false;
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS allowed_sessions TEXT[] DEFAULT ARRAY['Asia', 'London', 'NY', 'Sydney'];
ALTER TABLE public.user_settings ADD COLUMN IF NOT EXISTS excluded_sessions TEXT[] DEFAULT ARRAY[]::TEXT[];