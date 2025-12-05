-- Add drawdown_reset_at column for manual drawdown reset
ALTER TABLE public.user_settings 
ADD COLUMN drawdown_reset_at timestamp with time zone DEFAULT NULL;