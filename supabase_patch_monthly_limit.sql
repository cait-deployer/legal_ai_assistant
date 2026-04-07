-- ═══════════════════════════════════════════════════════════════════════════
-- Patch: daily_limit → monthly_limit
-- Run in Supabase SQL Editor (safe to re-run)
-- ═══════════════════════════════════════════════════════════════════════════

-- Rename columns
ALTER TABLE public.profiles
  RENAME COLUMN requests_today    TO requests_this_month;

ALTER TABLE public.profiles
  RENAME COLUMN daily_limit       TO monthly_limit;

ALTER TABLE public.profiles
  RENAME COLUMN last_request_date TO last_request_month;

-- Change last_request_month from DATE to TEXT (store 'YYYY-MM' format)
ALTER TABLE public.profiles
  ALTER COLUMN last_request_month TYPE TEXT USING TO_CHAR(last_request_month, 'YYYY-MM');

-- Reset counters (fresh start)
UPDATE public.profiles
SET
  requests_this_month = 0,
  last_request_month  = TO_CHAR(NOW(), 'YYYY-MM');
