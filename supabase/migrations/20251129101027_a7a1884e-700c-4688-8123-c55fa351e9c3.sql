-- Drop the broken policy that allows all authenticated users to see all alerts
DROP POLICY IF EXISTS "Service role can do all operations on alerts" ON public.alerts;

-- Create policy for admins to view all alerts
CREATE POLICY "Admins can view all alerts"
ON public.alerts
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));

-- Create policy for admins to update all alerts
CREATE POLICY "Admins can update all alerts"
ON public.alerts
FOR UPDATE
TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role));