-- Oct 20b: Crews (up to 4 DJs, name + logo, crew rankings) and 2-vs-2 crew battles.
-- Apply after 042. Safe to re-run. Server-only tables (row level security on, no public policies).
CREATE TABLE IF NOT EXISTS public.crews (
  id text PRIMARY KEY,
  name text NOT NULL CHECK (char_length(name) BETWEEN 2 AND 40),
  logo_emoji text NOT NULL DEFAULT '🎧',
  logo_color text NOT NULL DEFAULT '#ff4d6d',
  logo_url text CHECK (logo_url IS NULL OR logo_url LIKE 'https://%'),
  owner_user_id uuid NOT NULL,
  invite_code text NOT NULL,
  wins integer NOT NULL DEFAULT 0,
  losses integer NOT NULL DEFAULT 0,
  draws integer NOT NULL DEFAULT 0,
  points integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS crews_name_unique ON public.crews (lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS crews_invite_code_unique ON public.crews (invite_code);
CREATE INDEX IF NOT EXISTS crews_rank_idx ON public.crews (points DESC, wins DESC);
ALTER TABLE public.crews ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crew_members (
  crew_id text NOT NULL REFERENCES public.crews(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner','member')),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (crew_id, user_id)
);
-- One crew per DJ.
CREATE UNIQUE INDEX IF NOT EXISTS crew_members_one_crew ON public.crew_members (user_id);
ALTER TABLE public.crew_members ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.crew_battles (
  id text PRIMARY KEY,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','live','complete','declined')),
  challenger_crew_id text NOT NULL REFERENCES public.crews(id) ON DELETE CASCADE,
  opponent_crew_id text NOT NULL REFERENCES public.crews(id) ON DELETE CASCADE,
  challenger_lineup jsonb NOT NULL DEFAULT '[]'::jsonb,
  opponent_lineup jsonb NOT NULL DEFAULT '[]'::jsonb,
  scores jsonb NOT NULL DEFAULT '{}'::jsonb,
  submissions jsonb NOT NULL DEFAULT '{}'::jsonb,
  challenger_total numeric,
  opponent_total numeric,
  winner_crew_id text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);
CREATE INDEX IF NOT EXISTS crew_battles_challenger_idx ON public.crew_battles (challenger_crew_id);
CREATE INDEX IF NOT EXISTS crew_battles_opponent_idx ON public.crew_battles (opponent_crew_id);
ALTER TABLE public.crew_battles ENABLE ROW LEVEL SECURITY;
