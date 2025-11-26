-- Create banned_symbols table
CREATE TABLE public.banned_symbols (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  symbol TEXT NOT NULL UNIQUE,
  banned_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  reason TEXT NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
);

-- Enable RLS
ALTER TABLE public.banned_symbols ENABLE ROW LEVEL SECURITY;

-- Create policy for banned_symbols
CREATE POLICY "Allow all operations on banned_symbols" 
ON public.banned_symbols 
FOR ALL 
USING (true) 
WITH CHECK (true);