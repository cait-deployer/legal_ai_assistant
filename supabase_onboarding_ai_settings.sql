-- ═══════════════════════════════════════════════════════════════════════════
-- Lawyer AI — AI Settings + Onboarding Migration
-- Виконати в Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- ── 1. Таблиця загальних налаштувань (app_settings) ──────────────────────────
CREATE TABLE IF NOT EXISTS public.app_settings (
    key         text PRIMARY KEY,
    value_text  text,
    value_int   integer,
    value_bool  boolean,
    description text,
    updated_at  timestamp with time zone DEFAULT timezone('utc', now())
);

-- Базові AI-налаштування
INSERT INTO public.app_settings (key, value_text, description) VALUES
(
  'google_api_key',
  '',
  'Google Gemini API Key. Береться з цього поля, а не з .env файлу'
),
(
  'system_prompt',
  'Ти — досвідчений український адвокат. Твоє завдання: надати точну, структуровану та корисну відповідь на питання користувача, базуючись ТІЛЬКИ на наданому контексті.',
  'Головний системний промпт для AI-асистента'
),
(
  'ai_model',
  'gemini-2.0-flash-lite',
  'Назва моделі Gemini для генерації відповідей (напр. gemini-1.5-pro)'
),
(
  'embedding_model',
  'models/gemini-embedding-001',
  'Модель для векторизації тексту. УВАГА: Зміна потребує перерахунку всієї бази знань!'
),
(
  'temperature',
  '0.1',
  'Творчість відповідей (0.0 = детермінований, 1.0 = максимально варіативний)'
),
(
  'top_p',
  '0.8',
  'Nucleus sampling параметр (рекомендовано: 0.8)'
)
ON CONFLICT (key) DO NOTHING;

-- Schedule setting
INSERT INTO public.app_settings (key, value_bool, description) VALUES
(
  'schedule_enabled',
  false,
  'Чи увімкнений автоматичний розклад синхронізації'
)
ON CONFLICT (key) DO NOTHING;

-- ── 2. Онбординг-опитувальник ────────────────────────────────────────────────
-- Таблиця для зберігання кроків онбордингу
CREATE TABLE IF NOT EXISTS public.onboarding_steps (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    step_key    text NOT NULL UNIQUE,  -- 'segments' | 'roles' | 'sub_roles'
    title       text NOT NULL,
    subtitle    text,
    order_index integer NOT NULL DEFAULT 0,
    is_active   boolean NOT NULL DEFAULT true,
    updated_at  timestamp with time zone DEFAULT timezone('utc', now())
);

-- Таблиця для варіантів відповідей
CREATE TABLE IF NOT EXISTS public.onboarding_options (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    step_key    text NOT NULL REFERENCES public.onboarding_steps(step_key) ON DELETE CASCADE,
    value       text NOT NULL,
    label       text NOT NULL,
    description text,
    icon        text,          -- назва іконки lucide (напр. 'Scale', 'Briefcase')
    parent_value text,         -- для sub_roles: прив'язка до segments.value
    order_index integer NOT NULL DEFAULT 0,
    is_active   boolean NOT NULL DEFAULT true,
    created_at  timestamp with time zone DEFAULT timezone('utc', now())
);

-- Кроки онбордингу за замовчуванням
INSERT INTO public.onboarding_steps (step_key, title, subtitle, order_index) VALUES
('segments', 'Яка ваша основна сфера?',      'Можна обрати кілька варіантів',                         1),
('roles',    'Ваша роль',                     'Відповіді будуть адаптовані до вашого рівня',           2),
('sub_roles','Уточніть спеціалізацію',        'Необов''язково — але допоможе точніше відповідати', 3)
ON CONFLICT (step_key) DO NOTHING;

-- Варіанти сегментів
INSERT INTO public.onboarding_options (step_key, value, label, description, icon, order_index) VALUES
('segments', 'legal_pro',         'Юридична сфера',      'Адвокати, юристи, нотаріуси',              'Scale',          1),
('segments', 'business_finance',  'Бізнес і фінанси',    'Підприємці, бухгалтери, фінансисти',       'Briefcase',      2),
('segments', 'gov_sector',        'Держсектор',          'Держслужбовці, органи влади',              'Landmark',       3),
('segments', 'military_theme',    'Військова тематика',  'Ветерани, військовозобов''язані',          'Shield',         4),
('segments', 'social_vulnerable', 'Соціально вразливі',  'Пенсіонери, особи з інвалідністю',        'HeartHandshake', 5),
('segments', 'daily_life',        'Повсякденні питання', 'Права споживача, ЖКГ, трудові спори',     'Home',           6),
('segments', 'specialized_niche', 'Спеціалізована ніша', 'IT, медицина, нерухомість та інше',       'FlaskConical',   7)
ON CONFLICT DO NOTHING;

-- Варіанти ролей
INSERT INTO public.onboarding_options (step_key, value, label, order_index) VALUES
('roles', 'lawyer',         'Юрист / Адвокат',                1),
('roles', 'accountant',     'Бухгалтер',                      2),
('roles', 'tax_specialist', 'Податковий консультант',          3),
('roles', 'business_owner', 'Підприємець / Власник бізнесу',  4),
('roles', 'private_person', 'Приватна особа',                  5)
ON CONFLICT DO NOTHING;

