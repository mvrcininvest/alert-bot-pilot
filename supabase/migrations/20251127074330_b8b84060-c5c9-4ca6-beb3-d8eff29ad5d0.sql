-- Close orphaned positions (positions without user_id)
UPDATE positions
SET 
  status = 'closed',
  close_reason = 'orphaned_legacy',
  closed_at = now(),
  realized_pnl = 0,
  updated_at = now()
WHERE user_id IS NULL 
  AND status = 'open';