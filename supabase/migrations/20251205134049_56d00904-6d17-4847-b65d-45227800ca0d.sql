-- Add minimum signal strength filtering columns to settings table (admin only)
ALTER TABLE public.settings
ADD COLUMN IF NOT EXISTS min_signal_strength_enabled BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS min_signal_strength_threshold NUMERIC DEFAULT 0.50;