-- Варіанти спеціалізацій (прив'язані до сегментів через parent_value)
INSERT INTO public.onboarding_options (step_key, value, label, parent_value, order_index) VALUES
('sub_roles', 'Адвокат',               'Адвокат',               'legal_pro',         1),
('sub_roles', 'Нотаріус',              'Нотаріус',              'legal_pro',         2),
('sub_roles', 'Юрисконсульт',          'Юрисконсульт',          'legal_pro',         3),
('sub_roles', 'Суддя',                 'Суддя',                 'legal_pro',         4),
('sub_roles', 'Прокурор',              'Прокурор',              'legal_pro',         5),
('sub_roles', 'Медіатор',              'Медіатор',              'legal_pro',         6),
('sub_roles', 'ФОП',                   'ФОП',                   'business_finance',  7),
('sub_roles', 'ТОВ',                   'ТОВ',                   'business_finance',  8),
('sub_roles', 'Бухгалтер',             'Бухгалтер',             'business_finance',  9),
('sub_roles', 'Фінансовий директор',   'Фінансовий директор',   'business_finance', 10),
('sub_roles', 'Аудитор',               'Аудитор',               'business_finance', 11),
('sub_roles', 'Держслужбовець',        'Держслужбовець',        'gov_sector',       12),
('sub_roles', 'Депутат місцевої ради', 'Депутат місцевої ради', 'gov_sector',       13),
('sub_roles', 'Посадова особа',        'Посадова особа',        'gov_sector',       14),
('sub_roles', 'Ветеран',               'Ветеран',               'military_theme',   15),
('sub_roles', 'Військовослужбовець',   'Військовослужбовець',   'military_theme',   16),
('sub_roles', 'Мобілізований',         'Мобілізований',         'military_theme',   17),
('sub_roles', 'Член сімʼї ветерана',   'Член сімʼї ветерана',   'military_theme',   18),
('sub_roles', 'Пенсіонер',             'Пенсіонер',             'social_vulnerable',19),
('sub_roles', 'Особа з інвалідністю',  'Особа з інвалідністю',  'social_vulnerable',20),
('sub_roles', 'Малозабезпечений',      'Малозабезпечений',      'social_vulnerable',21),
('sub_roles', 'ВПО',                   'Внутрішньо переміщена особа', 'social_vulnerable',22),
('sub_roles', 'Орендар/Власник',       'Орендар / Власник нерухомості','daily_life', 23),
('sub_roles', 'Споживач',              'Споживач',              'daily_life',       24),
('sub_roles', 'Працівник',             'Працівник',             'daily_life',       25),
('sub_roles', 'Батько/Мати',           'Батько / Мати',         'daily_life',       26),
('sub_roles', 'IT-спеціаліст',         'IT-спеціаліст',         'specialized_niche',27),
('sub_roles', 'Медичний працівник',    'Медичний працівник',    'specialized_niche',28),
('sub_roles', 'Ріелтор',               'Ріелтор',               'specialized_niche',29),
('sub_roles', 'Страховий агент',       'Страховий агент',       'specialized_niche',30),
('sub_roles', 'Інше',                  'Інше',                  'specialized_niche',31)
ON CONFLICT DO NOTHING;

-- ── 3. Відповіді користувачів (для аналітики) ────────────────────────────────
CREATE TABLE IF NOT EXISTS public.onboarding_responses (
    id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid REFERENCES auth.users(id) ON DELETE CASCADE,
    segments    text[]  NOT NULL DEFAULT '{}',
    role        text,
    sub_role    text,
    completed_at timestamp with time zone DEFAULT timezone('utc', now())
);

CREATE INDEX IF NOT EXISTS idx_onboarding_responses_user ON public.onboarding_responses(user_id);

-- ── 4. RLS ───────────────────────────────────────────────────────────────────
ALTER TABLE public.app_settings        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_steps    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_options  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.onboarding_responses ENABLE ROW LEVEL SECURITY;

-- app_settings: тільки service role читає/пише
DROP POLICY IF EXISTS "service_rw_app_settings" ON public.app_settings;
CREATE POLICY "service_rw_app_settings" ON public.app_settings
    USING (auth.role() = 'service_role');

-- onboarding_steps: всі читають, service пише
DROP POLICY IF EXISTS "public_read_steps" ON public.onboarding_steps;
CREATE POLICY "public_read_steps" ON public.onboarding_steps FOR SELECT USING (true);

DROP POLICY IF EXISTS "public_read_options" ON public.onboarding_options;
CREATE POLICY "public_read_options" ON public.onboarding_options FOR SELECT USING (true);

-- onboarding_responses: користувач бачить тільки своє
DROP POLICY IF EXISTS "user_own_responses" ON public.onboarding_responses;
CREATE POLICY "user_own_responses" ON public.onboarding_responses
    USING (auth.uid() = user_id);
