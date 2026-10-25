-- Oct 20c: personal invite-a-friend links. Each DJ gets one invite code (dj_invite_codes); when a
-- brand-new account arrives through that link it is credited to the inviter once
-- (dj_invite_joins). Adds the "A friend joined from your invite" Activity-bell type.
-- Apply after 047. Safe to re-run. Server-only tables (no browser access).
CREATE TABLE IF NOT EXISTS public.dj_invite_codes (
  user_id uuid PRIMARY KEY,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9]{6,12}$'),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS dj_invite_codes_code_uniq ON public.dj_invite_codes (code);
ALTER TABLE public.dj_invite_codes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.dj_invite_joins (
  invitee_user_id uuid PRIMARY KEY, -- each new DJ can only be credited to one inviter, once
  inviter_user_id uuid NOT NULL,
  code text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (invitee_user_id <> inviter_user_id)
);
CREATE INDEX IF NOT EXISTS dj_invite_joins_inviter_idx ON public.dj_invite_joins (inviter_user_id, created_at DESC);
ALTER TABLE public.dj_invite_joins ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.dj_notifications
  DROP CONSTRAINT IF EXISTS dj_notifications_type_check,
  ADD CONSTRAINT dj_notifications_type_check CHECK (type IN ('challenge_received','challenge_accepted','challenge_declined','challenge_cancelled','challenge_expired','challenge_converted_to_battle','rematch_requested','follow_started','comment_received','reply_received','reaction_received','moderation_update','mention_received','tournament_match_ready','battle_chat_message','timed_comment_received','direct_message','result_review_decided','invite_joined'));
ALTER TABLE public.dj_notification_mutes
  DROP CONSTRAINT IF EXISTS dj_notification_mutes_notification_type_check,
  ADD CONSTRAINT dj_notification_mutes_notification_type_check CHECK (notification_type IS NULL OR notification_type IN ('challenge_received','challenge_accepted','challenge_declined','challenge_cancelled','challenge_expired','challenge_converted_to_battle','rematch_requested','follow_started','comment_received','reply_received','reaction_received','moderation_update','mention_received','tournament_match_ready','battle_chat_message','timed_comment_received','direct_message','result_review_decided','invite_joined'));
