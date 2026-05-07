-- ═══════════════════════════════════════════════════════════════════════════
-- Lawyer AI — Chat History & Analytics
-- Run in Supabase SQL Editor
-- ═══════════════════════════════════════════════════════════════════════════

-- 1. Chats (sessions)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.chats (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  title      TEXT NOT NULL DEFAULT 'Новий чат',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  deleted_by_user BOOLEAN NOT NULL DEFAULT FALSE
);

CREATE INDEX IF NOT EXISTS idx_chats_user_updated ON public.chats(user_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_chats_user_active_updated ON public.chats(user_id, updated_at DESC) WHERE deleted_at IS NULL;

ALTER TABLE public.chats ENABLE ROW LEVEL SECURITY;

CREATE POLICY "chats: select own"  ON public.chats FOR SELECT  USING (auth.uid() = user_id);
CREATE POLICY "chats: insert own"  ON public.chats FOR INSERT  WITH CHECK (auth.uid() = user_id);
CREATE POLICY "chats: update own"  ON public.chats FOR UPDATE  USING (auth.uid() = user_id);
CREATE POLICY "chats: delete own"  ON public.chats FOR DELETE  USING (auth.uid() = user_id);

-- auto updated_at
CREATE OR REPLACE FUNCTION public.fn_chats_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = NOW(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_chats_updated_at ON public.chats;
CREATE TRIGGER trg_chats_updated_at
  BEFORE UPDATE ON public.chats
  FOR EACH ROW EXECUTE FUNCTION public.fn_chats_updated_at();


-- 2. Messages (full history)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.messages (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  chat_id    UUID NOT NULL REFERENCES public.chats(id) ON DELETE CASCADE,
  role       TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content    TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_messages_chat_created ON public.messages(chat_id, created_at ASC);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Messages are accessible if the parent chat belongs to the current user
CREATE POLICY "messages: select own" ON public.messages FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.chats WHERE chats.id = messages.chat_id AND chats.user_id = auth.uid()));

CREATE POLICY "messages: insert own" ON public.messages FOR INSERT
  WITH CHECK (EXISTS (SELECT 1 FROM public.chats WHERE chats.id = messages.chat_id AND chats.user_id = auth.uid()));


-- 3. Query analytics (admin insights)
-- ────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.query_analytics (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chat_id      UUID REFERENCES public.chats(id) ON DELETE SET NULL,
  query_text   TEXT NOT NULL,
  ai_response  TEXT NOT NULL,
  category     TEXT,                   -- AI-generated: 'Трудове', 'Кримінальне', etc.
  tokens_used  INTEGER DEFAULT 0,
  user_ip      TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_user    ON public.query_analytics(user_id);
CREATE INDEX IF NOT EXISTS idx_analytics_cat     ON public.query_analytics(category);
CREATE INDEX IF NOT EXISTS idx_analytics_created ON public.query_analytics(created_at DESC);

-- Admin reads all; users read only their own
ALTER TABLE public.query_analytics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "analytics: select own" ON public.query_analytics FOR SELECT
  USING (auth.uid() = user_id);

-- Inserts go via service role from API routes (bypasses RLS)
