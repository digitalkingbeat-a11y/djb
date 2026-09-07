-- DJ mix rights certification.
-- Certifications gate public result visibility and replay permission only.
-- They do not create orders, payments, provider transactions, payouts or marketplace entitlements.

CREATE TABLE IF NOT EXISTS public.mix_rights_certifications (
  id text PRIMARY KEY DEFAULT ('mix_rights_cert_' || replace(gen_random_uuid()::text, '-', '')),
  submission_id uuid NOT NULL REFERENCES public.mix_submissions(id) ON DELETE CASCADE,
  battle_entry_id uuid NOT NULL REFERENCES public.battle_entries(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  certification_status text NOT NULL DEFAULT 'review_required'
    CHECK (certification_status IN ('certified', 'review_required', 'blocked', 'revoked', 'expired')),
  certification_source text NOT NULL DEFAULT 'battle_prep_snapshot'
    CHECK (certification_source IN ('battle_prep_snapshot', 'manual_attestation', 'operator_review')),
  battle_prep_snapshot_id uuid REFERENCES public.battle_prep_entry_snapshots(id) ON DELETE SET NULL,
  battle_prep_snapshot_version text,
  public_result_allowed boolean NOT NULL DEFAULT false,
  replay_allowed boolean NOT NULL DEFAULT false,
  rights_attested boolean NOT NULL DEFAULT false,
  public_result_consent boolean NOT NULL DEFAULT false,
  replay_consent boolean NOT NULL DEFAULT false,
  attestation_text text NOT NULL,
  attestation_version text NOT NULL DEFAULT 'mix-rights-v1',
  track_evidence jsonb NOT NULL DEFAULT '[]'::jsonb,
  blocked_reasons jsonb NOT NULL DEFAULT '[]'::jsonb,
  warnings jsonb NOT NULL DEFAULT '[]'::jsonb,
  operator_review_status text NOT NULL DEFAULT 'not_requested'
    CHECK (operator_review_status IN ('not_requested', 'needed', 'approved', 'rejected', 'revoked')),
  review_notes text,
  revoked_by text,
  certified_at timestamptz,
  revoked_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (submission_id),
  UNIQUE (submission_id, user_id),
  CHECK (public_result_allowed = false OR certification_status = 'certified'),
  CHECK (replay_allowed = false OR certification_status = 'certified'),
  CHECK (public_result_allowed = false OR rights_attested = true),
  CHECK (public_result_allowed = false OR public_result_consent = true),
  CHECK (track_evidence::text !~* '(private/|storage_object_path|signedurl|service_role|secret|access_token|refresh_token)'),
  CHECK (blocked_reasons::text !~* '(private/|storage_object_path|signedurl|service_role|secret|access_token|refresh_token)'),
  CHECK (warnings::text !~* '(private/|storage_object_path|signedurl|service_role|secret|access_token|refresh_token)'),
  FOREIGN KEY (battle_entry_id, user_id) REFERENCES public.battle_entries(id, user_id)
);

CREATE INDEX IF NOT EXISTS mix_rights_certifications_user_idx
  ON public.mix_rights_certifications (user_id, updated_at DESC);

CREATE INDEX IF NOT EXISTS mix_rights_certifications_status_idx
  ON public.mix_rights_certifications (certification_status, public_result_allowed, updated_at DESC);

CREATE INDEX IF NOT EXISTS mix_rights_certifications_snapshot_idx
  ON public.mix_rights_certifications (battle_prep_snapshot_id)
  WHERE battle_prep_snapshot_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_mix_rights_certifications_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  CREATE TRIGGER mix_rights_certifications_set_updated_at
    BEFORE UPDATE ON public.mix_rights_certifications
    FOR EACH ROW EXECUTE FUNCTION public.set_mix_rights_certifications_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.mix_rights_certifications ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_mix_rights_certifications" ON public.mix_rights_certifications
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_insert_own_mix_rights_certifications" ON public.mix_rights_certifications
    FOR INSERT WITH CHECK (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_update_own_mix_rights_certifications" ON public.mix_rights_certifications
    FOR UPDATE USING (user_id = auth.uid()::text)
    WITH CHECK (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
