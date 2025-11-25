-- Enable RLS and add policies for remaining tables
-- This is a single-user trading bot system, so all tables are globally accessible

-- Alerts table
ALTER TABLE public.alerts ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on alerts" 
ON public.alerts 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Bot logs table
ALTER TABLE public.bot_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on bot_logs" 
ON public.bot_logs 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Monitoring logs table
ALTER TABLE public.monitoring_logs ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on monitoring_logs" 
ON public.monitoring_logs 
FOR ALL 
USING (true) 
WITH CHECK (true);

-- Positions table
ALTER TABLE public.positions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Allow all operations on positions" 
ON public.positions 
FOR ALL 
USING (true) 
WITH CHECK (true);