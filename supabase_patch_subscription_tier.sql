-- ═══════════════════════════════════════════════════════════════════════════
-- Lawyer AI — Fix subscription_tier to match subscription_plans.id values
-- Run AFTER supabase_migration.sql and supabase_plans_migration.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- Step 1: Convert the column from ENUM to TEXT
--   (Postgres requires casting through ::text first)
ALTER TABLE public.profiles
  ALTER COLUMN subscription_tier TYPE TEXT USING subscription_tier::text;

-- Step 2: Drop the old enum type (no longer needed)
DROP TYPE IF EXISTS public.subscription_plan CASCADE;

-- Step 3: Migrate old enum values → new plan IDs
--   'basic' → 'standard'  (monthly paid tier)
--   'ultra' → 'pro'       (highest tier)
--   'free' and 'pro' are unchanged
UPDATE public.profiles SET subscription_tier = 'standard' WHERE subscription_tier = 'basic';
UPDATE public.profiles SET subscription_tier = 'pro'      WHERE subscription_tier = 'ultra';

-- Step 4: Add a CHECK constraint to enforce only valid plan IDs
ALTER TABLE public.profiles
  DROP CONSTRAINT IF EXISTS profiles_subscription_tier_check;

ALTER TABLE public.profiles
  ADD CONSTRAINT profiles_subscription_tier_check
  CHECK (subscription_tier IN ('free', 'daily', 'standard', 'pro'));

-- Step 5: Set default to 'free'
ALTER TABLE public.profiles
  ALTER COLUMN subscription_tier SET DEFAULT 'free';

-- Verify
SELECT subscription_tier, count(*) FROM public.profiles GROUP BY 1 ORDER BY 1;
