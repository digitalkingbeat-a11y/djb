-- Oct 27: a DJ's website link and booking info, shown on their public profile. Apply after 054.
-- The server checks both values before saving; the length limits here are a backstop. Safe to re-run.
ALTER TABLE public.dj_progression_profiles
  ADD COLUMN IF NOT EXISTS website_url text,
  ADD COLUMN IF NOT EXISTS booking_info text;
ALTER TABLE public.dj_progression_profiles DROP CONSTRAINT IF EXISTS dj_progression_profiles_website_url_check;
ALTER TABLE public.dj_progression_profiles
  ADD CONSTRAINT dj_progression_profiles_website_url_check
  CHECK (website_url IS NULL OR (char_length(website_url) <= 200 AND website_url ~* '^https?://'));
ALTER TABLE public.dj_progression_profiles DROP CONSTRAINT IF EXISTS dj_progression_profiles_booking_info_check;
ALTER TABLE public.dj_progression_profiles
  ADD CONSTRAINT dj_progression_profiles_booking_info_check
  CHECK (booking_info IS NULL OR char_length(booking_info) <= 120);
