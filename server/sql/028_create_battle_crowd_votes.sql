-- Crowd voting: one winner pick per listener per finished battle.
-- Apply in the Supabase SQL editor after 027.
CREATE TABLE IF NOT EXISTS public.battle_crowd_votes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id text NOT NULL REFERENCES public.battle_records(id) ON DELETE CASCADE,
  voter_user_id text NOT NULL,
  picked_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (battle_id, voter_user_id),
  CHECK (voter_user_id <> picked_user_id)
);

CREATE INDEX IF NOT EXISTS battle_crowd_votes_battle_idx ON public.battle_crowd_votes (battle_id);

ALTER TABLE public.battle_crowd_votes ENABLE ROW LEVEL SECURITY;

-- Writes go through the server (service role), which checks the battle is finished and the voter is not a participant.
DO $$
BEGIN
  CREATE POLICY "allow_select_own_battle_crowd_votes" ON public.battle_crowd_votes
    FOR SELECT USING (voter_user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
