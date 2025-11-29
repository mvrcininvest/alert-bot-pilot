-- Add latency tracking columns to alerts table
ALTER TABLE alerts 
  ADD COLUMN IF NOT EXISTS tv_timestamp BIGINT,
  ADD COLUMN IF NOT EXISTS webhook_received_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS exchange_executed_at BIGINT,
  ADD COLUMN IF NOT EXISTS latency_webhook_ms INTEGER,
  ADD COLUMN IF NOT EXISTS latency_execution_ms INTEGER;

-- Add comments for clarity
COMMENT ON COLUMN alerts.tv_timestamp IS 'TradingView alert generation timestamp (milliseconds)';
COMMENT ON COLUMN alerts.webhook_received_at IS 'Webhook received timestamp';
COMMENT ON COLUMN alerts.exchange_executed_at IS 'Exchange order execution timestamp (milliseconds from Bitget API)';
COMMENT ON COLUMN alerts.latency_webhook_ms IS 'Latency from TradingView to webhook (ms)';
COMMENT ON COLUMN alerts.latency_execution_ms IS 'Processing time from webhook to exchange execution (ms)';
COMMENT ON COLUMN alerts.latency_ms IS 'Total end-to-end latency from TradingView to exchange (ms)';

-- Backfill tv_timestamp and latency_webhook_ms for existing alerts with tv_ts in raw_data
UPDATE alerts 
SET 
  tv_timestamp = (raw_data->>'tv_ts')::bigint,
  latency_webhook_ms = GREATEST(0, LEAST(60000, 
    EXTRACT(EPOCH FROM created_at)::bigint * 1000 - (raw_data->>'tv_ts')::bigint
  ))
WHERE raw_data->>'tv_ts' IS NOT NULL 
  AND tv_timestamp IS NULL
  AND (raw_data->>'tv_ts')::bigint > 0;