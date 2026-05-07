-- ============================================================
-- Chat soft delete
-- Run once in Supabase SQL editor
-- ============================================================

ALTER TABLE public.chats
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by_user BOOLEAN NOT NULL DEFAULT FALSE;

CREATE INDEX IF NOT EXISTS idx_chats_user_active_updated
  ON public.chats(user_id, updated_at DESC)
  WHERE deleted_at IS NULL;

