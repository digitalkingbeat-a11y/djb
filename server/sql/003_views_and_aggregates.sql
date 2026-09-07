-- 003_views_and_aggregates.sql
-- Aggregated views for leaderboards and helper functions

-- Aggregated AI leaderboard view (best, average, attempts, last)
CREATE OR REPLACE VIEW public.ai_leaderboard AS
SELECT
  user_id,
  dj,
  MAX(score) AS best,
  ROUND(AVG(score)::numeric,1) AS average,
  COUNT(*) AS attempts,
  (array_agg(score ORDER BY created_at DESC))[1] AS last
FROM public.ai_scores
GROUP BY user_id, dj
ORDER BY best DESC, average DESC;

GRANT SELECT ON public.ai_leaderboard TO public;

-- Public-facing battle rankings view (mirror of battle_rankings)
CREATE OR REPLACE VIEW public.battle_rankings_public AS
SELECT
  id,
  user_id,
  dj,
  genre,
  wins,
  losses,
  ai_avg,
  community_score,
  rating,
  updated_at
FROM public.battle_rankings
ORDER BY rating DESC NULLS LAST;

GRANT SELECT ON public.battle_rankings_public TO public;
