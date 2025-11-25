-- Add atr_tp2_multiplier and atr_tp3_multiplier columns to settings table
ALTER TABLE public.settings 
ADD COLUMN atr_tp2_multiplier numeric DEFAULT NULL,
ADD COLUMN atr_tp3_multiplier numeric DEFAULT NULL;