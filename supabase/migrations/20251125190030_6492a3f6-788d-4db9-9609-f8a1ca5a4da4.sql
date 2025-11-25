-- Add is_test flag and latency tracking to alerts
ALTER TABLE public.alerts 
ADD COLUMN is_test boolean DEFAULT false,
ADD COLUMN latency_ms integer;

-- Add comment
COMMENT ON COLUMN public.alerts.is_test IS 'Flag to mark test alerts that should be excluded from statistics';
COMMENT ON COLUMN public.alerts.latency_ms IS 'Latency in milliseconds between alert received and execution completed';