-- ═══════════════════════════════════════════════════════════════════════════
-- Патч для існуючої БД: додає нові поля profiles
-- Виконати якщо profiles вже існує (без DROP TABLE)
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. marketing_consent — GDPR-compliant opt-in, за замовчуванням TRUE
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS marketing_consent BOOLEAN NOT NULL DEFAULT TRUE;

-- 2. trial_used — захист від повторного тріалу через мультиакаунти
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS trial_used BOOLEAN NOT NULL DEFAULT FALSE;

-- 3. last_active_at — дата останньої взаємодії з AI (для виявлення відтоку)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS last_active_at TIMESTAMPTZ DEFAULT NOW();

-- 4. avg_session_duration — rolling average тривалості сесії в секундах
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS avg_session_duration INTEGER NOT NULL DEFAULT 0;

-- 5. session_count — лічильник сесій для rolling average
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS session_count INTEGER NOT NULL DEFAULT 0;

-- 6. Індекси
CREATE INDEX IF NOT EXISTS idx_profiles_last_active ON public.profiles(last_active_at)
  WHERE last_active_at IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_trial_used ON public.profiles(trial_used)
  WHERE trial_used = TRUE;

-- 7. Заповнити last_active_at для існуючих юзерів з updated_at
UPDATE public.profiles
  SET last_active_at = updated_at
  WHERE last_active_at IS NULL;
