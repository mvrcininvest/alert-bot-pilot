-- Add leverage source option to settings table
ALTER TABLE public.settings 
ADD COLUMN use_alert_leverage boolean DEFAULT true;