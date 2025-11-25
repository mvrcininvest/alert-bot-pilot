-- Add RLS policies for settings table
-- Settings table appears to be a global configuration table with no user_id

-- Allow all operations on settings table (no authentication required)
CREATE POLICY "Allow all operations on settings" 
ON public.settings 
FOR ALL 
USING (true) 
WITH CHECK (true);