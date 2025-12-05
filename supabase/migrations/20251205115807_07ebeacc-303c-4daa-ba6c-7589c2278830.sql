-- Add time-based filtering columns to user_settings
ALTER TABLE public.user_settings
ADD COLUMN IF NOT EXISTS time_filtering_enabled boolean DEFAULT false,
ADD COLUMN IF NOT EXISTS user_timezone text DEFAULT 'Europe/Amsterdam',
ADD COLUMN IF NOT EXISTS active_time_ranges jsonb DEFAULT '[{"start": "00:00", "end": "23:59"}]'::jsonb;