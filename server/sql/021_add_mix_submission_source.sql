-- Adds a persisted submission source to mix_submissions so Battle Studio recordings
-- and externally uploaded mixes can be distinguished without a second submission model.
--
-- Legacy-row handling: rows created before this migration cannot be retroactively
-- distinguished, because both submission paths previously shared the identical upload
-- code path with no source marker. Existing rows are defaulted to 'uploaded_mix' by the
-- column default below. New inserts must supply an explicit valid value; the server
-- rejects missing or invalid values instead of silently defaulting them going forward.

ALTER TABLE public.mix_submissions
  ADD COLUMN IF NOT EXISTS submission_source text NOT NULL DEFAULT 'uploaded_mix';

DO $$
BEGIN
  ALTER TABLE public.mix_submissions
    ADD CONSTRAINT mix_submissions_submission_source_check
      CHECK (submission_source IN ('uploaded_mix', 'battle_studio'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS mix_submissions_submission_source_idx
  ON public.mix_submissions (submission_source);
