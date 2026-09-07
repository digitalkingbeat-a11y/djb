-- 002_create_battle_rankings.sql
-- Creates battle_rankings table which should be maintained by a trusted server process

CREATE TABLE IF NOT EXISTS public.battle_rankings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dj text NOT NULL,
  genre text,
  wins int DEFAULT 0,
  losses int DEFAULT 0,
  ai_avg numeric(5,2),
  community_score numeric(7,2),
  rating numeric(7,2),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.battle_rankings ENABLE ROW LEVEL SECURITY;

-- Allow public read access to the rankings
CREATE POLICY "allow_select_public" ON public.battle_rankings
  FOR SELECT USING (true);

-- Inserts/updates/deletes should be done by a trusted server using the Supabase service role
-- This policy permits operations from the service_role (server-side). Server must use service key to bypass RLS.
CREATE POLICY "allow_service_role" ON public.battle_rankings
  FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

CREATE INDEX IF NOT EXISTS battle_rankings_rating_idx ON public.battle_rankings(rating DESC NULLS LAST);
