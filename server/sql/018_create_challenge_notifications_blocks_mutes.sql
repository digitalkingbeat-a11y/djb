-- Challenge notifications plus DJ block/mute safety.
-- Additive/local-review migration only. Do not apply remotely without review.
-- Notifications are private per owner and derived from authoritative challenge
-- status changes. They do not expose crate memberships, track IDs, snapshots,
-- storage paths, signed URLs, emails, service credentials or payment actions.

CREATE TABLE IF NOT EXISTS public.dj_notifications (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  type text NOT NULL CHECK (
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
  ),
  category text NOT NULL DEFAULT 'challenge'
    CHECK (category IN ('challenge', 'battle', 'relationship')),
  subject_type text NOT NULL DEFAULT 'dj_challenge',
  subject_id text NOT NULL,
  challenge_id text REFERENCES public.dj_challenges(id),
  event_key text NOT NULL,
  event_version bigint NOT NULL,
  actor_user_id text,
  actor_public_profile_id text,
  actor_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  challenge_snapshot jsonb NOT NULL DEFAULT '{}'::jsonb,
  destination jsonb NOT NULL DEFAULT '{}'::jsonb,
  summary text NOT NULL DEFAULT 'Challenge update',
  status text NOT NULL DEFAULT 'delivered'
    CHECK (status IN ('delivered', 'archived')),
  read_at timestamptz,
  archived_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (actor_profile::text !~* '(email|auth|user_id|storage|signedurl|service_role|supabase_service|secret|private_key|xprv|private/)'),
  CHECK (challenge_snapshot::text !~* '(email|auth|user_id|crate_id|track_id|snapshot_id|storage|signedurl|service_role|supabase_service|secret|private_key|xprv|private/)'),
  CHECK (destination::text !~* '(email|auth|user_id|crate_id|track_id|snapshot_id|storage|signedurl|service_role|supabase_service|secret|private_key|xprv|private/)')
);

CREATE UNIQUE INDEX IF NOT EXISTS dj_notifications_owner_event_idx
  ON public.dj_notifications (user_id, event_key);

CREATE INDEX IF NOT EXISTS dj_notifications_owner_unread_idx
  ON public.dj_notifications (user_id, read_at, archived_at, event_version DESC);

CREATE INDEX IF NOT EXISTS dj_notifications_owner_category_idx
  ON public.dj_notifications (user_id, category, event_version DESC);

CREATE INDEX IF NOT EXISTS dj_notifications_challenge_idx
  ON public.dj_notifications (challenge_id, event_version DESC);

CREATE TABLE IF NOT EXISTS public.dj_blocks (
  id text PRIMARY KEY,
  blocker_user_id text NOT NULL,
  blocked_user_id text NOT NULL,
  blocked_public_profile_id text,
  blocked_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'inactive')),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (blocker_user_id <> blocked_user_id),
  CHECK (blocked_profile::text !~* '(email|auth|user_id|storage|signedurl|service_role|supabase_service|secret|private_key|xprv|private/)') 
);

CREATE UNIQUE INDEX IF NOT EXISTS dj_blocks_active_pair_idx
  ON public.dj_blocks (blocker_user_id, blocked_user_id)
  WHERE active = true AND status = 'active';

CREATE UNIQUE INDEX IF NOT EXISTS dj_blocks_owner_idempotency_idx
  ON public.dj_blocks (blocker_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS dj_blocks_blocked_lookup_idx
  ON public.dj_blocks (blocked_user_id, blocker_user_id)
  WHERE active = true AND status = 'active';

CREATE TABLE IF NOT EXISTS public.dj_notification_mutes (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  muted_user_id text,
  muted_public_profile_id text,
  category text NOT NULL DEFAULT 'challenge'
    CHECK (category IN ('all', 'challenge', 'battle', 'relationship')),
  notification_type text CHECK (
    notification_type IS NULL OR notification_type IN (
      'challenge_received',
      'challenge_accepted',
      'challenge_declined',
      'challenge_cancelled',
      'challenge_expired',
      'challenge_converted_to_battle',
      'rematch_requested',
      'follow_started'
    )
  ),
  muted boolean NOT NULL DEFAULT true,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (muted_user_id IS NULL OR muted_user_id <> user_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS dj_notification_mutes_unique_active_idx
  ON public.dj_notification_mutes (
    user_id,
    COALESCE(muted_user_id, ''),
    COALESCE(muted_public_profile_id, ''),
    category,
    COALESCE(notification_type, '')
  )
  WHERE active = true AND muted = true;

CREATE INDEX IF NOT EXISTS dj_notification_mutes_owner_idx
  ON public.dj_notification_mutes (user_id, category, active);

ALTER TABLE public.dj_notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dj_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dj_notification_mutes ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_dj_notifications" ON public.dj_notifications
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_update_own_dj_notifications" ON public.dj_notifications
    FOR UPDATE USING (user_id = auth.uid()::text)
    WITH CHECK (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_dj_blocks" ON public.dj_blocks
    FOR SELECT USING (blocker_user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_insert_own_dj_blocks" ON public.dj_blocks
    FOR INSERT WITH CHECK (blocker_user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_update_own_dj_blocks" ON public.dj_blocks
    FOR UPDATE USING (blocker_user_id = auth.uid()::text)
    WITH CHECK (blocker_user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_dj_notification_mutes" ON public.dj_notification_mutes
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_insert_own_dj_notification_mutes" ON public.dj_notification_mutes
    FOR INSERT WITH CHECK (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_update_own_dj_notification_mutes" ON public.dj_notification_mutes
    FOR UPDATE USING (user_id = auth.uid()::text)
    WITH CHECK (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
