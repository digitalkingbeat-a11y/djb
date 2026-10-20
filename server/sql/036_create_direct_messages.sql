-- Oct 19c: one-on-one direct messages between DJs. Apply after 035.
-- The server reads and writes these rows with the service role (no browser policies) and only
-- returns display names and public profile ids. Blocks hide a conversation both ways; mutes
-- only silence the Activity bell. Safe to re-run.
CREATE TABLE IF NOT EXISTS public.direct_messages (
  id text PRIMARY KEY,
  conversation_key text NOT NULL,
  sender_user_id text NOT NULL,
  recipient_user_id text NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 1000),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'deleted')),
  read_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT direct_messages_no_self CHECK (sender_user_id <> recipient_user_id)
);
CREATE INDEX IF NOT EXISTS direct_messages_sender_idx ON public.direct_messages (sender_user_id, created_at);
CREATE INDEX IF NOT EXISTS direct_messages_recipient_idx ON public.direct_messages (recipient_user_id, created_at);
CREATE INDEX IF NOT EXISTS direct_messages_conversation_idx ON public.direct_messages (conversation_key, created_at);
ALTER TABLE public.direct_messages ENABLE ROW LEVEL SECURITY;

-- Direct messages can be reported (by the person who received them).
ALTER TABLE public.community_reports DROP CONSTRAINT IF EXISTS community_reports_target_type_check;
ALTER TABLE public.community_reports ADD CONSTRAINT community_reports_target_type_check
  CHECK (target_type IN ('post', 'comment', 'battle_chat_message', 'timed_comment', 'direct_message'));

-- New Activity-bell type, with its own on/off switch in Settings.
ALTER TABLE public.dj_notifications
  DROP CONSTRAINT IF EXISTS dj_notifications_type_check,
  ADD CONSTRAINT dj_notifications_type_check CHECK (type IN ('challenge_received','challenge_accepted','challenge_declined','challenge_cancelled','challenge_expired','challenge_converted_to_battle','rematch_requested','follow_started','comment_received','reply_received','reaction_received','moderation_update','mention_received','tournament_match_ready','battle_chat_message','timed_comment_received','direct_message'));
ALTER TABLE public.dj_notification_mutes
  DROP CONSTRAINT IF EXISTS dj_notification_mutes_notification_type_check,
  ADD CONSTRAINT dj_notification_mutes_notification_type_check CHECK (notification_type IS NULL OR notification_type IN ('challenge_received','challenge_accepted','challenge_declined','challenge_cancelled','challenge_expired','challenge_converted_to_battle','rematch_requested','follow_started','comment_received','reply_received','reaction_received','moderation_update','mention_received','tournament_match_ready','battle_chat_message','timed_comment_received','direct_message'));
