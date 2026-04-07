-- ═══════════════════════════════════════════════════════════════════════════
-- Перехід з Google API Key → Vertex AI Service Account
-- Виконати в Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- Видаляємо старий ключ (він більше не потрібен)
DELETE FROM public.app_settings WHERE key = 'google_api_key';

-- Додаємо нові поля для Vertex AI
INSERT INTO public.app_settings (key, value_text, description) VALUES
(
  'service_account_json',
  '',
  'Google Service Account JSON (повний вміст файлу). Завантажується через адмінку.'
),
(
  'vertex_location',
  'us-central1',
  'Vertex AI регіон (us-central1, europe-west1, тощо)'
)
ON CONFLICT (key) DO NOTHING;

-- Оновлюємо embedding_model на Vertex AI формат
UPDATE public.app_settings
SET value_text = 'text-embedding-004', updated_at = timezone('utc', now())
WHERE key = 'embedding_model' AND value_text LIKE 'models/%';

-- Оновлюємо ai_model якщо ще старий формат
UPDATE public.app_settings
SET value_text = 'gemini-2.0-flash-lite', updated_at = timezone('utc', now())
WHERE key = 'ai_model' AND (value_text LIKE 'gemini-3%' OR value_text = '');
