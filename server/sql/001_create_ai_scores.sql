-- 001_create_ai_scores.sql
-- Creates ai_scores table with RLS and basic policies

-- Ensure pgcrypto for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE IF NOT EXISTS public.ai_scores (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  dj text NOT NULL,
  battle_type text NOT NULL DEFAULT 'Practice',
  genre text NOT NULL DEFAULT 'Global',
  score int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Enable Row Level Security
ALTER TABLE public.ai_scores ENABLE ROW LEVEL SECURITY;

-- Allow authenticated users to INSERT only for their own user_id
CREATE POLICY "allow_insert_own" ON public.ai_scores
  FOR INSERT
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() = user_id);

-- Allow public SELECT for leaderboard queries
CREATE POLICY "allow_select_public" ON public.ai_scores
  FOR SELECT USING (true);

-- Indexes to improve leaderboard queries
CREATE INDEX IF NOT EXISTS ai_scores_user_idx ON public.ai_scores(user_id);
CREATE INDEX IF NOT EXISTS ai_scores_bt_genre_idx ON public.ai_scores(battle_type, genre);
