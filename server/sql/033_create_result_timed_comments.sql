-- Oct 19: comments pinned to a moment of a public battle result's mix. Apply after 032.
-- Read through the server only (it checks the result is still public); service role only.
CREATE TABLE IF NOT EXISTS public.result_timed_comments (
  id text PRIMARY KEY,
  verified_result_id text NOT NULL,
  user_id text NOT NULL,
  at_seconds numeric(8,1) NOT NULL CHECK (at_seconds >= 0 AND at_seconds <= 14400),
  body text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 500),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  edited_at timestamptz
);

CREATE INDEX IF NOT EXISTS result_timed_comments_result_idx
  ON public.result_timed_comments (verified_result_id, at_seconds);

ALTER TABLE public.result_timed_comments ENABLE ROW LEVEL SECURITY;
