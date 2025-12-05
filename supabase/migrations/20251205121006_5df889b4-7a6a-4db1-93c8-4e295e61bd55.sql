ALTER TABLE public.settings 
ADD COLUMN IF NOT EXISTS time_filtering_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS user_timezone TEXT DEFAULT 'Europe/Amsterdam',
ADD COLUMN IF NOT EXISTS active_time_ranges JSONB DEFAULT '[{"start": "00:00", "end": "23:59"}]'::jsonb;