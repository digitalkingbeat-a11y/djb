-- Remix contests. A host posts a track as parts (stems) or a full track (remix_contests), DJs and
-- producers send one remix each (remix_contest_entries), and the crowd votes once per account after
-- submissions close (remix_contest_votes). Adds the "Your remix won" and "Sell your winning remix?"
-- Activity-bell types and lets contests and remixes be reported through the community report queue.
-- Audio lives in the existing private battle-mixes bucket under private/battle-entries/remix-contests/.
-- Apply after 048. Safe to re-run. Server-only tables (no browser access).
CREATE TABLE IF NOT EXISTS public.remix_contests (
  id text PRIMARY KEY,
  host_user_id uuid NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 3 AND 100),
  description text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','open','completed','cancelled')),
  rights_classification text NOT NULL CHECK (rights_classification IN ('original','licensed','royalty_free','platform_cleared')),
  rights_confirmed_at timestamptz NOT NULL,
  submission_deadline timestamptz NOT NULL,
  voting_deadline timestamptz NOT NULL,
  parts jsonb NOT NULL DEFAULT '[]'::jsonb,
  winner_entry_id text,
  winner_user_id uuid,
  store_offer_status text NOT NULL DEFAULT 'none' CHECK (store_offer_status IN ('none','offered','accepted','declined','listed')),
  store_price_cents integer CHECK (store_price_cents IS NULL OR store_price_cents BETWEEN 100 AND 50000),
  store_consent_at timestamptz,
  store_listing_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  published_at timestamptz,
  completed_at timestamptz,
  cancelled_at timestamptz,
  CHECK (voting_deadline > submission_deadline)
);
CREATE INDEX IF NOT EXISTS remix_contests_status_idx ON public.remix_contests (status, submission_deadline);
CREATE INDEX IF NOT EXISTS remix_contests_winner_idx ON public.remix_contests (winner_user_id) WHERE winner_user_id IS NOT NULL;
ALTER TABLE public.remix_contests ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.remix_contest_entries (
  id text PRIMARY KEY,
  contest_id text NOT NULL REFERENCES public.remix_contests(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending_upload' CHECK (status IN ('pending_upload','submitted','hidden')),
  title text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  storage_path text CHECK (storage_path IS NULL OR storage_path ~ '^private/battle-entries/remix-contests/'),
  filename text, mime_type text, size bigint,
  pending_path text CHECK (pending_path IS NULL OR pending_path ~ '^private/battle-entries/remix-contests/'),
  pending_filename text, pending_mime_type text, pending_size bigint, pending_title text, pending_notes text,
  submitted_at timestamptz,
  moderated_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (contest_id, user_id) -- one remix per person per contest (replacing updates this row)
);
ALTER TABLE public.remix_contest_entries ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.remix_contest_votes (
  contest_id text NOT NULL REFERENCES public.remix_contests(id) ON DELETE CASCADE,
  voter_user_id uuid NOT NULL,
  entry_id text NOT NULL REFERENCES public.remix_contest_entries(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (contest_id, voter_user_id) -- one vote per account per contest
);
ALTER TABLE public.remix_contest_votes ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.community_reports DROP CONSTRAINT IF EXISTS community_reports_target_type_check;
ALTER TABLE public.community_reports ADD CONSTRAINT community_reports_target_type_check
  CHECK (target_type IN ('post', 'comment', 'battle_chat_message', 'timed_comment', 'direct_message', 'remix_contest', 'remix_entry'));

ALTER TABLE public.dj_notifications
  DROP CONSTRAINT IF EXISTS dj_notifications_type_check,
  ADD CONSTRAINT dj_notifications_type_check CHECK (type IN ('challenge_received','challenge_accepted','challenge_declined','challenge_cancelled','challenge_expired','challenge_converted_to_battle','rematch_requested','follow_started','comment_received','reply_received','reaction_received','moderation_update','mention_received','tournament_match_ready','battle_chat_message','timed_comment_received','direct_message','result_review_decided','invite_joined','remix_contest_won','remix_store_offer'));
ALTER TABLE public.dj_notification_mutes
  DROP CONSTRAINT IF EXISTS dj_notification_mutes_notification_type_check,
  ADD CONSTRAINT dj_notification_mutes_notification_type_check CHECK (notification_type IS NULL OR notification_type IN ('challenge_received','challenge_accepted','challenge_declined','challenge_cancelled','challenge_expired','challenge_converted_to_battle','rematch_requested','follow_started','comment_received','reply_received','reaction_received','moderation_update','mention_received','tournament_match_ready','battle_chat_message','timed_comment_received','direct_message','result_review_decided','invite_joined','remix_contest_won','remix_store_offer'));
