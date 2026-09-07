-- Owner-protected battle entry and private mix-submission metadata contract.
-- battle_id remains text while battle records are synced across local and server contracts.

CREATE TABLE IF NOT EXISTS public.battle_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_id text NOT NULL,
  user_id text NOT NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'withdrawn')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (battle_id, user_id),
  UNIQUE (id, user_id)
);

CREATE TABLE IF NOT EXISTS public.mix_submissions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  battle_entry_id uuid NOT NULL,
  user_id text NOT NULL,
  storage_object_path text NOT NULL CHECK (storage_object_path !~* '^(https?|data):'),
  original_filename text NOT NULL,
  declared_mime_type text NOT NULL,
  file_size bigint NOT NULL CHECK (file_size >= 0),
  duration numeric CHECK (duration IS NULL OR duration >= 0),
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'uploading', 'uploaded', 'queued', 'processing', 'judging', 'completed', 'failed')),
  processing_info jsonb NOT NULL DEFAULT '{}'::jsonb,
  processing_error text,
  judge_result jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (battle_entry_id),
  FOREIGN KEY (battle_entry_id, user_id) REFERENCES public.battle_entries (id, user_id)
);

CREATE INDEX IF NOT EXISTS battle_entries_user_idx ON public.battle_entries(user_id);
CREATE INDEX IF NOT EXISTS mix_submissions_user_idx ON public.mix_submissions(user_id);
CREATE INDEX IF NOT EXISTS mix_submissions_status_idx ON public.mix_submissions(status);

CREATE OR REPLACE FUNCTION public.set_battle_submission_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_completed_submission_mutation()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'completed' AND NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION 'Completed submissions are immutable';
  END IF;
  RETURN NEW;
END;
$$;

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

DO $$
BEGIN
  CREATE TRIGGER battle_entries_set_updated_at
    BEFORE UPDATE ON public.battle_entries
    FOR EACH ROW EXECUTE FUNCTION public.set_battle_submission_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER mix_submissions_set_updated_at
    BEFORE UPDATE ON public.mix_submissions
    FOR EACH ROW EXECUTE FUNCTION public.set_battle_submission_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER mix_submissions_prevent_completed_mutation
    BEFORE UPDATE ON public.mix_submissions
    FOR EACH ROW EXECUTE FUNCTION public.prevent_completed_submission_mutation();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.battle_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.mix_submissions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_battle_entries" ON public.battle_entries
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_mix_submissions" ON public.mix_submissions
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER mix_submissions_enforce_status_transition
    BEFORE UPDATE ON public.mix_submissions
    FOR EACH ROW EXECUTE FUNCTION public.enforce_mix_submission_status_transition();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
