-- Oct 29: Instagram / SoundCloud / Mixcloud / TikTok links on DJ profiles, and the
-- "I own or have the rights to this music" tick on library tracks. Apply after 055. Safe to re-run.
ALTER TABLE public.dj_progression_profiles
  ADD COLUMN IF NOT EXISTS instagram_url text,
  ADD COLUMN IF NOT EXISTS soundcloud_url text,
  ADD COLUMN IF NOT EXISTS mixcloud_url text,
  ADD COLUMN IF NOT EXISTS tiktok_url text;
ALTER TABLE public.dj_progression_profiles DROP CONSTRAINT IF EXISTS dj_progression_profiles_instagram_url_check;
ALTER TABLE public.dj_progression_profiles ADD CONSTRAINT dj_progression_profiles_instagram_url_check
  CHECK (instagram_url IS NULL OR (char_length(instagram_url) <= 200 AND instagram_url ~* '^https://(www\.)?instagram\.com/'));
ALTER TABLE public.dj_progression_profiles DROP CONSTRAINT IF EXISTS dj_progression_profiles_soundcloud_url_check;
ALTER TABLE public.dj_progression_profiles ADD CONSTRAINT dj_progression_profiles_soundcloud_url_check
  CHECK (soundcloud_url IS NULL OR (char_length(soundcloud_url) <= 200 AND soundcloud_url ~* '^https://((www|m|on)\.)?soundcloud\.com/'));
ALTER TABLE public.dj_progression_profiles DROP CONSTRAINT IF EXISTS dj_progression_profiles_mixcloud_url_check;
ALTER TABLE public.dj_progression_profiles ADD CONSTRAINT dj_progression_profiles_mixcloud_url_check
  CHECK (mixcloud_url IS NULL OR (char_length(mixcloud_url) <= 200 AND mixcloud_url ~* '^https://((www|m)\.)?mixcloud\.com/'));
ALTER TABLE public.dj_progression_profiles DROP CONSTRAINT IF EXISTS dj_progression_profiles_tiktok_url_check;
ALTER TABLE public.dj_progression_profiles ADD CONSTRAINT dj_progression_profiles_tiktok_url_check
  CHECK (tiktok_url IS NULL OR (char_length(tiktok_url) <= 200 AND tiktok_url ~* '^https://((www|m|vm)\.)?tiktok\.com/'));

ALTER TABLE public.music_library_tracks
  ADD COLUMN IF NOT EXISTS rights_confirmed boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS rights_confirmed_at timestamptz;
