-- Create ban_history table to track all bans/unbans
CREATE TABLE public.ban_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  action text NOT NULL CHECK (action IN ('banned', 'unbanned')),
  reason text,
  performed_by uuid NOT NULL,
  performed_at timestamp with time zone NOT NULL DEFAULT now(),
  created_at timestamp with time zone NOT NULL DEFAULT now()
);

-- Add index for faster queries
CREATE INDEX idx_ban_history_user_id ON public.ban_history(user_id);
CREATE INDEX idx_ban_history_performed_at ON public.ban_history(performed_at DESC);

-- Enable RLS
ALTER TABLE public.ban_history ENABLE ROW LEVEL SECURITY;

-- Policy: Admins can view all ban history
CREATE POLICY "Admins can view all ban history"
ON public.ban_history
FOR SELECT
TO authenticated
USING (has_role(auth.uid(), 'admin'));

-- Policy: Admins can insert ban history
CREATE POLICY "Admins can insert ban history"
ON public.ban_history
FOR INSERT
TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'));

-- Create function to log ban/unban actions
CREATE OR REPLACE FUNCTION public.log_ban_action()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- If is_banned changed
  IF (TG_OP = 'UPDATE' AND OLD.is_banned IS DISTINCT FROM NEW.is_banned) THEN
    INSERT INTO public.ban_history (user_id, action, reason, performed_by)
    VALUES (
      NEW.id,
      CASE WHEN NEW.is_banned THEN 'banned' ELSE 'unbanned' END,
      NEW.ban_reason,
      COALESCE(NEW.banned_by, auth.uid())
    );
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger to automatically log ban/unban actions
CREATE TRIGGER log_ban_action_trigger
AFTER UPDATE ON public.profiles
FOR EACH ROW
EXECUTE FUNCTION public.log_ban_action();