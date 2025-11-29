-- Create table for latency alerts
CREATE TABLE IF NOT EXISTS latency_alerts (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  alert_id UUID REFERENCES alerts(id),
  user_id UUID,
  latency_ms INTEGER NOT NULL,
  threshold_ms INTEGER NOT NULL DEFAULT 30000,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  acknowledged_at TIMESTAMPTZ,
  acknowledged_by UUID
);

-- Enable RLS
ALTER TABLE latency_alerts ENABLE ROW LEVEL SECURITY;

-- Admin can view all latency alerts
CREATE POLICY "Admins can view all latency alerts"
ON latency_alerts FOR SELECT
USING (has_role(auth.uid(), 'admin'::app_role));

-- Users can view their own latency alerts
CREATE POLICY "Users can view their own latency alerts"
ON latency_alerts FOR SELECT
USING (auth.uid() = user_id);

-- Service can insert latency alerts
CREATE POLICY "Service can insert latency alerts"
ON latency_alerts FOR INSERT
WITH CHECK (true);

-- Users can acknowledge their own alerts
CREATE POLICY "Users can update their own latency alerts"
ON latency_alerts FOR UPDATE
USING (auth.uid() = user_id OR auth.uid() = acknowledged_by);

-- Index for faster queries
CREATE INDEX idx_latency_alerts_user_id ON latency_alerts(user_id);
CREATE INDEX idx_latency_alerts_created_at ON latency_alerts(created_at DESC);
CREATE INDEX idx_latency_alerts_acknowledged ON latency_alerts(acknowledged_at) WHERE acknowledged_at IS NULL;

-- Function to automatically create latency alerts when alerts are executed with high latency
CREATE OR REPLACE FUNCTION check_latency_threshold()
RETURNS TRIGGER AS $$
BEGIN
  -- If latency exceeds 30 seconds (30000ms), create an alert
  IF NEW.latency_ms IS NOT NULL AND NEW.latency_ms > 30000 AND NEW.status = 'executed' THEN
    INSERT INTO latency_alerts (alert_id, user_id, latency_ms)
    VALUES (NEW.id, NEW.user_id, NEW.latency_ms);
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;

-- Trigger to check latency when alerts are updated
DROP TRIGGER IF EXISTS trigger_check_latency ON alerts;
CREATE TRIGGER trigger_check_latency
AFTER UPDATE ON alerts
FOR EACH ROW
WHEN (NEW.latency_ms IS NOT NULL AND NEW.status = 'executed')
EXECUTE FUNCTION check_latency_threshold();

COMMENT ON TABLE latency_alerts IS 'Alerts for high latency detections (>30s)';
COMMENT ON COLUMN latency_alerts.latency_ms IS 'Actual latency in milliseconds';
COMMENT ON COLUMN latency_alerts.threshold_ms IS 'Threshold that was exceeded (default 30000ms)';