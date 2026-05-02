-- Beta tester permission flag
-- Run once in Supabase SQL editor.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS is_beta_tester BOOLEAN DEFAULT FALSE NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_is_beta_tester
  ON public.profiles (is_beta_tester);
