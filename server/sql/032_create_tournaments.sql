-- Oct 19: 8- or 16-DJ single-elimination tournaments. Apply after 031.
-- Builds on the tranche11-tournament-foundation draft (which was numbered 028 and never merged).
-- Every match links to a normal battle_records row; winners advance when that battle resolves.
-- Rows hold auth user ids, so there are no browser-facing policies (service role only).
CREATE TABLE IF NOT EXISTS public.dj_tournaments (
  id text PRIMARY KEY,
  created_by text NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '',
  genre text NOT NULL,
  mode_id text NOT NULL,
  capacity integer NOT NULL DEFAULT 8 CHECK (capacity IN (8, 16)),
  seeding text NOT NULL DEFAULT 'random' CHECK (seeding IN ('random', 'signup')),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'active', 'completed', 'cancelled')),
  champion_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.dj_tournament_seats (
  tournament_id text NOT NULL REFERENCES public.dj_tournaments(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  seat_number integer NOT NULL CHECK (seat_number BETWEEN 1 AND 16),
  seed integer CHECK (seed BETWEEN 1 AND 16),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, seat_number),
  UNIQUE (tournament_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.dj_tournament_matches (
  id text PRIMARY KEY,
  tournament_id text NOT NULL REFERENCES public.dj_tournaments(id) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number BETWEEN 1 AND 4),
  position integer NOT NULL CHECK (position BETWEEN 1 AND 8),
  first_user_id text,
  second_user_id text,
  winner_user_id text,
  battle_id text UNIQUE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'active', 'completed', 'bye', 'void')),
  UNIQUE (tournament_id, round_number, position),
  CHECK (winner_user_id IS NULL OR winner_user_id IN (first_user_id, second_user_id)),
  CHECK (first_user_id IS NULL OR second_user_id IS NULL OR first_user_id <> second_user_id)
);

CREATE INDEX IF NOT EXISTS dj_tournaments_status_idx ON public.dj_tournaments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS dj_tournament_matches_battle_idx ON public.dj_tournament_matches(battle_id) WHERE battle_id IS NOT NULL;

ALTER TABLE public.dj_tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dj_tournament_seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dj_tournament_matches ENABLE ROW LEVEL SECURITY;
