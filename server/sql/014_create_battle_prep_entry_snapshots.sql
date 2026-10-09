-- Server-backed Battle Prep entry snapshots.
-- This migration is additive and local-review ready. It stores immutable prep
-- evidence and safe metadata only; it does not store audio files, artwork
-- storage paths, signed URLs, credentials, wallet custody, transfers or payouts.

CREATE TABLE IF NOT EXISTS public.battle_records (
  id text PRIMARY KEY,
  created_by text NOT NULL,
  mode_id text NOT NULL,
  title text,
  genre text NOT NULL,
  duration_minutes numeric NOT NULL CHECK (duration_minutes > 0),
  track_selection_method text NOT NULL
    CHECK (track_selection_method IN ('assigned', 'own_selection', 'genre_pool', 'open_library', 'ai_practice')),
  track_count integer,
  minimum_track_count integer,
  opponent_requirement text NOT NULL
    CHECK (opponent_requirement IN ('required', 'optional', 'none')),
  capacity integer NOT NULL DEFAULT 2 CHECK (capacity > 0 AND capacity <= 16),
  visibility text NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private', 'available')),
  status text NOT NULL DEFAULT 'open'
    CHECK (status IN ('draft', 'open', 'waiting', 'matched', 'full', 'ready', 'started', 'active', 'submission_pending', 'judging', 'completed', 'cancelled', 'expired')),
  scoring_type text NOT NULL DEFAULT 'measured_rule_based'
    CHECK (scoring_type IN ('measured_rule_based', 'rule_based', 'ai_assisted', 'human_voted', 'hybrid')),
  start_conditions jsonb NOT NULL DEFAULT '{"startsWhenFull":true}'::jsonb,
  public_creator_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  reward_type text NOT NULL DEFAULT 'standard',
  reward jsonb NOT NULL DEFAULT '{"type":"standard","metadata":{}}'::jsonb,
  bitcoin_reward_metadata jsonb,
  resolution jsonb NOT NULL DEFAULT '{}'::jsonb,
  resolution_status text CHECK (resolution_status IS NULL OR resolution_status IN ('unresolved', 'resolved', 'void', 'failed')),
  resolution_version integer NOT NULL DEFAULT 0 CHECK (resolution_version >= 0),
  idempotency_key text,
  battle_version integer NOT NULL DEFAULT 0 CHECK (battle_version >= 0),
  expires_at timestamptz,
  started_at timestamptz,
  deadline_at timestamptz,
  resolved_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (public_creator_profile::text !~* '(email|auth|user_id|storage|signedurl|service_role|secret|private/)'),
  CHECK (start_conditions::text !~* '(storage|signedurl|service_role|secret|private/)'),
  CHECK (bitcoin_reward_metadata IS NULL OR bitcoin_reward_metadata::text !~* '(seed|private_key|xprv|service_role|secret)'),
  CHECK (resolution::text !~* '(storage_object_path|audio_storage|artwork_storage|signedurl|https?://|service_role|secret|private_key|xprv)')
);

