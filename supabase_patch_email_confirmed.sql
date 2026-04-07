-- ═══════════════════════════════════════════════════════════════════════════
-- Patch: add email_confirmed to profiles + confirmation triggers
-- Run this in Supabase SQL Editor (safe to re-run)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Add column (idempotent)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS email_confirmed BOOLEAN NOT NULL DEFAULT FALSE;

-- 2. Backfill existing rows from auth.users
UPDATE public.profiles p
SET email_confirmed = (u.email_confirmed_at IS NOT NULL)
FROM auth.users u
WHERE p.id = u.id;

-- 3. Update fn_handle_new_user to set email_confirmed at registration
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name, avatar_url, email_confirmed)
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'avatar_url',
    (NEW.email_confirmed_at IS NOT NULL)
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

-- 4. New trigger: set email_confirmed=true when user clicks the link
CREATE OR REPLACE FUNCTION public.fn_handle_email_confirmed()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.email_confirmed_at IS NOT NULL AND OLD.email_confirmed_at IS NULL THEN
    UPDATE public.profiles
    SET email_confirmed = TRUE
    WHERE id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_email_confirmed ON auth.users;
CREATE TRIGGER trg_on_email_confirmed
  AFTER UPDATE ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_email_confirmed();
