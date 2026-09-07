-- Durable progression and rankings award ledger.
-- Additive/local-review migration only. Do not apply remotely without review.
-- Stores progression/ranking evidence only; Bitcoin reward metadata remains
-- separate and this migration does not create wallet custody, deposits, payouts,
-- transfer, balance or claim records.

CREATE TABLE IF NOT EXISTS public.dj_progression_profiles (
  user_id text PRIMARY KEY,
  xp integer NOT NULL DEFAULT 0 CHECK (xp >= 0),
  rating numeric NOT NULL DEFAULT 1500 CHECK (rating >= 0),
  ranking_rating numeric NOT NULL DEFAULT 1500 CHECK (ranking_rating >= 0),
  belt text NOT NULL DEFAULT 'White',
  wins integer NOT NULL DEFAULT 0 CHECK (wins >= 0),
  losses integer NOT NULL DEFAULT 0 CHECK (losses >= 0),
  ties integer NOT NULL DEFAULT 0 CHECK (ties >= 0),
  voids integer NOT NULL DEFAULT 0 CHECK (voids >= 0),
  completed_battles integer NOT NULL DEFAULT 0 CHECK (completed_battles >= 0),
  country text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.battle_progression_awards (
  id text PRIMARY KEY,
  battle_id text NOT NULL REFERENCES public.battle_records(id) ON DELETE RESTRICT,
  resolution_id text NOT NULL,
  resolution_version integer NOT NULL CHECK (resolution_version >= 0),
  battle_entry_id uuid NOT NULL,
  user_id text NOT NULL,
  submission_id uuid NOT NULL,
  outcome text NOT NULL CHECK (outcome IN ('winner', 'loser', 'tie', 'withdrawn', 'void', 'failed', 'recorded')),
  score numeric NOT NULL CHECK (score >= 0 AND score <= 100),
  xp_delta integer NOT NULL DEFAULT 0,
  xp_before integer NOT NULL DEFAULT 0 CHECK (xp_before >= 0),
  xp_after integer NOT NULL DEFAULT 0 CHECK (xp_after >= 0),
  rating_before numeric NOT NULL CHECK (rating_before >= 0),
  rating_delta numeric NOT NULL DEFAULT 0,
  rating_after numeric NOT NULL CHECK (rating_after >= 0),
  belt_before text NOT NULL,
  belt_after text NOT NULL,
  global_rank_before integer,
  global_rank_after integer,
  country_rank_before integer,
  country_rank_after integer,
  country text,
  categories jsonb NOT NULL DEFAULT '[]'::jsonb,
  award_reason text NOT NULL,
  rule_version text NOT NULL,
  rating_rule_version text NOT NULL,
  belt_rule_version text NOT NULL,
  status text NOT NULL DEFAULT 'applying'
    CHECK (status IN ('applying', 'applied', 'retryable')),
  sanitized_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  applied_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (resolution_id, user_id),
  UNIQUE (battle_id, user_id),
  UNIQUE (battle_entry_id, resolution_id),
  CHECK (award_reason::text !~* '(service_role|secret|private_key|xprv|storage_object_path|signedurl|private/)'),
  CHECK (sanitized_error IS NULL OR sanitized_error !~* '(service_role|secret|private_key|xprv|storage_object_path|signedurl|private/)')
);

CREATE TABLE IF NOT EXISTS public.battle_ranking_snapshots (
  id text PRIMARY KEY,
  award_id text NOT NULL REFERENCES public.battle_progression_awards(id) ON DELETE RESTRICT,
  battle_id text NOT NULL,
  resolution_id text NOT NULL,
  user_id text NOT NULL,
  category text NOT NULL
    CHECK (category IN ('competitive_battles', 'transition_battles', 'scratching_battles', 'mix_battles', 'bitcoin_battles', 'ai_only_high_scores')),
  country text,
  rating numeric NOT NULL CHECK (rating >= 0),
  score numeric NOT NULL CHECK (score >= 0 AND score <= 100),
  outcome text NOT NULL,
  global_rank integer,
  country_rank integer,
  rule_version text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (award_id, category),
  UNIQUE (resolution_id, user_id, category)
);

CREATE INDEX IF NOT EXISTS battle_progression_awards_user_idx
  ON public.battle_progression_awards (user_id, applied_at DESC);

CREATE INDEX IF NOT EXISTS battle_progression_awards_resolution_idx
  ON public.battle_progression_awards (resolution_id, status);

CREATE INDEX IF NOT EXISTS battle_progression_awards_retryable_idx
  ON public.battle_progression_awards (status, updated_at)
  WHERE status = 'retryable';

CREATE INDEX IF NOT EXISTS dj_progression_profiles_ranking_idx
  ON public.dj_progression_profiles (rating DESC, wins DESC, xp DESC, updated_at ASC);

CREATE INDEX IF NOT EXISTS dj_progression_profiles_country_ranking_idx
  ON public.dj_progression_profiles (country, rating DESC, wins DESC, xp DESC, updated_at ASC);

CREATE INDEX IF NOT EXISTS battle_ranking_snapshots_category_idx
  ON public.battle_ranking_snapshots (category, country, rating DESC, created_at DESC);

ALTER TABLE public.dj_progression_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_progression_awards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.battle_ranking_snapshots ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_progression_profile" ON public.dj_progression_profiles
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_progression_awards" ON public.battle_progression_awards
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_public_ranking_snapshots" ON public.battle_ranking_snapshots
    FOR SELECT USING (true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
