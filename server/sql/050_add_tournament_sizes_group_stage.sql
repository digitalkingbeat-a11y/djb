-- Oct 25 Store: 4- and 32-DJ tournaments, plus a "group stage" format
-- (round-robin groups; the top two of each group go into a knockout bracket).
-- Apply after 049. Safe to re-run. Do NOT apply the old tranche11 028_create_tournaments.sql.
ALTER TABLE public.dj_tournaments
  ADD COLUMN IF NOT EXISTS format text NOT NULL DEFAULT 'knockout',
  ADD COLUMN IF NOT EXISTS group_count integer;
ALTER TABLE public.dj_tournaments
  DROP CONSTRAINT IF EXISTS dj_tournaments_capacity_check,
  ADD CONSTRAINT dj_tournaments_capacity_check CHECK (capacity IN (4, 8, 16, 32)),
  DROP CONSTRAINT IF EXISTS dj_tournaments_format_check,
  ADD CONSTRAINT dj_tournaments_format_check CHECK (format IN ('knockout', 'groups')),
  DROP CONSTRAINT IF EXISTS dj_tournaments_group_count_check,
  ADD CONSTRAINT dj_tournaments_group_count_check CHECK (group_count IS NULL OR group_count BETWEEN 1 AND 8);

ALTER TABLE public.dj_tournament_seats
  DROP CONSTRAINT IF EXISTS dj_tournament_seats_seat_number_check,
  ADD CONSTRAINT dj_tournament_seats_seat_number_check CHECK (seat_number BETWEEN 1 AND 32),
  DROP CONSTRAINT IF EXISTS dj_tournament_seats_seed_check,
  ADD CONSTRAINT dj_tournament_seats_seed_check CHECK (seed IS NULL OR seed BETWEEN 1 AND 32);

-- Group matches use round 0; knockout rounds are 1..5 (a 32-DJ bracket has 5 rounds).
ALTER TABLE public.dj_tournament_matches
  ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'knockout',
  ADD COLUMN IF NOT EXISTS group_number integer;
ALTER TABLE public.dj_tournament_matches
  DROP CONSTRAINT IF EXISTS dj_tournament_matches_round_number_check,
  ADD CONSTRAINT dj_tournament_matches_round_number_check CHECK (round_number BETWEEN 0 AND 5),
  DROP CONSTRAINT IF EXISTS dj_tournament_matches_position_check,
  ADD CONSTRAINT dj_tournament_matches_position_check CHECK (position BETWEEN 1 AND 64),
  DROP CONSTRAINT IF EXISTS dj_tournament_matches_stage_check,
  ADD CONSTRAINT dj_tournament_matches_stage_check CHECK (stage IN ('knockout', 'group')),
  DROP CONSTRAINT IF EXISTS dj_tournament_matches_group_check,
  ADD CONSTRAINT dj_tournament_matches_group_check CHECK ((stage = 'group' AND round_number = 0 AND group_number BETWEEN 1 AND 8) OR (stage = 'knockout' AND round_number >= 1 AND group_number IS NULL));
