-- ═══════════════════════════════════════════════════════════════════════════
-- URAI — Sync Logs Migration
-- Виконати в Supabase SQL Editor або Adminer
-- ═══════════════════════════════════════════════════════════════════════════

CREATE TABLE IF NOT EXISTS public.sync_logs (
    id             bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    session_id     uuid         NOT NULL,
    source         text         NOT NULL DEFAULT 'rada',
    -- status: running | success | error | paused
    status         text         NOT NULL DEFAULT 'running',
    started_at     timestamptz  NOT NULL DEFAULT now(),
    finished_at    timestamptz,
    laws_processed integer,
    error_message  text
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_source_started
    ON public.sync_logs (source, started_at DESC);

CREATE INDEX IF NOT EXISTS idx_sync_logs_session
    ON public.sync_logs (session_id);

ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

-- Тільки service_role може читати/писати
DROP POLICY IF EXISTS "service_rw_sync_logs" ON public.sync_logs;
CREATE POLICY "service_rw_sync_logs" ON public.sync_logs
    USING (auth.role() = 'service_role');
