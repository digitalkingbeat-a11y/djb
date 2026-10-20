-- Oct 19c: share a crate as a public tracklist. Apply after 037.
-- Each track holds only title, artist, BPM and key. No audio, artwork, file names or links are
-- ever stored here. Anyone with the link can read an active list; the owner can stop sharing.
CREATE TABLE IF NOT EXISTS public.shared_crate_tracklists (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  crate_id text,
  name text NOT NULL CHECK (char_length(name) BETWEEN 1 AND 80),
  tracks jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(tracks) = 'array' AND jsonb_array_length(tracks) <= 200),
  owner jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS shared_crate_tracklists_owner_idx ON public.shared_crate_tracklists (user_id, created_at DESC);
ALTER TABLE public.shared_crate_tracklists ENABLE ROW LEVEL SECURITY;
