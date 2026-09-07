-- Free download for email lead capture.
-- Claims are consent/verification records that grant marketplace_entitlements.
-- They are not orders, payments, provider transactions or seller payout activity.

CREATE TABLE IF NOT EXISTS public.marketplace_free_email_offers (
  id text PRIMARY KEY DEFAULT ('mp_free_offer_' || replace(gen_random_uuid()::text, '-', '')),
  seller_user_id text NOT NULL,
  product_id text NOT NULL REFERENCES public.marketplace_products(id) ON DELETE CASCADE,
  listing_id text NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'paused', 'archived')),
  free_email_enabled boolean NOT NULL DEFAULT false,
  verification_required boolean NOT NULL DEFAULT false,
  download_consent_required boolean NOT NULL DEFAULT true,
  marketing_consent_required boolean NOT NULL DEFAULT false,
  consent_text text NOT NULL,
  consent_version text NOT NULL DEFAULT 'v1',
  allowed_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  download_limit integer NOT NULL DEFAULT 1 CHECK (download_limit > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id),
  CHECK (jsonb_array_length(allowed_files) > 0),
  CHECK (allowed_files::text ~ 'private/marketplace-downloads/'),
  CHECK (allowed_files::text !~* '(https?://|data:|file:|signedurl|service_role|secret|access_token|refresh_token)'),
  CHECK (allowed_files::text !~* '(wav|stem|trackout|master|exclusive)')
);

CREATE TABLE IF NOT EXISTS public.marketplace_free_email_leads (
  id text PRIMARY KEY DEFAULT ('mp_free_lead_' || replace(gen_random_uuid()::text, '-', '')),
  offer_id text NOT NULL REFERENCES public.marketplace_free_email_offers(id) ON DELETE CASCADE,
  email text NOT NULL,
  user_id text,
  seller_user_id text NOT NULL,
  product_id text NOT NULL REFERENCES public.marketplace_products(id) ON DELETE CASCADE,
  listing_id text NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  download_consent_status text NOT NULL
    CHECK (download_consent_status IN ('accepted', 'not_required')),
  marketing_consent_status text NOT NULL
    CHECK (marketing_consent_status IN ('accepted', 'declined', 'required')),
  consent_text_snapshot text NOT NULL,
  consent_version text NOT NULL,
  source text,
  campaign text,
  referrer text,
  verification_status text NOT NULL DEFAULT 'not_required'
    CHECK (verification_status IN ('not_required', 'pending', 'verified', 'expired', 'failed')),
  verification_delivery_status text NOT NULL DEFAULT 'not_required'
    CHECK (verification_delivery_status IN ('not_required', 'pending', 'sent', 'unconfigured', 'failed')),
  verification_token_hash text,
  verification_sent_at timestamptz,
  verified_at timestamptz,
  entitlement_id text REFERENCES public.marketplace_entitlements(id) ON DELETE SET NULL,
  download_status text NOT NULL DEFAULT 'locked'
    CHECK (download_status IN ('locked', 'available', 'downloaded', 'restricted')),
  download_access_token_hash text,
  downloaded_at timestamptz,
  claimed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (offer_id, email),
  CHECK (email = lower(email)),
  CHECK (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  CHECK (source IS NULL OR source !~* '(secret|token|private/|service_role|access_token|refresh_token)'),
  CHECK (campaign IS NULL OR campaign !~* '(secret|token|private/|service_role|access_token|refresh_token)'),
  CHECK (referrer IS NULL OR referrer !~* '(secret|service_role|access_token|refresh_token)')
);

ALTER TABLE public.marketplace_entitlements
  ADD COLUMN IF NOT EXISTS originating_lead_id text REFERENCES public.marketplace_free_email_leads(id) ON DELETE SET NULL;

DO $$
BEGIN
  ALTER TABLE public.marketplace_entitlements
    DROP CONSTRAINT IF EXISTS marketplace_entitlements_source_check;
  ALTER TABLE public.marketplace_entitlements
    ADD CONSTRAINT marketplace_entitlements_source_check
      CHECK (source IN ('manual_grant', 'operator_grant', 'creator_grant', 'imported', 'test_seed', 'purchase_settlement', 'free_email'));
END $$;

DO $$
BEGIN
  ALTER TABLE public.marketplace_entitlements
    ADD CONSTRAINT marketplace_entitlements_free_email_email_check
      CHECK (source <> 'free_email' OR buyer_email IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.marketplace_entitlements
    ADD CONSTRAINT marketplace_entitlements_free_email_order_check
      CHECK (source <> 'free_email' OR originating_order_id IS NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_free_email_entitlements_lead_idx
  ON public.marketplace_entitlements (originating_lead_id)
  WHERE source = 'free_email' AND originating_lead_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_free_email_entitlements_email_listing_idx
  ON public.marketplace_entitlements (buyer_email, listing_id)
  WHERE source = 'free_email' AND buyer_email IS NOT NULL AND listing_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS marketplace_free_email_offers_seller_idx
  ON public.marketplace_free_email_offers (seller_user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS marketplace_free_email_leads_seller_idx
  ON public.marketplace_free_email_leads (seller_user_id, claimed_at DESC);

CREATE INDEX IF NOT EXISTS marketplace_free_email_leads_listing_idx
  ON public.marketplace_free_email_leads (listing_id, claimed_at DESC);

CREATE OR REPLACE FUNCTION public.set_marketplace_free_email_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  CREATE TRIGGER marketplace_free_email_offers_set_updated_at
    BEFORE UPDATE ON public.marketplace_free_email_offers
    FOR EACH ROW EXECUTE FUNCTION public.set_marketplace_free_email_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER marketplace_free_email_leads_set_updated_at
    BEFORE UPDATE ON public.marketplace_free_email_leads
    FOR EACH ROW EXECUTE FUNCTION public.set_marketplace_free_email_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.marketplace_free_email_offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_free_email_leads ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "allow_select_public_active_free_email_offers" ON public.marketplace_free_email_offers
    FOR SELECT USING (status = 'active' AND free_email_enabled = true);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_free_email_offers" ON public.marketplace_free_email_offers
    FOR SELECT USING (seller_user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_seller_select_own_free_email_leads" ON public.marketplace_free_email_leads
    FOR SELECT USING (seller_user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_user_select_own_free_email_leads" ON public.marketplace_free_email_leads
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
