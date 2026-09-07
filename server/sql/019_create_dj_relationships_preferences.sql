-- Local additive schema for DJ relationships, activity feed sources and challenge preferences.
-- Do not apply remotely until reviewed with the rest of the authenticated battle lifecycle migrations.

CREATE TABLE IF NOT EXISTS public.dj_follows (
  id text PRIMARY KEY,
  follower_user_id text NOT NULL,
  followed_user_id text NOT NULL,
  follower_public_profile_id text,
  followed_public_profile_id text NOT NULL,
  follower_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  followed_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dj_follows_no_self_follow CHECK (follower_user_id <> followed_user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS dj_follows_active_pair_idx
  ON public.dj_follows (follower_user_id, followed_user_id)
  WHERE active = true;

CREATE INDEX IF NOT EXISTS dj_follows_following_idx
  ON public.dj_follows (follower_user_id, active, updated_at DESC);

CREATE INDEX IF NOT EXISTS dj_follows_followers_idx
  ON public.dj_follows (followed_user_id, active, updated_at DESC);

CREATE INDEX IF NOT EXISTS dj_follows_public_profile_idx
  ON public.dj_follows (followed_public_profile_id, active);

CREATE INDEX IF NOT EXISTS dj_follows_follower_public_profile_idx
  ON public.dj_follows (follower_public_profile_id, active);

CREATE INDEX IF NOT EXISTS dj_follows_event_version_idx
  ON public.dj_follows (updated_at DESC, created_at DESC)
  WHERE active = true;

CREATE TABLE IF NOT EXISTS public.dj_challenge_preferences (
  id text PRIMARY KEY,
  user_id text NOT NULL UNIQUE,
  who_may_challenge text NOT NULL DEFAULT 'everyone'
    CHECK (who_may_challenge IN ('everyone', 'followed', 'prior_opponents', 'nobody')),
  allowed_modes text[] NOT NULL DEFAULT '{}'::text[],
  allowed_genres text[] NOT NULL DEFAULT '{}'::text[],
  min_rating numeric,
  max_rating numeric,
  allowed_belts text[] NOT NULL DEFAULT '{}'::text[],
  bitcoin_battles text NOT NULL DEFAULT 'metadata_only'
    CHECK (bitcoin_battles IN ('allow', 'metadata_only', 'deny')),
  auto_decline_outside_rules boolean NOT NULL DEFAULT false,
  notification_preferences jsonb NOT NULL DEFAULT '{"challenges":true,"rematches":true,"follows":true}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT dj_challenge_preferences_rating_order CHECK (
    min_rating IS NULL OR max_rating IS NULL OR min_rating <= max_rating
  )
);

CREATE INDEX IF NOT EXISTS dj_challenge_preferences_user_idx
  ON public.dj_challenge_preferences (user_id);

CREATE TABLE IF NOT EXISTS public.dj_activity_feed_events (
  id text PRIMARY KEY,
  actor_user_id text NOT NULL,
  actor_public_profile_id text,
  source_type text NOT NULL,
  source_id text NOT NULL,
  source_version text NOT NULL DEFAULT '',
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  event_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS dj_activity_feed_source_version_idx
  ON public.dj_activity_feed_events (source_type, source_id, source_version);

CREATE INDEX IF NOT EXISTS dj_activity_feed_actor_public_idx
  ON public.dj_activity_feed_events (actor_user_id, visibility, created_at DESC);

-- Migration 018 created challenge/battle notification checks. This guarded block expands
-- accepted local values for relationship and rematch events without changing private payloads.
DO $$
BEGIN
  ALTER TABLE public.dj_notifications
    DROP CONSTRAINT IF EXISTS dj_notifications_type_check;
  ALTER TABLE public.dj_notifications
    ADD CONSTRAINT dj_notifications_type_check CHECK (
      type IN (
        'challenge_received',
        'challenge_accepted',
        'challenge_declined',
        'challenge_cancelled',
        'challenge_expired',
        'challenge_converted_to_battle',
        'rematch_requested',
        'follow_started'
      )
    );
  ALTER TABLE public.dj_notifications
    DROP CONSTRAINT IF EXISTS dj_notifications_category_check;
  ALTER TABLE public.dj_notifications
    ADD CONSTRAINT dj_notifications_category_check CHECK (
      category IN ('challenge', 'battle', 'relationship')
    );
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

ALTER TABLE public.dj_follows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dj_challenge_preferences ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dj_activity_feed_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_select_own_dj_follows ON public.dj_follows;
CREATE POLICY allow_select_own_dj_follows ON public.dj_follows
  FOR SELECT USING (
    auth.uid()::text = follower_user_id
    OR auth.uid()::text = followed_user_id
  );

DROP POLICY IF EXISTS allow_insert_own_dj_follows ON public.dj_follows;
CREATE POLICY allow_insert_own_dj_follows ON public.dj_follows
  FOR INSERT WITH CHECK (auth.uid()::text = follower_user_id);

DROP POLICY IF EXISTS allow_update_own_dj_follows ON public.dj_follows;
CREATE POLICY allow_update_own_dj_follows ON public.dj_follows
  FOR UPDATE USING (auth.uid()::text = follower_user_id)
  WITH CHECK (auth.uid()::text = follower_user_id);

DROP POLICY IF EXISTS allow_select_own_challenge_preferences ON public.dj_challenge_preferences;
CREATE POLICY allow_select_own_challenge_preferences ON public.dj_challenge_preferences
  FOR SELECT USING (auth.uid()::text = user_id);

DROP POLICY IF EXISTS allow_upsert_own_challenge_preferences ON public.dj_challenge_preferences;
CREATE POLICY allow_upsert_own_challenge_preferences ON public.dj_challenge_preferences
  FOR ALL USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS allow_select_public_activity_feed_events ON public.dj_activity_feed_events;
CREATE POLICY allow_select_public_activity_feed_events ON public.dj_activity_feed_events
  FOR SELECT USING (visibility = 'public');

-- No wallet custody, payouts, deposits, permanent public download URLs or service credentials are stored here.
