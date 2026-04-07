-- ═══════════════════════════════════════════════════════════════════════════
-- Lawyer AI — Subscription Plans system
-- Run in Supabase SQL Editor AFTER supabase_migration.sql
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Feature definitions dictionary (key → editable label/description) ──
CREATE TABLE IF NOT EXISTS public.feature_definitions (
  key         TEXT PRIMARY KEY,
  label       TEXT NOT NULL,
  description TEXT,
  category    TEXT NOT NULL DEFAULT 'access', -- 'sources' | 'response' | 'access'
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ── 2. Subscription plans ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.subscription_plans (
  id              TEXT PRIMARY KEY,  -- 'free' | 'daily' | 'standard' | 'pro'
  name            TEXT NOT NULL,
  price_uah       INTEGER NOT NULL DEFAULT 0,
  billing_period  TEXT NOT NULL DEFAULT 'forever',  -- 'forever'|'day'|'month'
  request_limit   INTEGER,          -- NULL = unlimited
  badge_text      TEXT,             -- "Найпопулярніший" | "Для юристів" | NULL
  badge_color     TEXT DEFAULT 'gold', -- 'gold' | 'emerald'
  main_benefit    TEXT,             -- text after →
  button_text     TEXT NOT NULL DEFAULT 'Обрати',
  note_text       TEXT,             -- "Без кредитної картки"
  extra_text      TEXT,             -- long marketing text (Pro plan)
  is_active       BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order      INTEGER NOT NULL DEFAULT 0
);

-- ── 3. Feature flags per plan ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plan_features (
  plan_id     TEXT NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  feature_key TEXT NOT NULL REFERENCES public.feature_definitions(key) ON DELETE CASCADE,
  enabled     BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (plan_id, feature_key)
);

-- ── 4. Marketing bullet points per plan ───────────────────────────────────
CREATE TABLE IF NOT EXISTS public.plan_benefits (
  id          SERIAL PRIMARY KEY,
  plan_id     TEXT NOT NULL REFERENCES public.subscription_plans(id) ON DELETE CASCADE,
  category    TEXT NOT NULL DEFAULT 'response', -- 'requests'|'sources'|'response'
  text        TEXT NOT NULL,
  sort_order  INTEGER NOT NULL DEFAULT 0
);

-- ── Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_plan_features_plan  ON public.plan_features(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_benefits_plan  ON public.plan_benefits(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_benefits_order ON public.plan_benefits(plan_id, sort_order);

-- ══════════════════════════════════════════════════════════════════════════
-- SEED: Feature definitions
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO public.feature_definitions (key, label, description, category, sort_order) VALUES
  -- Sources
  ('source_rada',        'zakon.rada.gov.ua',         'Офіційна база законодавства України (Верховна Рада)',          'sources', 10),
  ('source_legalaid',    'legalaid.gov.ua',            'Шаблони та інструкції для громадян (Правова допомога)',        'sources', 20),
  ('source_ccu',         'ccu.gov.ua',                 'Рішення Конституційного суду України',                        'sources', 30),
  ('source_supreme',     'supreme.court.gov.ua',       'Правові позиції Верховного суду України',                     'sources', 40),
  -- Response quality
  ('response_detailed',  'Розгорнута відповідь',       'Повна відповідь з аналізом, а не короткий summary',           'response', 50),
  ('response_steps',     'Конкретні кроки',            'Покрокові дії що робити далі',                                'response', 60),
  ('response_scenarios', 'Альтернативні сценарії',     'Аналіз різних варіантів розвитку ситуації',                   'response', 70),
  ('response_vs_position','Позиція Верховного суду',   'Посилання на конкретні правові позиції ВС',                   'response', 80),
  -- Access
  ('history_saved',      'Збереження історії',         'Вся історія запитів зберігається і доступна',                 'access',   90),
  ('priority_processing','Пріоритетна обробка',        'Запити обробляються в першу чергу',                           'access',  100),
  ('document_analysis',  'Аналіз документів',          'Аналіз договорів, позовів, рішень суду до 50 сторінок',       'access',  110)
ON CONFLICT (key) DO UPDATE
  SET label = EXCLUDED.label, description = EXCLUDED.description,
      category = EXCLUDED.category, sort_order = EXCLUDED.sort_order;

-- ══════════════════════════════════════════════════════════════════════════
-- SEED: Plans
-- ══════════════════════════════════════════════════════════════════════════
INSERT INTO public.subscription_plans
  (id, name, price_uah, billing_period, request_limit, badge_text, badge_color, main_benefit, button_text, note_text, extra_text, is_active, sort_order)
VALUES
  (
    'free', 'Безкоштовно', 0, 'forever', 10,
    NULL, 'gold',
    'Спробуй без ризику — 10 запитів щоб переконатись',
    'Почати безкоштовно', 'Без кредитної картки',
    NULL, TRUE, 0
  ),
  (
    'daily', 'Одноденний', 49, 'day', 30,
    NULL, 'gold',
    'Термінова ситуація сьогодні — 30 запитів за 49 грн',
    'Спробувати за 49 грн', NULL,
    NULL, TRUE, 1
  ),
  (
    'standard', 'Стандарт', 199, 'month', 200,
    'Найпопулярніший', 'gold',
    'Регулярні питання — 200 запитів і вся історія під рукою',
    'Обрати Стандарт', NULL,
    NULL, TRUE, 2
  ),
  (
    'pro', 'Про', 499, 'month', NULL,
    'Для юристів та компаній', 'emerald',
    'Повний арсенал юриста — судова практика, позиції ВС і аналіз твоїх документів',
    'Обрати Про', NULL,
    E'Спеціалізуєшся в корпоративному праві — але клієнт питає про трудові спори?\nURAI дає швидке занурення в суміжну галузь: норми, судова практика, позиції ВС — щоб ти зорієнтувався раніше ніж клієнт засумнівався.',
    TRUE, 3
  )
ON CONFLICT (id) DO UPDATE
  SET name = EXCLUDED.name, price_uah = EXCLUDED.price_uah,
      billing_period = EXCLUDED.billing_period, request_limit = EXCLUDED.request_limit,
      badge_text = EXCLUDED.badge_text, badge_color = EXCLUDED.badge_color,
      main_benefit = EXCLUDED.main_benefit, button_text = EXCLUDED.button_text,
      note_text = EXCLUDED.note_text, extra_text = EXCLUDED.extra_text,
      sort_order = EXCLUDED.sort_order;

-- ══════════════════════════════════════════════════════════════════════════
-- SEED: Feature flags per plan
-- ══════════════════════════════════════════════════════════════════════════
-- free
INSERT INTO public.plan_features (plan_id, feature_key, enabled) VALUES
  ('free', 'source_rada',         TRUE),
  ('free', 'source_legalaid',     TRUE),
  ('free', 'source_ccu',          FALSE),
  ('free', 'source_supreme',      FALSE),
  ('free', 'response_detailed',   FALSE),
  ('free', 'response_steps',      FALSE),
  ('free', 'response_scenarios',  FALSE),
  ('free', 'response_vs_position',FALSE),
  ('free', 'history_saved',       FALSE),
  ('free', 'priority_processing', FALSE),
  ('free', 'document_analysis',   FALSE)
ON CONFLICT (plan_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled;

-- daily
INSERT INTO public.plan_features (plan_id, feature_key, enabled) VALUES
  ('daily', 'source_rada',         TRUE),
  ('daily', 'source_legalaid',     TRUE),
  ('daily', 'source_ccu',          FALSE),
  ('daily', 'source_supreme',      FALSE),
  ('daily', 'response_detailed',   TRUE),
  ('daily', 'response_steps',      TRUE),
  ('daily', 'response_scenarios',  FALSE),
  ('daily', 'response_vs_position',FALSE),
  ('daily', 'history_saved',       FALSE),
  ('daily', 'priority_processing', FALSE),
  ('daily', 'document_analysis',   FALSE)
ON CONFLICT (plan_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled;

-- standard
INSERT INTO public.plan_features (plan_id, feature_key, enabled) VALUES
  ('standard', 'source_rada',         TRUE),
  ('standard', 'source_legalaid',     TRUE),
  ('standard', 'source_ccu',          TRUE),
  ('standard', 'source_supreme',      FALSE),
  ('standard', 'response_detailed',   TRUE),
  ('standard', 'response_steps',      TRUE),
  ('standard', 'response_scenarios',  FALSE),
  ('standard', 'response_vs_position',FALSE),
  ('standard', 'history_saved',       TRUE),
  ('standard', 'priority_processing', FALSE),
  ('standard', 'document_analysis',   FALSE)
ON CONFLICT (plan_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled;

-- pro
INSERT INTO public.plan_features (plan_id, feature_key, enabled) VALUES
  ('pro', 'source_rada',         TRUE),
  ('pro', 'source_legalaid',     TRUE),
  ('pro', 'source_ccu',          TRUE),
  ('pro', 'source_supreme',      TRUE),
  ('pro', 'response_detailed',   TRUE),
  ('pro', 'response_steps',      TRUE),
  ('pro', 'response_scenarios',  TRUE),
  ('pro', 'response_vs_position',TRUE),
  ('pro', 'history_saved',       TRUE),
  ('pro', 'priority_processing', TRUE),
  ('pro', 'document_analysis',   TRUE)
ON CONFLICT (plan_id, feature_key) DO UPDATE SET enabled = EXCLUDED.enabled;

-- ══════════════════════════════════════════════════════════════════════════
-- SEED: Benefits (marketing bullets)
-- ══════════════════════════════════════════════════════════════════════════
-- Clear existing seed data and re-insert
DELETE FROM public.plan_benefits;

INSERT INTO public.plan_benefits (plan_id, category, text, sort_order) VALUES
  -- free
  ('free', 'requests', '10 запитів після реєстрації',                              0),
  ('free', 'sources',  'zakon.rada.gov.ua',                                        0),
  ('free', 'sources',  'legalaid.gov.ua — шаблони для громадян',                   1),
  ('free', 'response', 'Короткий аналіз ситуації',                                 0),
  ('free', 'response', 'Пряме посилання на статтю закону',                         1),

  -- daily
  ('daily', 'requests', '30 запитів протягом 24 годин',                             0),
  ('daily', 'sources',  'zakon.rada.gov.ua',                                        0),
  ('daily', 'sources',  'legalaid.gov.ua — шаблони та інструкції',                  1),
  ('daily', 'response', 'Розгорнута відповідь',                                     0),
  ('daily', 'response', 'Пряме посилання на статтю закону',                         1),
  ('daily', 'response', 'Практичне пояснення простою мовою',                        2),
  ('daily', 'response', 'Конкретні кроки що робити далі',                           3),

  -- standard
  ('standard', 'requests', '200 запитів на місяць (~6–7 на день)',                  0),
  ('standard', 'sources',  'zakon.rada.gov.ua',                                     0),
  ('standard', 'sources',  'legalaid.gov.ua — шаблони та інструкції',               1),
  ('standard', 'sources',  'ccu.gov.ua — рішення Конституційного суду',             2),
  ('standard', 'response', 'Розгорнута відповідь',                                  0),
  ('standard', 'response', 'Пряме посилання на статтю закону',                      1),
  ('standard', 'response', 'Практичне пояснення простою мовою',                     2),
  ('standard', 'response', 'Конкретні кроки що робити далі',                        3),
  ('standard', 'response', 'Збереження всієї історії запитів',                      4),

  -- pro
  ('pro', 'requests', 'Безліміт запитів',                                           0),
  ('pro', 'requests', 'Пріоритетна обробка',                                        1),
  ('pro', 'sources',  'zakon.rada.gov.ua',                                          0),
  ('pro', 'sources',  'legalaid.gov.ua — шаблони та інструкції',                    1),
  ('pro', 'sources',  'ccu.gov.ua — рішення Конституційного суду',                  2),
  ('pro', 'sources',  'supreme.court.gov.ua — правові позиції ВС',                  3),
  ('pro', 'response', 'Глибокий аналіз без обмежень',                               0),
  ('pro', 'response', 'Пряме посилання на статтю закону',                           1),
  ('pro', 'response', 'Посилання на конкретні судові рішення',                      2),
  ('pro', 'response', 'Правова позиція Верховного суду',                             3),
  ('pro', 'response', 'Альтернативні сценарії розвитку ситуації',                   4),
  ('pro', 'response', 'Покроковий план дій',                                        5),
  ('pro', 'response', 'Аналіз завантаженого документу (до 50 стор.)',               6);

-- ══════════════════════════════════════════════════════════════════════════
-- RPC: match_documents with optional source filter
-- Call: SELECT * FROM match_documents(embedding, 0.4, 10, ARRAY['zakon.rada.gov.ua'])
-- ══════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.match_documents(
  query_embedding vector,
  match_threshold float DEFAULT 0.4,
  match_count     int   DEFAULT 10,
  filter_domains  text[] DEFAULT NULL  -- NULL = no filter (all sources)
)
RETURNS TABLE (
  out_id       bigint,
  out_content  text,
  out_metadata jsonb,
  similarity   float
)
LANGUAGE plpgsql
AS $$
BEGIN
  RETURN QUERY
  SELECT
    d.id::bigint,
    d.content,
    d.metadata,
    1 - (d.embedding <=> query_embedding) AS similarity
  FROM documents d
  WHERE
    1 - (d.embedding <=> query_embedding) > match_threshold
    AND (
      filter_domains IS NULL
      OR EXISTS (
        SELECT 1 FROM unnest(filter_domains) AS fd
        WHERE d.metadata->>'law_url' ILIKE '%' || fd || '%'
      )
    )
  ORDER BY d.embedding <=> query_embedding
  LIMIT match_count;
END;
$$;
