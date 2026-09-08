-- Public battle sharing and configurable community voting.
-- Community votes are scoring inputs only; they do not create orders, payments,
-- provider transactions, marketplace entitlements, settlements, payouts or
-- download authorization.

ALTER TABLE public.battle_records
  ADD COLUMN IF NOT EXISTS voting_config jsonb NOT NULL DEFAULT '{"enabled":false,"status":"disabled"}'::jsonb,
  ADD COLUMN IF NOT EXISTS locked_scoring_formula jsonb;

DO $$
BEGIN
  ALTER TABLE public.battle_records
    ADD CONSTRAINT battle_records_voting_config_redaction_check
      CHECK (voting_config::text !~* '(email|auth|user_id|storage|signedurl|service_role|secret|private/|access_token|refresh_token)');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.battle_records
    ADD CONSTRAINT battle_records_locked_scoring_formula_check
      CHECK (
        locked_scoring_formula IS NULL
        OR (
          locked_scoring_formula::text !~* '(email|auth|user_id|storage|signedurl|service_role|secret|private/|access_token|refresh_token)'
          AND COALESCE((locked_scoring_formula->'weights'->>'judge')::numeric, 1) >= 0
          AND COALESCE((locked_scoring_formula->'weights'->>'community')::numeric, 0) >= 0
        )
      );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS public.battle_community_votes (
  id text PRIMARY KEY,
  battle_id text NOT NULL REFERENCES public.battle_records(id) ON DELETE CASCADE,
  battle_entry_id uuid NOT NULL REFERENCES public.battle_entries(id) ON DELETE CASCADE,
  public_entry_id text NOT NULL,
  voter_user_id text NOT NULL,
  voter_fingerprint text NOT NULL CHECK (voter_fingerprint ~ '^[a-f0-9]{64}$'),
  normalized_score numeric NOT NULL CHECK (normalized_score >= 0 AND normalized_score <= 100),
  criteria_scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  note text,
  source text NOT NULL DEFAULT 'public_battle_vote',
  campaign text,
  referrer text,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'void', 'retracted', 'flagged')),
  active boolean NOT NULL DEFAULT true,
  idempotency_key text,
  vote_version integer NOT NULL DEFAULT 1 CHECK (vote_version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (battle_id, voter_user_id),
  UNIQUE (battle_id, voter_user_id, idempotency_key),
  CHECK (criteria_scores::text !~* '(email|auth|user_id|storage|signedurl|service_role|secret|private/|access_token|refresh_token)'),
  CHECK (source !~* '(secret|token|private/|service_role|access_token|refresh_token)'),
  CHECK (campaign IS NULL OR campaign !~* '(secret|token|private/|service_role|access_token|refresh_token)'),
  CHECK (referrer IS NULL OR referrer !~* '(secret|service_role|access_token|refresh_token)')
);

CREATE TABLE IF NOT EXISTS public.battle_community_vote_audit (
  id text PRIMARY KEY,
  vote_id text NOT NULL,
  battle_id text NOT NULL REFERENCES public.battle_records(id) ON DELETE CASCADE,
  battle_entry_id uuid NOT NULL,
  voter_user_id text NOT NULL,
  public_entry_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('created', 'updated', 'voided', 'flagged')),
  vote_version integer NOT NULL CHECK (vote_version > 0),
  audit_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (audit_payload::text !~* '(email|auth|storage_object_path|audio_storage|artwork_storage|signedurl|https?://|service_role|secret|private_key|access_token|refresh_token)')
);

CREATE INDEX IF NOT EXISTS battle_community_votes_battle_entry_idx
  ON public.battle_community_votes (battle_id, battle_entry_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS battle_community_votes_public_entry_idx
  ON public.battle_community_votes (battle_id, public_entry_id);

CREATE INDEX IF NOT EXISTS battle_community_votes_updated_idx
  ON public.battle_community_votes (updated_at DESC);

CREATE INDEX IF NOT EXISTS battle_community_vote_audit_battle_idx
  ON public.battle_community_vote_audit (battle_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_battle_community_votes_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  CREATE TRIGGER battle_community_votes_set_updated_at
    BEFORE UPDATE ON public.battle_community_votes
    FOR EACH ROW EXECUTE FUNCTION public.set_battle_community_votes_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.battle_community_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_community_vote_audit ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "allow_insert_own_nonparticipant_battle_community_votes" ON public.battle_community_votes
    FOR INSERT WITH CHECK (
      voter_user_id = auth.uid()::text
      AND NOT EXISTS (
        SELECT 1 FROM public.battle_entries entries
        WHERE entries.battle_id = battle_community_votes.battle_id
          AND entries.user_id = auth.uid()::text
          AND entries.status <> 'withdrawn'
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_update_own_battle_community_votes" ON public.battle_community_votes
    FOR UPDATE USING (voter_user_id = auth.uid()::text)
    WITH CHECK (voter_user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_battle_community_votes" ON public.battle_community_votes
    FOR SELECT USING (voter_user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
