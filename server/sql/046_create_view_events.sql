-- Oct 20b: "Who's watching". One row per counted view of a public profile, public battle result
-- or Beat Store listing: what was viewed, whose it is, the week and a broad source bucket
-- (Instagram, search, direct...). No IP, user agent or visitor id is stored.
-- Apply after 045. Safe to re-run. Server-only table.
CREATE TABLE IF NOT EXISTS public.view_events (
  id text PRIMARY KEY,
  kind text NOT NULL CHECK (kind IN ('profile','result','listing')),
  target_id text NOT NULL,
  owner_user_id uuid NOT NULL,
  source text NOT NULL DEFAULT 'direct',
  week_start date NOT NULL,
  viewed_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS view_events_owner_idx ON public.view_events (owner_user_id, viewed_at DESC);
ALTER TABLE public.view_events ENABLE ROW LEVEL SECURITY;
