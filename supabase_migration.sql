-- ═══════════════════════════════════════════════════════════════════════════
-- Lawyer AI — повна міграція таблиці profiles (drop & recreate)
-- Виконати в Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Прибираємо старе
-- ────────────────────────────────────────────────────────────────────────────
DROP TABLE  IF EXISTS public.profiles        CASCADE;
DROP TYPE   IF EXISTS public.user_segment    CASCADE;

-- 2. Енам-типи
-- ────────────────────────────────────────────────────────────────────────────
-- Note: subscription_plan enum removed — subscription_tier is now TEXT
-- referencing subscription_plans.id ('free'|'daily'|'standard'|'pro')
DROP TYPE IF EXISTS public.subscription_plan CASCADE;

DROP TYPE IF EXISTS public.user_segment CASCADE;
CREATE TYPE public.user_segment AS ENUM (
  'legal_pro', 'business_finance', 'gov_sector', 'military_theme', 'social_vulnerable', 'daily_life', 'specialized_niche'
);

-- 3. Таблиця Profiles
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE public.profiles (
  id          UUID        PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email       TEXT        NOT NULL UNIQUE,
  full_name   TEXT,
  avatar_url  TEXT,

  -- Підписка (matches subscription_plans.id: 'free'|'daily'|'standard'|'pro')
  subscription_tier TEXT NOT NULL DEFAULT 'free'
    CHECK (subscription_tier IN ('free', 'daily', 'standard', 'pro')),

  -- Онбординг
  segment       public.user_segment[]  NOT NULL DEFAULT '{}',
  role          TEXT,
  sub_role      TEXT[]                 NOT NULL DEFAULT '{}',
  is_onboarded  BOOLEAN                NOT NULL DEFAULT FALSE,

  -- Верифікація email
  email_confirmed       BOOLEAN NOT NULL DEFAULT FALSE,

  -- Гео / пристрій / анти-абюз
  browser_fingerprint   TEXT,
  last_ip               TEXT,
  last_city             TEXT,
  last_country          TEXT,
  last_country_code     TEXT,
  user_agent            TEXT,
  auth_provider         TEXT        NOT NULL DEFAULT 'email',

  -- Ліміти запитів (30-денне вікно)
  limit_reset_at        TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '30 days',
  requests_this_month   INTEGER     NOT NULL DEFAULT 0,
  monthly_limit         INTEGER              DEFAULT 10,   -- NULL = безліміт
  total_requests        INTEGER     NOT NULL DEFAULT 0,

  -- Маркетинг (GDPR-compliant opt-in, за замовчуванням увімкнено)
  marketing_consent     BOOLEAN     NOT NULL DEFAULT TRUE,

  -- Анти-мультиакаунт: чи вже використовував безкоштовний пробний період
  trial_used            BOOLEAN     NOT NULL DEFAULT FALSE,

  -- Аналітика активності
  last_active_at        TIMESTAMPTZ          DEFAULT NOW(),  -- остання взаємодія з AI
  avg_session_duration  INTEGER     NOT NULL DEFAULT 0,      -- секунди (rolling avg)
  session_count         INTEGER     NOT NULL DEFAULT 0,      -- кількість сесій для avg

  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 4. Індекси
-- ────────────────────────────────────────────────────────────────────────────
CREATE INDEX idx_profiles_segment      ON public.profiles USING GIN(segment);
CREATE INDEX idx_profiles_role         ON public.profiles(role);
CREATE INDEX idx_profiles_fingerprint  ON public.profiles(browser_fingerprint)
  WHERE browser_fingerprint IS NOT NULL;
CREATE INDEX idx_profiles_last_ip      ON public.profiles(last_ip)
  WHERE last_ip IS NOT NULL;
CREATE INDEX idx_profiles_city         ON public.profiles(last_city)
  WHERE last_city IS NOT NULL;
CREATE INDEX idx_profiles_last_active  ON public.profiles(last_active_at)
  WHERE last_active_at IS NOT NULL;
CREATE INDEX idx_profiles_trial_used   ON public.profiles(trial_used)
  WHERE trial_used = TRUE;

-- 5. RLS — Row Level Security
-- ────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "profiles: select own"
  ON public.profiles FOR SELECT
  USING (auth.uid() = id);

CREATE POLICY "profiles: insert own"
  ON public.profiles FOR INSERT
  WITH CHECK (auth.uid() = id);

CREATE POLICY "profiles: update own"
  ON public.profiles FOR UPDATE
  USING (auth.uid() = id);

-- 6. Тригер: auto-update updated_at
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_profiles_updated_at
  BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_updated_at();

-- 7. Тригер: auto-create profile при реєстрації
-- ────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fn_handle_new_user()
RETURNS TRIGGER LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.profiles (
    id, email, full_name, avatar_url, email_confirmed,
    auth_provider, limit_reset_at,
    marketing_consent, trial_used, last_active_at
  )
  VALUES (
    NEW.id,
    NEW.email,
    NEW.raw_user_meta_data ->> 'full_name',
    NEW.raw_user_meta_data ->> 'avatar_url',
    (NEW.email_confirmed_at IS NOT NULL),
    COALESCE(NEW.raw_app_meta_data ->> 'provider', 'email'),
    NOW() + INTERVAL '30 days',
    TRUE,   -- marketing_consent: opt-in за замовчуванням
    FALSE,  -- trial_used: ще не використовував
    NOW()   -- last_active_at: момент реєстрації
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_on_auth_user_created ON auth.users;
CREATE TRIGGER trg_on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.fn_handle_new_user();

-- 8. Тригер: mark email confirmed when user clicks the confirmation link
-- ────────────────────────────────────────────────────────────────────────────
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
