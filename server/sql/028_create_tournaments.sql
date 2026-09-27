-- Tranche 11 foundation. Apply after 027. Tournament rows contain no private media.
-- Seat claims and bracket creation share one transaction under the parent row lock.
CREATE TABLE IF NOT EXISTS public.dj_tournaments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by text NOT NULL,
  title text NOT NULL CHECK (char_length(title) BETWEEN 1 AND 160),
  genre text NOT NULL,
  mode_id text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'active', 'completed', 'cancelled')),
  capacity integer NOT NULL DEFAULT 8 CHECK (capacity = 8),
  champion_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  started_at timestamptz,
  completed_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.dj_tournament_seats (
  tournament_id uuid NOT NULL REFERENCES public.dj_tournaments(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  seat_number integer NOT NULL CHECK (seat_number BETWEEN 1 AND 8),
  joined_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tournament_id, seat_number),
  UNIQUE (tournament_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.dj_tournament_matches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id uuid NOT NULL REFERENCES public.dj_tournaments(id) ON DELETE CASCADE,
  round_number integer NOT NULL CHECK (round_number BETWEEN 1 AND 3),
  position integer NOT NULL CHECK (position BETWEEN 1 AND 4),
  first_user_id text,
  second_user_id text,
  winner_user_id text,
  battle_id text UNIQUE REFERENCES public.battle_records(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'active', 'completed', 'void')),
  UNIQUE (tournament_id, round_number, position),
  CHECK (winner_user_id IS NULL OR winner_user_id IN (first_user_id, second_user_id)),
  CHECK (first_user_id IS NULL OR second_user_id IS NULL OR first_user_id <> second_user_id),
  CHECK ((round_number <> 2 OR position <= 2) AND (round_number <> 3 OR position = 1))
);

CREATE INDEX IF NOT EXISTS dj_tournaments_status_idx ON public.dj_tournaments(status, created_at DESC);
CREATE INDEX IF NOT EXISTS dj_tournament_matches_battle_idx ON public.dj_tournament_matches(battle_id) WHERE battle_id IS NOT NULL;

ALTER TABLE public.dj_tournaments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dj_tournament_seats ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dj_tournament_matches ENABLE ROW LEVEL SECURITY;

-- No browser-facing policies: these rows contain auth user IDs. Server routes
-- must return sanitized public profiles and use the service role for reads.

CREATE OR REPLACE FUNCTION public.claim_tournament_seat(p_tournament_id uuid, p_user_id text)
RETURNS integer LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  tournament_row public.dj_tournaments;
  existing_seat integer;
  next_seat integer;
  match_position integer;
BEGIN
  IF p_user_id IS NULL OR btrim(p_user_id) = '' THEN
    RAISE EXCEPTION 'Authenticated user required';
  END IF;
  SELECT * INTO tournament_row FROM public.dj_tournaments
    WHERE id = p_tournament_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Tournament not found'; END IF;

  SELECT seat_number INTO existing_seat FROM public.dj_tournament_seats
    WHERE tournament_id = p_tournament_id AND user_id = p_user_id;
  IF existing_seat IS NOT NULL THEN RETURN existing_seat; END IF;
  IF tournament_row.status <> 'open' THEN RAISE EXCEPTION 'Tournament is closed'; END IF;

  SELECT count(*) + 1 INTO next_seat FROM public.dj_tournament_seats
    WHERE tournament_id = p_tournament_id;
  IF next_seat > 8 THEN RAISE EXCEPTION 'Tournament is full'; END IF;
  INSERT INTO public.dj_tournament_seats(tournament_id, user_id, seat_number)
    VALUES (p_tournament_id, p_user_id, next_seat);

  IF next_seat = 8 THEN
    FOR match_position IN 1..4 LOOP
      INSERT INTO public.dj_tournament_matches
        (tournament_id, round_number, position, first_user_id, second_user_id, status)
      SELECT p_tournament_id, 1, match_position,
        max(user_id) FILTER (WHERE seat_number = match_position * 2 - 1),
        max(user_id) FILTER (WHERE seat_number = match_position * 2), 'ready'
      FROM public.dj_tournament_seats WHERE tournament_id = p_tournament_id;
    END LOOP;
    INSERT INTO public.dj_tournament_matches(tournament_id, round_number, position)
      VALUES (p_tournament_id, 2, 1), (p_tournament_id, 2, 2), (p_tournament_id, 3, 1);
    UPDATE public.dj_tournaments SET status = 'active', started_at = now()
      WHERE id = p_tournament_id;
  END IF;
  RETURN next_seat;
END;
$$;

-- The service role alone invokes this function after verifying the bearer token.
REVOKE ALL ON FUNCTION public.claim_tournament_seat(uuid, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.claim_tournament_seat(uuid, text) TO service_role;
