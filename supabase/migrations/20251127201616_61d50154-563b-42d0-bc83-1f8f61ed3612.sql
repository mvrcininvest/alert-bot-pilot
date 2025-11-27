-- Create function to atomically check and reserve position slot
-- This prevents race conditions when multiple alerts arrive simultaneously
CREATE OR REPLACE FUNCTION public.check_and_reserve_position(
  p_user_id UUID,
  p_max_positions INTEGER
) RETURNS BOOLEAN AS $$
DECLARE
  current_count INTEGER;
BEGIN
  -- Lock the user_settings row to prevent concurrent checks
  PERFORM 1 FROM public.user_settings 
  WHERE user_id = p_user_id 
  FOR UPDATE;
  
  -- Count current open positions for this user
  SELECT COUNT(*) INTO current_count 
  FROM public.positions 
  WHERE user_id = p_user_id AND status = 'open';
  
  -- Return whether we can open a new position
  RETURN current_count < p_max_positions;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public;