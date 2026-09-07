-- Adds the judging-result status contract for uploaded battle mixes.
-- The server only stores result metadata; Bitcoin rewards remain external metadata
-- and no wallet or custody actions happen in this migration.

ALTER TABLE public.mix_submissions
  DROP CONSTRAINT IF EXISTS mix_submissions_status_check;

ALTER TABLE public.mix_submissions
  ADD CONSTRAINT mix_submissions_status_check
  CHECK (status IN ('draft', 'uploading', 'uploaded', 'queued', 'processing', 'judging', 'completed', 'failed'));

CREATE OR REPLACE FUNCTION public.enforce_mix_submission_status_transition()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.status = OLD.status THEN RETURN NEW; END IF;
  IF (OLD.status = 'draft' AND NEW.status IN ('uploading', 'failed'))
    OR (OLD.status = 'uploading' AND NEW.status IN ('uploaded', 'failed'))
    OR (OLD.status = 'uploaded' AND NEW.status IN ('queued', 'judging', 'failed'))
    OR (OLD.status = 'queued' AND NEW.status IN ('processing', 'judging', 'failed'))
    OR (OLD.status = 'processing' AND NEW.status IN ('judging', 'completed', 'failed'))
    OR (OLD.status = 'judging' AND NEW.status IN ('completed', 'failed'))
    OR (OLD.status = 'failed' AND NEW.status = 'uploading') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Illegal mix submission status transition from % to %', OLD.status, NEW.status;
END;
$$;

CREATE INDEX IF NOT EXISTS mix_submissions_judging_idx
  ON public.mix_submissions(status)
  WHERE status IN ('uploaded', 'queued', 'processing', 'judging');
