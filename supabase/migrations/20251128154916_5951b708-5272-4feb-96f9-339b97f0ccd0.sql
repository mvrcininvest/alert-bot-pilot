-- 1. Fix settings table - only admin can access
DROP POLICY IF EXISTS "Allow all operations on settings" ON public.settings;

CREATE POLICY "Admins can view settings" ON public.settings
FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can update settings" ON public.settings
FOR UPDATE USING (has_role(auth.uid(), 'admin'::app_role));

-- 2. Fix bot_logs - only admin can view, service can insert
DROP POLICY IF EXISTS "Allow all operations on bot_logs" ON public.bot_logs;

CREATE POLICY "Admins can view bot_logs" ON public.bot_logs
FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service can insert bot_logs" ON public.bot_logs
FOR INSERT WITH CHECK (true);

-- 3. Fix monitoring_logs - only admin can view
DROP POLICY IF EXISTS "Allow all operations on monitoring_logs" ON public.monitoring_logs;

CREATE POLICY "Admins can view monitoring_logs" ON public.monitoring_logs
FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Service can insert monitoring_logs" ON public.monitoring_logs
FOR INSERT WITH CHECK (true);

-- 4. Fix banned_symbols - only admin
DROP POLICY IF EXISTS "Allow all operations on banned_symbols" ON public.banned_symbols;

CREATE POLICY "Admins can manage banned_symbols" ON public.banned_symbols
FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- 5. Fix monitor_locks - only admin
DROP POLICY IF EXISTS "Allow all operations on monitor_locks" ON public.monitor_locks;

CREATE POLICY "Admins can manage monitor_locks" ON public.monitor_locks
FOR ALL USING (has_role(auth.uid(), 'admin'::app_role));

-- 6. Fix performance_metrics - only admin
DROP POLICY IF EXISTS "Allow all for authenticated users" ON public.performance_metrics;

CREATE POLICY "Admins can view performance_metrics" ON public.performance_metrics
FOR SELECT USING (has_role(auth.uid(), 'admin'::app_role));

-- 7. Remove admin viewing all alerts - admins should only see their own
DROP POLICY IF EXISTS "Admins can view all alerts" ON public.alerts;

-- 8. Add INSERT policy for user_settings so users can create their settings
CREATE POLICY "Users can insert their own settings" ON public.user_settings
FOR INSERT WITH CHECK (auth.uid() = user_id);