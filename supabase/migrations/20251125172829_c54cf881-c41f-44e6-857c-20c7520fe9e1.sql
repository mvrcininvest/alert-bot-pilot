-- Update allowed_tiers and excluded_tiers to use correct tier values from the indicator
-- The indicator uses: Platinum, Premium, Standard, Quick, Emergency

-- Update default values for allowed_tiers and excluded_tiers
ALTER TABLE settings 
  ALTER COLUMN allowed_tiers SET DEFAULT ARRAY['Platinum', 'Premium', 'Standard', 'Quick']::text[];

ALTER TABLE settings 
  ALTER COLUMN excluded_tiers SET DEFAULT ARRAY[]::text[];

-- Update existing rows to use correct tiers
UPDATE settings
SET 
  allowed_tiers = ARRAY['Platinum', 'Premium', 'Standard', 'Quick']::text[],
  excluded_tiers = ARRAY[]::text[]
WHERE id IS NOT NULL;