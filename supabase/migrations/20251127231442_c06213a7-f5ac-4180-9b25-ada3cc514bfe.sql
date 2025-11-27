-- Add RLS policy for admins to view all alerts
CREATE POLICY "Admins can view all alerts"
ON alerts FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));