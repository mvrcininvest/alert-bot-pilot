import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

type LogLevel = 'info' | 'warn' | 'error';

interface LogOptions {
  functionName: string;
  message: string;
  level?: LogLevel;
  metadata?: Record<string, any>;
  alertId?: string;
  positionId?: string;
}

export async function log(options: LogOptions) {
  const {
    functionName,
    message,
    level = 'info',
    metadata,
    alertId,
    positionId
  } = options;

  // Console log for immediate visibility
  const timestamp = new Date().toISOString();
  console.log(`[${level.toUpperCase()}] [${functionName}] ${timestamp}: ${message}`, metadata || '');

  // Database log for persistence - ASYNC (fire and forget)
  // Don't await - let it run in background to avoid blocking the main flow
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
  );

  // Fire and forget - no await
  supabase.from('bot_logs').insert({
    level,
    function_name: functionName,
    message,
    metadata: metadata || null,
    alert_id: alertId || null,
    position_id: positionId || null
  }).then(
    () => {}, // Success - no action needed
    (error: unknown) => { // Error handler with proper typing
      // Don't throw - logging failure shouldn't break the main flow
      console.error('Failed to write log to database:', error);
    }
  );
}
