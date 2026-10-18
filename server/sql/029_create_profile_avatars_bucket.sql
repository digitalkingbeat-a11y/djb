-- Profile photos (avatars).
-- Public-read bucket so other DJs can see your photo on posts, rankings and battle rooms.
-- Uploads only happen through server-issued signed upload URLs (POST /api/profile/avatarUploadAuthorization);
-- the server verifies type and size before saving the URL to the user's metadata (avatar_url).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('profile-avatars', 'profile-avatars', true, 524288, ARRAY['image/jpeg','image/png','image/webp'])
ON CONFLICT (id) DO UPDATE
  SET public = true,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;
