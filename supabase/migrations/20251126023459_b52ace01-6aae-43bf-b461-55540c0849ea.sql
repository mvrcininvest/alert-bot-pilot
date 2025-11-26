-- Add user_id to alerts table to track which user the alert belongs to
ALTER TABLE public.alerts ADD COLUMN user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index for faster queries
CREATE INDEX idx_alerts_user_id ON public.alerts(user_id);

-- Add user_id to positions table if not exists (for future tracking)
ALTER TABLE public.positions ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE;

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_positions_user_id ON public.positions(user_id);

-- Update RLS policies for alerts to be user-specific
DROP POLICY IF EXISTS "Allow all operations on alerts" ON public.alerts;

CREATE POLICY "Users can view their own alerts"
ON public.alerts FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own alerts"
ON public.alerts FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can do all operations on alerts"
ON public.alerts FOR ALL
USING (true)
WITH CHECK (true);

-- Update RLS policies for positions to be user-specific
DROP POLICY IF EXISTS "Allow all operations on positions" ON public.positions;

CREATE POLICY "Users can view their own positions"
ON public.positions FOR SELECT
USING (auth.uid() = user_id);

CREATE POLICY "Users can insert their own positions"
ON public.positions FOR INSERT
WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Service role can do all operations on positions"
ON public.positions FOR ALL
USING (true)
WITH CHECK (true);