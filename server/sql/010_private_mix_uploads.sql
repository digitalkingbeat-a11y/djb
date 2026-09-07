-- Private storage configuration for server-issued signed mix uploads.
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('battle-mixes', 'battle-mixes', false, 104857600, ARRAY['audio/mpeg','audio/wav','audio/x-wav','audio/webm'])
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

ALTER TABLE public.mix_submissions ADD COLUMN IF NOT EXISTS upload_authorized_at timestamptz;
ALTER TABLE public.mix_submissions ADD COLUMN IF NOT EXISTS upload_expires_at timestamptz;
ALTER TABLE public.mix_submissions ADD COLUMN IF NOT EXISTS verified_object_size bigint;
ALTER TABLE public.mix_submissions ADD COLUMN IF NOT EXISTS verified_mime_type text;
ALTER TABLE public.mix_submissions ADD COLUMN IF NOT EXISTS upload_verified_at timestamptz;

-- No storage.objects policies are granted to authenticated users. Uploads require a server-issued signed upload URL.