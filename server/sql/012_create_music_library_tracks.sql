-- Server-backed Music Library metadata.
-- Audio may be owned library audio or an existing owned mix submission; files are not duplicated.

-- Forward prerequisite on the already-applied 009 schema; no owner/data conversion.
-- Fail if this named constraint already exists rather than hiding schema drift.
ALTER TABLE public.mix_submissions
  ADD CONSTRAINT mix_submissions_id_user_id_key UNIQUE (id, user_id);

CREATE TABLE IF NOT EXISTS music_library_tracks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  source_type text NOT NULL DEFAULT 'track'
    CHECK (source_type IN ('track', 'mix', 'submission', 'practice_recording')),
  linked_submission_id uuid,
  title text NOT NULL,
  artist text NOT NULL,
  bpm numeric,
  key text,
  camelot_key text,
  genre text NOT NULL DEFAULT 'Unsorted',
  duration numeric,
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  rights_classification text NOT NULL DEFAULT 'unknown'
    CHECK (rights_classification IN ('original', 'licensed', 'royalty_free', 'platform_cleared', 'commercial_copyrighted', 'unknown')),
  visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'profile', 'public')),
  analysis_confidence numeric CHECK (analysis_confidence IS NULL OR (analysis_confidence >= 0 AND analysis_confidence <= 1)),
  original_filename text,
  declared_mime_type text,
  file_size bigint,
  file_hash text,
  verified_object_size bigint,
  verified_mime_type text,
  audio_upload_authorized_at timestamptz,
  audio_upload_expires_at timestamptz,
  audio_upload_verified_at timestamptz,
  audio_storage_bucket text NOT NULL DEFAULT 'battle-mixes',
  audio_storage_object_path text CHECK (
    audio_storage_object_path IS NULL
    OR (
      audio_storage_object_path !~* '^(https?|data|file):'
      AND audio_storage_object_path !~ '\\.\\.'
      AND audio_storage_object_path ~ '^private/(library-audio|battle-entries)/'
    )
  ),
  artwork_storage_bucket text,
  artwork_storage_object_path text CHECK (
    artwork_storage_object_path IS NULL
    OR (
      artwork_storage_object_path !~* '^(https?|data|file):'
      AND artwork_storage_object_path !~ '\\.\\.'
      AND artwork_storage_object_path ~ '^private/library-artwork/'
    )
  ),
  artwork_metadata jsonb,
  pending_artwork_metadata jsonb,
  usage_relationships jsonb NOT NULL DEFAULT '{
    "playlists": [],
    "battles": [],
    "posts": [],
    "practiceHistory": [],
    "submissions": []
  }'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (id, user_id),
  UNIQUE (user_id, file_hash),
  UNIQUE (user_id, linked_submission_id),
  UNIQUE (user_id, audio_storage_object_path),
  -- One same-owner FK replaces both original submission FKs. PostgreSQL 15+:
  -- unlink a deleted submission without nulling the track's non-null owner.
  FOREIGN KEY (linked_submission_id, user_id) REFERENCES public.mix_submissions(id, user_id)
    ON DELETE SET NULL (linked_submission_id)
);

ALTER TABLE music_library_tracks ENABLE ROW LEVEL SECURITY;

CREATE POLICY allow_select_own_music_library_tracks
  ON music_library_tracks FOR SELECT
  USING (auth.uid()::text = user_id);

CREATE POLICY allow_insert_own_music_library_tracks
  ON music_library_tracks FOR INSERT
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY allow_update_own_music_library_tracks
  ON music_library_tracks FOR UPDATE
  USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

CREATE POLICY allow_delete_own_music_library_tracks
  ON music_library_tracks FOR DELETE
  USING (auth.uid()::text = user_id);

CREATE INDEX IF NOT EXISTS music_library_tracks_user_updated_idx
  ON music_library_tracks (user_id, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS music_library_tracks_user_source_idx
  ON music_library_tracks (user_id, source_type)
  WHERE archived_at IS NULL;
