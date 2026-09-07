-- Server-backed Music Library organization.
-- Crates store metadata and ordered references to existing owned library tracks.
-- No audio, artwork binaries, private storage paths, signed URLs or credentials are stored here.

ALTER TABLE music_library_tracks
  ADD COLUMN IF NOT EXISTS practice_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS analysis_summary jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS music_library_crates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  artwork_metadata jsonb,
  visibility text NOT NULL DEFAULT 'private'
    CHECK (visibility IN ('private', 'profile', 'public')),
  type text NOT NULL DEFAULT 'crate'
    CHECK (type IN ('crate', 'playlist', 'battle_prep', 'smart_crate', 'folder')),
  parent_folder_id uuid REFERENCES music_library_crates(id) ON DELETE SET NULL,
  smart_rules jsonb,
  allow_duplicates boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz
);

CREATE TABLE IF NOT EXISTS music_library_crate_memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  crate_id uuid NOT NULL REFERENCES music_library_crates(id) ON DELETE CASCADE,
  track_id uuid NOT NULL REFERENCES music_library_tracks(id) ON DELETE CASCADE,
  position integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  FOREIGN KEY (track_id, user_id) REFERENCES music_library_tracks(id, user_id) ON DELETE CASCADE
);

ALTER TABLE music_library_crates ENABLE ROW LEVEL SECURITY;
ALTER TABLE music_library_crate_memberships ENABLE ROW LEVEL SECURITY;

CREATE POLICY allow_select_own_music_library_crates
  ON music_library_crates FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY allow_insert_own_music_library_crates
  ON music_library_crates FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY allow_update_own_music_library_crates
  ON music_library_crates FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY allow_delete_own_music_library_crates
  ON music_library_crates FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY allow_select_own_music_library_crate_memberships
  ON music_library_crate_memberships FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY allow_insert_own_music_library_crate_memberships
  ON music_library_crate_memberships FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY allow_update_own_music_library_crate_memberships
  ON music_library_crate_memberships FOR UPDATE
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY allow_delete_own_music_library_crate_memberships
  ON music_library_crate_memberships FOR DELETE
  USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS music_library_crates_user_type_idx
  ON music_library_crates (user_id, type, updated_at DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS music_library_crate_memberships_order_idx
  ON music_library_crate_memberships (user_id, crate_id, position)
  WHERE archived_at IS NULL;