CREATE UNIQUE INDEX IF NOT EXISTS battle_records_creator_idempotency_idx
  ON public.battle_records (created_by, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE INDEX IF NOT EXISTS battle_records_open_mode_idx
  ON public.battle_records (status, mode_id, genre, created_at DESC);

CREATE INDEX IF NOT EXISTS battle_records_public_lobby_idx
  ON public.battle_records (visibility, status, expires_at, created_at DESC);

CREATE INDEX IF NOT EXISTS battle_records_public_country_idx
  ON public.battle_records ((public_creator_profile->>'country'), status, created_at DESC);

CREATE INDEX IF NOT EXISTS battle_records_live_room_idx
  ON public.battle_records (status, battle_version, deadline_at);

CREATE INDEX IF NOT EXISTS battle_records_resolution_idx
  ON public.battle_records (resolution_status, resolved_at DESC);

ALTER TABLE public.battle_records
  ADD COLUMN IF NOT EXISTS resolution jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS resolution_status text,
  ADD COLUMN IF NOT EXISTS resolution_version integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

DO $$
BEGIN
  ALTER TABLE public.battle_records
    ADD CONSTRAINT battle_records_resolution_status_check
      CHECK (resolution_status IS NULL OR resolution_status IN ('unresolved', 'resolved', 'void', 'failed'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.battle_records
    ADD CONSTRAINT battle_records_resolution_redaction_check
      CHECK (resolution::text !~* '(storage_object_path|audio_storage|artwork_storage|signedurl|https?://|service_role|secret|private_key|xprv)');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.battle_entries
  ADD COLUMN IF NOT EXISTS battle_prep_snapshot_id uuid,
  ADD COLUMN IF NOT EXISTS public_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS presence_status text NOT NULL DEFAULT 'unknown'
    CHECK (presence_status IN ('unknown', 'online', 'reconnecting', 'offline')),
  ADD COLUMN IF NOT EXISTS presence_last_seen_at timestamptz,
  ADD COLUMN IF NOT EXISTS ready_at timestamptz,
  ADD COLUMN IF NOT EXISTS started_at timestamptz,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz,
  ADD COLUMN IF NOT EXISTS withdrawn_at timestamptz;

CREATE INDEX IF NOT EXISTS battle_entries_room_state_idx
  ON public.battle_entries (battle_id, status, presence_last_seen_at DESC);

-- Replace 009's active/withdrawn-only check; both checks must not coexist.
-- Revalidate the intended definition rather than swallowing duplicate names.
ALTER TABLE public.battle_entries
  DROP CONSTRAINT IF EXISTS battle_entries_status_check,
  DROP CONSTRAINT IF EXISTS battle_entries_live_status_check,
  ADD CONSTRAINT battle_entries_live_status_check
    CHECK (status IN (
      'active', 'joined', 'preparing', 'ready', 'started',
      'submitted', 'disconnected', 'withdrawn', 'completed'
    ));

DO $$
BEGIN
  ALTER TABLE public.battle_entries
    ADD CONSTRAINT battle_entries_public_profile_redaction_check
      CHECK (public_profile::text !~* '(email|auth|user_id|storage|signedurl|service_role|secret|private/)');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.battle_prep_entry_snapshots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id text NOT NULL,
  battle_entry_id uuid NOT NULL,
  user_id text NOT NULL,
  crate_id text,
  crate_version text,
  snapshot_version text NOT NULL,
  purpose text NOT NULL CHECK (purpose IN ('own_selection', 'reference')),
  track_selection_method text NOT NULL
    CHECK (track_selection_method IN ('assigned', 'own_selection', 'genre_pool', 'open_library', 'ai_practice')),
  replacement_allowed boolean NOT NULL DEFAULT false,
  tracks jsonb NOT NULL DEFAULT '[]'::jsonb,
  rule_decisions jsonb NOT NULL DEFAULT '{}'::jsonb,
  availability jsonb NOT NULL DEFAULT '{}'::jsonb,
  replacements jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (battle_entry_id, user_id),
  UNIQUE (id, user_id),
  FOREIGN KEY (battle_entry_id, user_id) REFERENCES public.battle_entries (id, user_id),
  CHECK (tracks::text !~* '(storage_object_path|audio_storage|artwork_storage|signedurl|https?://|private/)'),
  CHECK (rule_decisions::text !~* '(service_role|supabase_service|secret|signedurl)')
);

CREATE TABLE IF NOT EXISTS public.battle_prep_snapshot_replacements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  snapshot_id uuid NOT NULL REFERENCES public.battle_prep_entry_snapshots(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  from_track_id text NOT NULL,
  to_track_id text NOT NULL,
  reason text,
  rule_decision jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (snapshot_id, user_id) REFERENCES public.battle_prep_entry_snapshots(id, user_id)
);

CREATE TABLE IF NOT EXISTS public.battle_resolution_awards (
  id text PRIMARY KEY,
  battle_id text NOT NULL REFERENCES public.battle_records(id) ON DELETE CASCADE,
  battle_entry_id uuid NOT NULL,
  user_id text NOT NULL,
  submission_id uuid NOT NULL,
  resolution_id text NOT NULL,
  resolution_version integer NOT NULL CHECK (resolution_version >= 0),
  outcome text NOT NULL CHECK (outcome IN ('winner', 'loser', 'tie', 'void')),
  progression jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (battle_id, user_id),
  UNIQUE (resolution_id, user_id),
  CHECK (progression::text !~* '(service_role|secret|private_key|xprv|storage_object_path|signedurl)')
);

CREATE INDEX IF NOT EXISTS battle_prep_snapshots_owner_entry_idx
  ON public.battle_prep_entry_snapshots (user_id, battle_entry_id);

CREATE INDEX IF NOT EXISTS battle_prep_snapshots_battle_idx
  ON public.battle_prep_entry_snapshots (battle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS battle_prep_replacements_snapshot_idx
  ON public.battle_prep_snapshot_replacements (snapshot_id, created_at DESC);

CREATE INDEX IF NOT EXISTS battle_resolution_awards_battle_idx
  ON public.battle_resolution_awards (battle_id, created_at DESC);

CREATE INDEX IF NOT EXISTS battle_resolution_awards_user_idx
  ON public.battle_resolution_awards (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_battle_prep_snapshot_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.enforce_battle_record_entry_capacity()
RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  max_capacity integer;
  active_count integer;
BEGIN
  SELECT capacity INTO max_capacity
    FROM public.battle_records
    WHERE id = NEW.battle_id
    FOR UPDATE;

  IF max_capacity IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT count(*) INTO active_count
    FROM public.battle_entries
    WHERE battle_id = NEW.battle_id
      AND status <> 'withdrawn'
      AND id <> NEW.id;

  IF active_count >= max_capacity THEN
    RAISE EXCEPTION 'Battle is already full';
  END IF;

  RETURN NEW;
END;
$$;

DO $$
BEGIN
  CREATE TRIGGER battle_prep_snapshots_set_updated_at
    BEFORE UPDATE ON public.battle_prep_entry_snapshots
    FOR EACH ROW EXECUTE FUNCTION public.set_battle_prep_snapshot_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER battle_entries_enforce_battle_capacity
    BEFORE INSERT OR UPDATE OF battle_id, status ON public.battle_entries
    FOR EACH ROW EXECUTE FUNCTION public.enforce_battle_record_entry_capacity();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.battle_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_prep_entry_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_prep_snapshot_replacements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_resolution_awards ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "allow_select_joinable_battle_records" ON public.battle_records
    FOR SELECT USING (
      (visibility = 'public' AND status IN ('open', 'waiting', 'matched', 'full', 'ready', 'started', 'active', 'submission_pending', 'judging', 'cancelled', 'expired'))
      OR created_by = auth.uid()::text
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_battle_prep_snapshots" ON public.battle_prep_entry_snapshots
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_battle_prep_replacements" ON public.battle_prep_snapshot_replacements
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_battle_resolution_awards" ON public.battle_resolution_awards
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_insert_own_battle_prep_snapshots" ON public.battle_prep_entry_snapshots
    FOR INSERT WITH CHECK (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_insert_own_battle_prep_replacements" ON public.battle_prep_snapshot_replacements
    FOR INSERT WITH CHECK (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
