-- Oct 19c: weekly practice goals. Apply after 038.
-- One row per DJ: how many practice sessions they want each week (0 = goal off). Progress is
-- counted from the practice log (practice_sessions, 030), so the goal follows you to every device.
CREATE TABLE IF NOT EXISTS public.practice_goals (
  user_id text PRIMARY KEY,
  sessions_per_week integer NOT NULL DEFAULT 3 CHECK (sessions_per_week BETWEEN 0 AND 21),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.practice_goals ENABLE ROW LEVEL SECURITY;
