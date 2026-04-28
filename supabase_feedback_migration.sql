-- ============================================================
-- Feedback & Review system migration
-- Run once in Supabase SQL editor
-- ============================================================

-- 1. Add bonus_requests + reward flag to profiles
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS bonus_requests          INTEGER   DEFAULT 0     NOT NULL,
  ADD COLUMN IF NOT EXISTS has_received_review_reward BOOLEAN DEFAULT FALSE NOT NULL,
  ADD COLUMN IF NOT EXISTS review_prompted_at      TIMESTAMPTZ;

-- 2. message_feedback table
CREATE TABLE IF NOT EXISTS public.message_feedback (
  id                  UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  chat_id             UUID        NOT NULL REFERENCES public.chats(id)    ON DELETE CASCADE,
  message_id          UUID        NOT NULL REFERENCES public.messages(id) ON DELETE CASCADE,
  is_positive         BOOLEAN     NOT NULL,
  tags                TEXT[]      DEFAULT '{}',
  feedback_text       TEXT,
  audio_transcription TEXT,
  created_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at          TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  -- one feedback per message per user, upsertable
  CONSTRAINT uq_message_feedback UNIQUE (message_id, user_id)
);

-- Auto-update updated_at on message_feedback
CREATE OR REPLACE FUNCTION fn_set_message_feedback_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_message_feedback_updated_at ON public.message_feedback;
CREATE TRIGGER trg_message_feedback_updated_at
  BEFORE UPDATE ON public.message_feedback
  FOR EACH ROW EXECUTE FUNCTION fn_set_message_feedback_updated_at();

-- 3. app_reviews table (full history — no UNIQUE on user_id)
CREATE TABLE IF NOT EXISTS public.app_reviews (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     UUID        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  rating      SMALLINT    NOT NULL CHECK (rating BETWEEN 1 AND 5),
  review_text TEXT        NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- 4. RLS: message_feedback
ALTER TABLE public.message_feedback ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "feedback_insert_own"  ON public.message_feedback;
DROP POLICY IF EXISTS "feedback_select_own"  ON public.message_feedback;
DROP POLICY IF EXISTS "feedback_update_own"  ON public.message_feedback;

CREATE POLICY "feedback_insert_own"  ON public.message_feedback FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "feedback_select_own"  ON public.message_feedback FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "feedback_update_own"  ON public.message_feedback FOR UPDATE
  USING (user_id = auth.uid());

-- 5. RLS: app_reviews
ALTER TABLE public.app_reviews ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "reviews_insert_own"  ON public.app_reviews;
DROP POLICY IF EXISTS "reviews_select_own"  ON public.app_reviews;

CREATE POLICY "reviews_insert_own"  ON public.app_reviews FOR INSERT
  WITH CHECK (user_id = auth.uid());

CREATE POLICY "reviews_select_own"  ON public.app_reviews FOR SELECT
  USING (user_id = auth.uid());

-- 6. Configurable constants in app_settings
INSERT INTO public.app_settings (key, value_int) VALUES
  ('review_reward_requests', 50),
  ('review_trigger_count',   10),
  ('review_min_text_length', 20)
ON CONFLICT (key) DO NOTHING;

-- 7. RPC: submit_app_review_and_reward
-- Inserts a review for the calling user, and (once) adds bonus_requests.
-- Security: SECURITY DEFINER runs as postgres, bypasses RLS for the update.
CREATE OR REPLACE FUNCTION public.submit_app_review_and_reward(
  p_rating      SMALLINT,
  p_review_text TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id    UUID    := auth.uid();
  v_reward     INTEGER;
  v_min_length INTEGER;
  v_already    BOOLEAN;
  v_rewarded   BOOLEAN := FALSE;
BEGIN
  -- Validate inputs
  IF p_rating < 1 OR p_rating > 5 THEN
    RAISE EXCEPTION 'rating must be between 1 and 5';
  END IF;

  -- Read configurable constants
  SELECT COALESCE(value_int, 50) INTO v_reward
    FROM app_settings WHERE key = 'review_reward_requests';
  SELECT COALESCE(value_int, 20) INTO v_min_length
    FROM app_settings WHERE key = 'review_min_text_length';

  IF v_reward IS NULL THEN v_reward := 50; END IF;
  IF v_min_length IS NULL THEN v_min_length := 20; END IF;

  -- Validate text length
  IF length(trim(p_review_text)) < v_min_length THEN
    RAISE EXCEPTION 'review_text too short (min % chars)', v_min_length;
  END IF;

  -- Check if reward already given (lock row to prevent race condition)
  SELECT has_received_review_reward INTO v_already
    FROM profiles WHERE id = v_user_id FOR UPDATE;

  -- Always insert the review
  INSERT INTO app_reviews (user_id, rating, review_text)
    VALUES (v_user_id, p_rating, p_review_text);

  -- Give reward only once
  IF NOT v_already THEN
    UPDATE profiles
      SET bonus_requests              = bonus_requests + v_reward,
          has_received_review_reward  = TRUE
      WHERE id = v_user_id;
    v_rewarded := TRUE;
  END IF;

  RETURN jsonb_build_object('rewarded', v_rewarded, 'bonus_added', CASE WHEN v_rewarded THEN v_reward ELSE 0 END);
END;
$$;

-- Grant execute to authenticated users
REVOKE ALL ON FUNCTION public.submit_app_review_and_reward(SMALLINT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_app_review_and_reward(SMALLINT, TEXT) TO authenticated;
