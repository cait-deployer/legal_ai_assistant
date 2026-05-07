-- ============================================================
-- RAG evaluation cases
-- Run once in Supabase SQL editor
-- ============================================================

ALTER TABLE public.query_analytics
  ADD COLUMN IF NOT EXISTS message_id UUID REFERENCES public.messages(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS ai_eval JSONB;

CREATE TABLE IF NOT EXISTS public.rag_eval_cases (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  query_analytics_id  UUID        NOT NULL REFERENCES public.query_analytics(id) ON DELETE CASCADE,
  message_id          UUID        REFERENCES public.messages(id) ON DELETE SET NULL,
  chat_id             UUID        REFERENCES public.chats(id) ON DELETE SET NULL,
  user_id             UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  question            TEXT        NOT NULL,
  answer              TEXT,
  actual_sources      JSONB       DEFAULT '[]'::jsonb NOT NULL,
  expected_sources    JSONB       DEFAULT '[]'::jsonb NOT NULL,
  bad_sources         JSONB       DEFAULT '[]'::jsonb NOT NULL,
  answer_type         TEXT        NOT NULL DEFAULT 'mixed',
  has_direct_answer   BOOLEAN,
  eval_confidence     NUMERIC(4,3) DEFAULT 0 CHECK (eval_confidence >= 0 AND eval_confidence <= 1),
  eval_notes          TEXT,
  status              TEXT        NOT NULL DEFAULT 'ai_draft',
  is_gold             BOOLEAN     NOT NULL DEFAULT FALSE,
  reviewed_by         UUID        REFERENCES public.profiles(id) ON DELETE SET NULL,
  reviewed_at         TIMESTAMPTZ,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_rag_eval_query UNIQUE (query_analytics_id),
  CONSTRAINT chk_rag_eval_answer_type CHECK (
    answer_type IN (
      'direct_norm',
      'no_direct_norm',
      'procedure',
      'risk_analysis',
      'document_draft',
      'clarification_needed',
      'mixed'
    )
  ),
  CONSTRAINT chk_rag_eval_status CHECK (
    status IN ('ai_draft', 'human_reviewed', 'approved', 'rejected')
  )
);

CREATE INDEX IF NOT EXISTS idx_query_analytics_message_id
  ON public.query_analytics(message_id);

CREATE INDEX IF NOT EXISTS idx_rag_eval_cases_status
  ON public.rag_eval_cases(status);

CREATE INDEX IF NOT EXISTS idx_rag_eval_cases_is_gold
  ON public.rag_eval_cases(is_gold)
  WHERE is_gold = TRUE;

CREATE INDEX IF NOT EXISTS idx_rag_eval_cases_created_at
  ON public.rag_eval_cases(created_at DESC);

CREATE OR REPLACE FUNCTION public.fn_set_rag_eval_cases_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_rag_eval_cases_updated_at ON public.rag_eval_cases;
CREATE TRIGGER trg_rag_eval_cases_updated_at
  BEFORE UPDATE ON public.rag_eval_cases
  FOR EACH ROW EXECUTE FUNCTION public.fn_set_rag_eval_cases_updated_at();

