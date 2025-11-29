-- Add fee_aware_breakeven column to settings table
ALTER TABLE public.settings 
ADD COLUMN fee_aware_breakeven BOOLEAN DEFAULT true;

-- Add fee_aware_breakeven column to user_settings table
ALTER TABLE public.user_settings 
ADD COLUMN fee_aware_breakeven BOOLEAN DEFAULT true;

-- Add comment explaining the setting
COMMENT ON COLUMN public.settings.fee_aware_breakeven IS 'When enabled, break-even SL accounts for 0.12% round-trip fees to ensure true break-even';
COMMENT ON COLUMN public.user_settings.fee_aware_breakeven IS 'When enabled, break-even SL accounts for 0.12% round-trip fees to ensure true break-even';