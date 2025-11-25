-- Enable pg_cron extension for scheduled jobs
CREATE EXTENSION IF NOT EXISTS pg_cron;

-- Enable pg_net extension for HTTP requests
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Create cron job to monitor positions every minute
SELECT cron.schedule(
  'position-monitor-job',
  '* * * * *', -- Every minute
  $$
  SELECT
    net.http_post(
      url:='https://aoyqeieqqmpuhfvfzbrb.supabase.co/functions/v1/position-monitor',
      headers:='{"Content-Type": "application/json", "Authorization": "Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImFveXFlaWVxcW1wdWhmdmZ6YnJiIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjQwNzkwNDUsImV4cCI6MjA3OTY1NTA0NX0.0eGQE7GZi0zOGirP9FU9oKob9R7fghyXE3cZFCu4i3E"}'::jsonb,
      body:=concat('{"time": "', now(), '"}')::jsonb
    ) as request_id;
  $$
);