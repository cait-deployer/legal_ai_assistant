-- ═══════════════════════════════════════════════════════════════════════════
-- Patch: add auth_provider + limit_reset_at, drop last_request_month
-- Run in Supabase SQL Editor (safe to re-run)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add new columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS auth_provider  TEXT        NOT NULL DEFAULT 'email',
  ADD COLUMN IF NOT EXISTS limit_reset_at TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days';

-- 2. Backfill auth_provider from auth.users
UPDATE public.profiles p
SET auth_provider = COALESCE(
  (SELECT u.raw_app_meta_data ->> 'provider' FROM auth.users u WHERE u.id = p.id),
  'email'
);

-- 3. Drop old last_request_month (no longer needed — replaced by limit_reset_at)
ALTER TABLE public.profiles
  DROP COLUMN IF EXISTS last_request_month;

-- 4. Update fn_handle_new_user to set auth_provider and limit_reset_at
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (
    id, email, full_name, avatar_url, email_confirmed,
    auth_provider, limit_reset_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'avatar_url',
    (NEW.email_confirmed_at IS NOT NULL),
    COALESCE(NEW.raw_app_meta_data ->> 'provider', 'email'),
    NOW() + INTERVAL '30 days'
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;
