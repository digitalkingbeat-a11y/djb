-- Marketplace checkout, settlement and purchase-entitlement records.
-- Checkout redirects are not authoritative. Purchase entitlements are activated
-- only by trusted server-side provider events processed through this schema.

CREATE TABLE IF NOT EXISTS public.marketplace_seller_accounts (
  id text PRIMARY KEY DEFAULT ('mp_seller_' || replace(gen_random_uuid()::text, '-', '')),
  seller_user_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('stripe', 'paypal')),
  provider_account_id text NOT NULL,
  account_status text NOT NULL DEFAULT 'pending'
    CHECK (account_status IN ('not_connected', 'pending', 'connected', 'restricted', 'disabled')),
  charges_enabled boolean NOT NULL DEFAULT false,
  payouts_enabled boolean NOT NULL DEFAULT false,
  requirements_due jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (seller_user_id, provider),
  CHECK (provider_account_id !~* '(sk_live|sk_test|secret|private_key|service_role|access_token|refresh_token)')
);

CREATE TABLE IF NOT EXISTS public.marketplace_orders (
  id text PRIMARY KEY DEFAULT ('mp_order_' || replace(gen_random_uuid()::text, '-', '')),
  buyer_user_id text NOT NULL,
  buyer_email text,
  seller_user_id text NOT NULL,
  seller_account_id text NOT NULL REFERENCES public.marketplace_seller_accounts(id) ON DELETE RESTRICT,
  listing_id text NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES public.marketplace_products(id) ON DELETE RESTRICT,
  license_type text NOT NULL,
  gross_amount_cents integer NOT NULL CHECK (gross_amount_cents > 0),
  platform_fee_cents integer NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  seller_amount_cents integer NOT NULL CHECK (seller_amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  provider text NOT NULL CHECK (provider IN ('stripe', 'paypal')),
  provider_transaction_id text,
  payment_status text NOT NULL DEFAULT 'pending'
    CHECK (payment_status IN ('pending', 'processing', 'paid', 'failed', 'canceled', 'refunded', 'partially_refunded', 'disputed')),
  refund_state text NOT NULL DEFAULT 'none'
    CHECK (refund_state IN ('none', 'partial', 'full')),
  dispute_state text NOT NULL DEFAULT 'none'
    CHECK (dispute_state IN ('none', 'open', 'won', 'lost')),
  idempotency_key text,
  provider_metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  paid_at timestamptz,
  failed_at timestamptz,
  canceled_at timestamptz,
  refunded_at timestamptz,
  disputed_at timestamptz,
  UNIQUE (buyer_user_id, idempotency_key),
  CHECK (gross_amount_cents = platform_fee_cents + seller_amount_cents),
  CHECK (provider_metadata::text !~* '(sk_live|sk_test|secret|private_key|service_role|access_token|refresh_token|signedurl)')
);

CREATE TABLE IF NOT EXISTS public.marketplace_order_items (
  id text PRIMARY KEY DEFAULT ('mp_item_' || replace(gen_random_uuid()::text, '-', '')),
  order_id text NOT NULL REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  listing_id text NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE RESTRICT,
  product_id text NOT NULL REFERENCES public.marketplace_products(id) ON DELETE RESTRICT,
  seller_user_id text NOT NULL,
  license_type text NOT NULL,
  title_snapshot text NOT NULL,
  gross_amount_cents integer NOT NULL CHECK (gross_amount_cents > 0),
  platform_fee_cents integer NOT NULL DEFAULT 0 CHECK (platform_fee_cents >= 0),
  seller_amount_cents integer NOT NULL CHECK (seller_amount_cents >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  allowed_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (order_id, product_id),
  CHECK (gross_amount_cents = platform_fee_cents + seller_amount_cents),
  CHECK (allowed_files::text !~* '(https?://|data:|file:|signedurl|service_role|secret)')
);

CREATE TABLE IF NOT EXISTS public.marketplace_payment_events (
  id text PRIMARY KEY DEFAULT ('mp_event_' || replace(gen_random_uuid()::text, '-', '')),
  provider text NOT NULL CHECK (provider IN ('stripe', 'paypal')),
  provider_event_id text NOT NULL,
  order_id text REFERENCES public.marketplace_orders(id) ON DELETE SET NULL,
  provider_transaction_id text,
  event_type text NOT NULL,
  normalized_payment_status text
    CHECK (normalized_payment_status IS NULL OR normalized_payment_status IN ('pending', 'processing', 'paid', 'failed', 'canceled', 'refunded', 'partially_refunded', 'disputed')),
  payload_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  received_at timestamptz NOT NULL DEFAULT now(),
  processed_at timestamptz,
  duplicate_of text,
  error_message text,
  UNIQUE (provider, provider_event_id),
  CHECK (payload_summary::text !~* '(sk_live|sk_test|secret|private_key|service_role|access_token|refresh_token|signedurl|private/)'),
  CHECK (error_message IS NULL OR error_message !~* '(sk_live|sk_test|secret|private_key|service_role|access_token|refresh_token|private/)')
);

ALTER TABLE public.marketplace_entitlements
  ADD COLUMN IF NOT EXISTS listing_id text REFERENCES public.marketplace_listings(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS buyer_email text,
  ADD COLUMN IF NOT EXISTS license_type text,
  ADD COLUMN IF NOT EXISTS originating_order_id text REFERENCES public.marketplace_orders(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS allowed_files jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS download_limit integer,
  ADD COLUMN IF NOT EXISTS download_count integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS access_policy jsonb NOT NULL DEFAULT '{}'::jsonb;

DO $$
BEGIN
  ALTER TABLE public.marketplace_entitlements
    DROP CONSTRAINT IF EXISTS marketplace_entitlements_source_check;
  ALTER TABLE public.marketplace_entitlements
    ADD CONSTRAINT marketplace_entitlements_source_check
      CHECK (source IN ('manual_grant', 'operator_grant', 'creator_grant', 'imported', 'test_seed', 'purchase_settlement'));
END $$;

DO $$
BEGIN
  ALTER TABLE public.marketplace_entitlements
    ADD CONSTRAINT marketplace_entitlements_purchase_files_redaction_check
      CHECK (allowed_files::text !~* '(https?://|data:|file:|signedurl|service_role|secret)');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.marketplace_entitlements
    ADD CONSTRAINT marketplace_entitlements_download_count_check
      CHECK (
        download_limit IS NULL
        OR (download_limit >= 0 AND download_count >= 0 AND download_count <= download_limit)
      );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  ALTER TABLE public.marketplace_player_sessions
    DROP CONSTRAINT IF EXISTS marketplace_player_sessions_access_scope_check;
  ALTER TABLE public.marketplace_player_sessions
    ADD CONSTRAINT marketplace_player_sessions_access_scope_check
      CHECK (access_scope IN ('preview', 'entitled_stream', 'owner_stream', 'entitled_download'));
END $$;

CREATE INDEX IF NOT EXISTS marketplace_seller_accounts_provider_idx
  ON public.marketplace_seller_accounts (provider, account_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS marketplace_orders_buyer_idx
  ON public.marketplace_orders (buyer_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS marketplace_orders_seller_idx
  ON public.marketplace_orders (seller_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS marketplace_orders_provider_status_idx
  ON public.marketplace_orders (provider, payment_status, updated_at DESC);

CREATE INDEX IF NOT EXISTS marketplace_order_items_order_idx
  ON public.marketplace_order_items (order_id);

CREATE INDEX IF NOT EXISTS marketplace_payment_events_provider_idx
  ON public.marketplace_payment_events (provider, provider_event_id);

CREATE INDEX IF NOT EXISTS marketplace_entitlements_purchase_idx
  ON public.marketplace_entitlements (originating_order_id)
  WHERE originating_order_id IS NOT NULL;

CREATE OR REPLACE FUNCTION public.set_marketplace_commerce_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  CREATE TRIGGER marketplace_seller_accounts_set_updated_at
    BEFORE UPDATE ON public.marketplace_seller_accounts
    FOR EACH ROW EXECUTE FUNCTION public.set_marketplace_commerce_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER marketplace_orders_set_updated_at
    BEFORE UPDATE ON public.marketplace_orders
    FOR EACH ROW EXECUTE FUNCTION public.set_marketplace_commerce_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.marketplace_seller_accounts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_order_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_payment_events ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_marketplace_seller_accounts" ON public.marketplace_seller_accounts
    FOR SELECT USING (seller_user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_owned_marketplace_orders" ON public.marketplace_orders
    FOR SELECT USING (
      buyer_user_id = auth.uid()::text
      OR seller_user_id = auth.uid()::text
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_owned_marketplace_order_items" ON public.marketplace_order_items
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.marketplace_orders o
        WHERE o.id = marketplace_order_items.order_id
          AND (o.buyer_user_id = auth.uid()::text OR o.seller_user_id = auth.uid()::text)
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_purchase_entitlements" ON public.marketplace_entitlements
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
