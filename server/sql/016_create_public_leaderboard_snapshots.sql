-- Authoritative public leaderboard snapshots from the progression award ledger.
-- Additive/local-review migration only. Do not apply remotely without review.
-- Stores sanitized ranking display data only. Bitcoin reward metadata remains
-- untransferred metadata and this migration does not create wallet custody,
-- deposits, payouts, transfers, balances or claim records.

ALTER TABLE public.dj_progression_profiles
  ADD COLUMN IF NOT EXISTS public_profile jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS public_profile_id text,
  ADD COLUMN IF NOT EXISTS visibility text NOT NULL DEFAULT 'public'
    CHECK (visibility IN ('public', 'private'));

DO $$
BEGIN
  ALTER TABLE public.dj_progression_profiles
    ADD CONSTRAINT dj_progression_profiles_public_profile_redaction_check
      CHECK (public_profile::text !~* '(email|auth|user_id|storage|signedurl|service_role|supabase_service|secret|private_key|xprv|private/)');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS dj_progression_profiles_public_profile_idx
  ON public.dj_progression_profiles (public_profile_id)
  WHERE public_profile_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS dj_progression_profiles_visibility_ranking_idx
  ON public.dj_progression_profiles (visibility, rating DESC, wins DESC, xp DESC, updated_at ASC);

CREATE TABLE IF NOT EXISTS public.public_leaderboard_snapshots (
  id text PRIMARY KEY,
  category text NOT NULL
    CHECK (category IN ('competitive_battles', 'country_rankings', 'transition_battles', 'scratching_battles', 'mix_battles', 'bitcoin_battles', 'belt_rankings', 'ai_only_high_scores')),
  country text,
  belt text,
  rank integer NOT NULL CHECK (rank > 0),
  previous_rank integer CHECK (previous_rank IS NULL OR previous_rank > 0),
  movement integer,
  public_profile_id text,
  display_name text NOT NULL,
  rating numeric NOT NULL CHECK (rating >= 0),
  eligible_wins integer NOT NULL DEFAULT 0 CHECK (eligible_wins >= 0),
  eligible_losses integer NOT NULL DEFAULT 0 CHECK (eligible_losses >= 0),
  eligible_ties integer NOT NULL DEFAULT 0 CHECK (eligible_ties >= 0),
  qualifying_battles integer NOT NULL DEFAULT 0 CHECK (qualifying_battles >= 0),
  average_score numeric NOT NULL DEFAULT 0 CHECK (average_score >= 0 AND average_score <= 100),
  best_score numeric NOT NULL DEFAULT 0 CHECK (best_score >= 0 AND best_score <= 100),
  last_qualifying_activity timestamptz,
  calculation_version text NOT NULL,
  status text NOT NULL DEFAULT 'published'
    CHECK (status IN ('building', 'published', 'retryable')),
  sanitized_error text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (category, public_profile_id, calculation_version),
  CHECK (display_name !~* '(email|auth|user_id|storage|signedurl|service_role|supabase_service|secret|private_key|xprv|private/)'),
  CHECK (sanitized_error IS NULL OR sanitized_error !~* '(email|auth|user_id|storage|signedurl|service_role|supabase_service|secret|private_key|xprv|private/)'),
  CHECK (public_profile_id IS NULL OR public_profile_id ~ '^dj_[A-Za-z0-9_-]+$')
);

CREATE INDEX IF NOT EXISTS public_leaderboard_snapshots_category_rank_idx
  ON public.public_leaderboard_snapshots (category, rank ASC, published_at DESC);

CREATE INDEX IF NOT EXISTS public_leaderboard_snapshots_country_rank_idx
  ON public.public_leaderboard_snapshots (category, country, rank ASC)
  WHERE country IS NOT NULL;

CREATE INDEX IF NOT EXISTS public_leaderboard_snapshots_belt_rank_idx
  ON public.public_leaderboard_snapshots (category, belt, rank ASC)
  WHERE belt IS NOT NULL;

CREATE INDEX IF NOT EXISTS public_leaderboard_snapshots_version_status_idx
  ON public.public_leaderboard_snapshots (calculation_version, status, published_at DESC);

CREATE INDEX IF NOT EXISTS public_leaderboard_snapshots_public_profile_idx
  ON public.public_leaderboard_snapshots (public_profile_id, calculation_version)
  WHERE public_profile_id IS NOT NULL;

ALTER TABLE public.public_leaderboard_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "allow_select_published_public_leaderboards" ON public.public_leaderboard_snapshots
    FOR SELECT USING (status = 'published');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_progression_public_fields" ON public.dj_progression_profiles
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
