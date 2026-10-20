-- Oct 19c: Find DJs search. Apply after 036.
-- Adds an optional city and main genre to each DJ's profile, plus a "show me in search" switch
-- (on by default). Private profiles never appear in search. Safe to re-run.
ALTER TABLE public.dj_progression_profiles
  ADD COLUMN IF NOT EXISTS display_name text,
  ADD COLUMN IF NOT EXISTS hometown text,
  ADD COLUMN IF NOT EXISTS genre text,
  ADD COLUMN IF NOT EXISTS searchable boolean NOT NULL DEFAULT true;
CREATE INDEX IF NOT EXISTS dj_progression_profiles_search_idx
  ON public.dj_progression_profiles (lower(hometown), lower(genre), belt);
