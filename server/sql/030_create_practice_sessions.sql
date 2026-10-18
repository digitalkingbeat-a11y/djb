-- Practice log: every practice session a DJ saves, kept on their account so it follows them
-- to any device. Apply in the Supabase SQL editor after 029.
CREATE TABLE IF NOT EXISTS public.practice_sessions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  client_session_id text NOT NULL,
  title text NOT NULL DEFAULT 'Practice session',
  session_type text NOT NULL DEFAULT 'Practice',
  genre text NOT NULL DEFAULT 'Global',
  source text NOT NULL DEFAULT 'practice'
    CHECK (source IN ('practice', 'battle')),
  score numeric CHECK (score IS NULL OR (score >= 0 AND score <= 1000)),
  max_score numeric CHECK (max_score IS NULL OR (max_score > 0 AND max_score <= 1000)),
  breakdown jsonb NOT NULL DEFAULT '[]'::jsonb,
  recording_track_id text,
  recorded_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, client_session_id),
  CHECK (breakdown::text !~* '(email|auth|storage|signedurl|service_role|secret|private/)')
);

CREATE INDEX IF NOT EXISTS practice_sessions_owner_recent_idx
  ON public.practice_sessions (user_id, recorded_at DESC);

ALTER TABLE public.practice_sessions ENABLE ROW LEVEL SECURITY;

-- Writes go through the server (service role). Owners may read their own rows.
DO $$
BEGIN
  CREATE POLICY "allow_select_own_practice_sessions" ON public.practice_sessions
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
