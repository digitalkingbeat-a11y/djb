-- Server-backed DJ profile challenges.
-- Additive/local-review migration only. Do not apply remotely without review.
-- Challenge records store proposed battle rules and sanitized public identities.
-- They do not store private crate memberships, snapshot tracks, storage paths,
-- signed URLs, service credentials or payment-action state.

CREATE TABLE IF NOT EXISTS public.dj_challenges (
  id text PRIMARY KEY,
  public_challenge_id text NOT NULL UNIQUE,
  challenger_user_id text NOT NULL,
  recipient_user_id text NOT NULL,
  challenger_public_profile_id text,
  recipient_public_profile_id text NOT NULL,
  challenger_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  recipient_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  challenger_crate_id text,
  challenge_rules jsonb NOT NULL DEFAULT '{}'::jsonb,
  rules_hash text NOT NULL,
  proposed_battle_id text NOT NULL,
  battle_id text REFERENCES public.battle_records(id),
  origin_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  idempotency_key text,
  status text NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired', 'converted-to-battle')),
  expires_at timestamptz NOT NULL,
  accepted_at timestamptz,
  declined_at timestamptz,
  cancelled_at timestamptz,
  expired_at timestamptz,
  converted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (challenger_user_id <> recipient_user_id),
  CHECK (recipient_public_profile_id ~ '^dj_[A-Za-z0-9_-]+$'),
  CHECK (challenger_public_profile_id IS NULL OR challenger_public_profile_id ~ '^dj_[A-Za-z0-9_-]+$'),
  CHECK (challenger_profile::text !~* '(email|auth|user_id|storage|signedurl|service_role|supabase_service|secret|private_key|xprv|private/)'),
  CHECK (recipient_profile::text !~* '(email|auth|user_id|storage|signedurl|service_role|supabase_service|secret|private_key|xprv|private/)'),
  CHECK (challenge_rules::text !~* '(storage_object_path|audio_storage|artwork_storage|signedurl|service_role|supabase_service|secret|private_key|xprv|wallet_seed|private/)'),
  CHECK (origin_context::text !~* '(email|auth|user_id|storage|signedurl|service_role|supabase_service|secret|private_key|xprv|private/)'),
  CHECK (battle_id IS NULL OR status = 'converted-to-battle')
);

CREATE UNIQUE INDEX IF NOT EXISTS dj_challenges_challenger_idempotency_idx
  ON public.dj_challenges (challenger_user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS dj_challenges_active_rules_idx
  ON public.dj_challenges (challenger_user_id, recipient_user_id, rules_hash)
  WHERE status IN ('pending', 'accepted');

CREATE UNIQUE INDEX IF NOT EXISTS dj_challenges_proposed_battle_idx
  ON public.dj_challenges (proposed_battle_id);

CREATE INDEX IF NOT EXISTS dj_challenges_recipient_status_idx
  ON public.dj_challenges (recipient_user_id, status, expires_at, created_at DESC);

CREATE INDEX IF NOT EXISTS dj_challenges_challenger_status_idx
  ON public.dj_challenges (challenger_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS dj_challenges_pending_expiration_idx
  ON public.dj_challenges (expires_at)
  WHERE status = 'pending';

ALTER TABLE public.dj_challenges ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_dj_challenges" ON public.dj_challenges
    FOR SELECT USING (
      challenger_user_id = auth.uid()::text
      OR recipient_user_id = auth.uid()::text
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_insert_own_dj_challenges" ON public.dj_challenges
    FOR INSERT WITH CHECK (
      challenger_user_id = auth.uid()::text
      AND challenger_user_id <> recipient_user_id
      AND status = 'pending'
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_update_participant_dj_challenges" ON public.dj_challenges
    FOR UPDATE USING (
      challenger_user_id = auth.uid()::text
      OR recipient_user_id = auth.uid()::text
    )
    WITH CHECK (
      challenger_user_id = auth.uid()::text
      OR recipient_user_id = auth.uid()::text
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE OR REPLACE FUNCTION public.prevent_dj_challenge_terminal_rewrite()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status IN ('declined', 'cancelled', 'expired', 'converted-to-battle')
     AND NEW.status <> OLD.status THEN
    RAISE EXCEPTION 'DJ challenge is already terminal';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS prevent_dj_challenge_terminal_rewrite_trigger ON public.dj_challenges;
CREATE TRIGGER prevent_dj_challenge_terminal_rewrite_trigger
  BEFORE UPDATE ON public.dj_challenges
  FOR EACH ROW
  EXECUTE FUNCTION public.prevent_dj_challenge_terminal_rewrite();

CREATE OR REPLACE FUNCTION public.accept_dj_challenge_for_update(challenge_id text)
RETURNS public.dj_challenges LANGUAGE plpgsql AS $$
DECLARE
  row public.dj_challenges;
BEGIN
  SELECT * INTO row
    FROM public.dj_challenges
    WHERE id = challenge_id
    FOR UPDATE;

  IF row.id IS NULL THEN
    RAISE EXCEPTION 'DJ challenge not found';
  END IF;

  IF row.status <> 'pending' THEN
    RAISE EXCEPTION 'DJ challenge is no longer pending';
  END IF;

  RETURN row;
END;
$$;
