-- Create logs table for bot operations
CREATE TABLE IF NOT EXISTS public.bot_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT now(),
  level TEXT NOT NULL CHECK (level IN ('info', 'warn', 'error')),
  function_name TEXT NOT NULL,
  message TEXT NOT NULL,
  metadata JSONB,
  alert_id UUID REFERENCES public.alerts(id) ON DELETE SET NULL,
  position_id UUID REFERENCES public.positions(id) ON DELETE SET NULL
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_bot_logs_created_at ON public.bot_logs(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_bot_logs_level ON public.bot_logs(level);
CREATE INDEX IF NOT EXISTS idx_bot_logs_function_name ON public.bot_logs(function_name);

-- Enable RLS
ALTER TABLE public.bot_logs ENABLE ROW LEVEL SECURITY;

-- Allow reading logs (no auth required for now)
CREATE POLICY "Allow read access to bot_logs"
ON public.bot_logs
FOR SELECT
USING (true);