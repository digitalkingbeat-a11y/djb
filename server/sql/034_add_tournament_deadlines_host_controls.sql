-- Oct 19b: tournament round deadlines, no-show forfeits and host controls. Apply after 033.
-- Safe to run more than once. Never apply the old 028_create_tournaments.sql from the
-- tranche11-tournament-foundation branch; 032 already created these tables.
ALTER TABLE public.dj_tournaments
  ADD COLUMN IF NOT EXISTS round_hours integer NOT NULL DEFAULT 48,
  ADD COLUMN IF NOT EXISTS starts_at timestamptz,
  ADD COLUMN IF NOT EXISTS cancelled_at timestamptz;

ALTER TABLE public.dj_tournaments DROP CONSTRAINT IF EXISTS dj_tournaments_round_hours_check;
ALTER TABLE public.dj_tournaments ADD CONSTRAINT dj_tournaments_round_hours_check
  CHECK (round_hours IN (12, 24, 48, 72, 168));

-- deadline_at: when the match must be played by. forfeit_user_id: the DJ who lost by no-show
-- (or was removed by the host). Both stay server-side; the browser only sees display names.
ALTER TABLE public.dj_tournament_matches
  ADD COLUMN IF NOT EXISTS deadline_at timestamptz,
  ADD COLUMN IF NOT EXISTS forfeit_user_id text;

ALTER TABLE public.dj_tournament_matches DROP CONSTRAINT IF EXISTS dj_tournament_matches_forfeit_check;
ALTER TABLE public.dj_tournament_matches ADD CONSTRAINT dj_tournament_matches_forfeit_check
  CHECK (forfeit_user_id IS NULL OR forfeit_user_id IN (first_user_id, second_user_id));

CREATE INDEX IF NOT EXISTS dj_tournament_matches_deadline_idx
  ON public.dj_tournament_matches (deadline_at) WHERE winner_user_id IS NULL;
CREATE INDEX IF NOT EXISTS dj_tournament_seats_user_idx
  ON public.dj_tournament_seats (user_id);
CREATE INDEX IF NOT EXISTS dj_tournaments_champion_idx
  ON public.dj_tournaments (champion_user_id) WHERE champion_user_id IS NOT NULL;
