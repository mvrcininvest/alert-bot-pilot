-- Add missing indicator_version_filter column to settings table
ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS indicator_version_filter text[] DEFAULT NULL;

COMMENT ON COLUMN public.settings.indicator_version_filter IS 'Array of accepted indicator versions (e.g., ["9.1", "9.3"]). NULL means all versions accepted.';