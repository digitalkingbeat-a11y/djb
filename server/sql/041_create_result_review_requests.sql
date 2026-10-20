-- Oct 20: "Request a review" of a judged battle result, plus the "judge finished reviewing"
-- notification type. Apply after 040. Safe to re-run.
CREATE TABLE IF NOT EXISTS public.result_review_requests (
  id text PRIMARY KEY,
  user_id uuid NOT NULL,
  submission_id text NOT NULL,
  requester_public_profile_id text,
  battle_title text,
  reason text NOT NULL CHECK (reason IN ('timing_misread','wrong_track','audio_problem','scoring_rule','other')),
  note text NOT NULL DEFAULT '' CHECK (char_length(note) <= 600),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','decided')),
  outcome text CHECK (outcome IS NULL OR outcome IN ('confirmed','rescored')),
  original_score numeric,
  new_score numeric CHECK (new_score IS NULL OR (new_score >= 0 AND new_score <= 100)),
  decision_note text,
  decided_by uuid,
  decided_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS result_review_requests_user_idx ON public.result_review_requests (user_id);
CREATE INDEX IF NOT EXISTS result_review_requests_status_idx ON public.result_review_requests (status, created_at);
-- At most one open review per result.
CREATE UNIQUE INDEX IF NOT EXISTS result_review_requests_one_open ON public.result_review_requests (submission_id) WHERE status = 'pending';
ALTER TABLE public.result_review_requests ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.dj_notifications
  DROP CONSTRAINT IF EXISTS dj_notifications_type_check,
  ADD CONSTRAINT dj_notifications_type_check CHECK (type IN ('challenge_received','challenge_accepted','challenge_declined','challenge_cancelled','challenge_expired','challenge_converted_to_battle','rematch_requested','follow_started','comment_received','reply_received','reaction_received','moderation_update','mention_received','tournament_match_ready','battle_chat_message','timed_comment_received','direct_message','result_review_decided'));
ALTER TABLE public.dj_notification_mutes
  DROP CONSTRAINT IF EXISTS dj_notification_mutes_notification_type_check,
  ADD CONSTRAINT dj_notification_mutes_notification_type_check CHECK (notification_type IS NULL OR notification_type IN ('challenge_received','challenge_accepted','challenge_declined','challenge_cancelled','challenge_expired','challenge_converted_to_battle','rematch_requested','follow_started','comment_received','reply_received','reaction_received','moderation_update','mention_received','tournament_match_ready','battle_chat_message','timed_comment_received','direct_message','result_review_decided'));
