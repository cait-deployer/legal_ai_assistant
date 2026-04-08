-- ═══════════════════════════════════════════════════════════════════════════
-- Elite Analytics System — розширення query_analytics
-- Виконати в Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Додаємо розширені поля в аналітику
ALTER TABLE public.query_analytics
  ADD COLUMN IF NOT EXISTS processing_time_ms int4,
  ADD COLUMN IF NOT EXISTS sentiment           text,   -- neutral / urgent / frustrated
  ADD COLUMN IF NOT EXISTS complexity_score   int2,   -- 1-5
  ADD COLUMN IF NOT EXISTS user_intent        text,   -- консультація / скарга / пошук_шаблону
  ADD COLUMN IF NOT EXISTS is_resolved        bool DEFAULT true;

-- 2. Індекс для швидких звітів по сегментах
CREATE INDEX IF NOT EXISTS idx_analytics_segment   ON public.profiles USING gin(segment);
CREATE INDEX IF NOT EXISTS idx_analytics_user_id   ON public.query_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_created   ON public.query_analytics(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_category  ON public.query_analytics(category);
CREATE INDEX IF NOT EXISTS idx_analytics_sentiment ON public.query_analytics(sentiment);
