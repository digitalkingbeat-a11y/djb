-- Oct 19: battle room chat. Apply after 030.
-- Short messages between the DJs entered in one battle. Rows hold auth user ids, so there are
-- no browser-facing policies: the server reads and writes them with the service role and only
-- returns display names and public profile ids.
CREATE TABLE IF NOT EXISTS public.battle_chat_messages (
  id text PRIMARY KEY,
  battle_id text NOT NULL,
  user_id text NOT NULL,
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 280),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS battle_chat_messages_battle_idx
  ON public.battle_chat_messages (battle_id, created_at);

ALTER TABLE public.battle_chat_messages ENABLE ROW LEVEL SECURITY;

-- Chat messages and timed comments can be reported through /api/community/reports.
ALTER TABLE public.community_reports DROP CONSTRAINT IF EXISTS community_reports_target_type_check;
ALTER TABLE public.community_reports ADD CONSTRAINT community_reports_target_type_check
  CHECK (target_type IN ('post', 'comment', 'battle_chat_message', 'timed_comment'));
