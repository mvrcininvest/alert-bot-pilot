-- Add simple_tp2_percent and simple_tp3_percent columns to settings table
ALTER TABLE public.settings 
ADD COLUMN simple_tp2_percent numeric DEFAULT NULL,
ADD COLUMN simple_tp3_percent numeric DEFAULT NULL;