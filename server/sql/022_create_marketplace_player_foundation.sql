-- Marketplace/player foundation.
-- Stores product, catalog, rights, entitlement and player-session metadata only.
-- External commerce integrations are deferred.

CREATE TABLE IF NOT EXISTS public.marketplace_products (
  id text PRIMARY KEY DEFAULT ('mp_prod_' || replace(gen_random_uuid()::text, '-', '')),
  creator_user_id text NOT NULL,
  library_track_id uuid REFERENCES public.music_library_tracks(id) ON DELETE SET NULL,
  product_type text NOT NULL DEFAULT 'beat'
    CHECK (product_type IN ('beat', 'sample_pack', 'loop_pack', 'preset_pack', 'battle_recording')),
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  audio_storage_bucket text NOT NULL DEFAULT 'battle-mixes',
  audio_storage_object_path text NOT NULL CHECK (
    audio_storage_object_path !~* '^(https?|data|file):'
    AND audio_storage_object_path !~ '\\.\\.'
    AND audio_storage_object_path ~ '^private/(library-audio|battle-entries)/'
  ),
  preview_storage_object_path text CHECK (
    preview_storage_object_path IS NULL
    OR (
      preview_storage_object_path !~* '^(https?|data|file):'
      AND preview_storage_object_path !~ '\\.\\.'
      AND preview_storage_object_path ~ '^private/marketplace-previews/'
    )
  ),
  artwork_storage_bucket text,
  artwork_storage_object_path text CHECK (
    artwork_storage_object_path IS NULL
    OR (
      artwork_storage_object_path !~* '^(https?|data|file):'
      AND artwork_storage_object_path !~ '\\.\\.'
      AND artwork_storage_object_path ~ '^private/(library-artwork|marketplace-artwork)/'
    )
  ),
  bpm numeric CHECK (bpm IS NULL OR (bpm >= 20 AND bpm <= 300)),
  key text,
  camelot_key text,
  genre text NOT NULL DEFAULT 'Unsorted',
  duration numeric CHECK (duration IS NULL OR duration >= 0),
  tags jsonb NOT NULL DEFAULT '[]'::jsonb,
  rights_classification text NOT NULL
    CHECK (rights_classification IN ('original', 'licensed', 'royalty_free', 'platform_cleared')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('draft', 'active', 'archived', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (creator_user_id, library_track_id),
  CHECK (tags::text !~* '(storage_object_path|audio_storage|artwork_storage|signedurl|https?://|service_role|secret|private/)')
);

CREATE TABLE IF NOT EXISTS public.marketplace_rights_policies (
  id text PRIMARY KEY DEFAULT ('mp_rights_' || replace(gen_random_uuid()::text, '-', '')),
  product_id text NOT NULL REFERENCES public.marketplace_products(id) ON DELETE CASCADE,
  rights_classification text NOT NULL
    CHECK (rights_classification IN ('original', 'licensed', 'royalty_free', 'platform_cleared')),
  license_type text NOT NULL DEFAULT 'battle_use'
    CHECK (license_type IN ('personal_stream', 'battle_use', 'creator_license', 'royalty_free_use', 'preview_only')),
  marketplace_streaming_allowed boolean NOT NULL DEFAULT true,
  preview_allowed boolean NOT NULL DEFAULT true,
  download_allowed boolean NOT NULL DEFAULT false,
  battle_use_allowed boolean NOT NULL DEFAULT true,
  commercial_use_allowed boolean NOT NULL DEFAULT false,
  attribution_required boolean NOT NULL DEFAULT false,
  territory text NOT NULL DEFAULT 'worldwide',
  terms jsonb NOT NULL DEFAULT '{}'::jsonb,
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived', 'blocked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id),
  CHECK (terms::text !~* '(storage_object_path|audio_storage|artwork_storage|signedurl|https?://|service_role|secret|private/)')
);

CREATE TABLE IF NOT EXISTS public.marketplace_listings (
  id text PRIMARY KEY DEFAULT ('mp_listing_' || replace(gen_random_uuid()::text, '-', '')),
  product_id text NOT NULL REFERENCES public.marketplace_products(id) ON DELETE CASCADE,
  seller_user_id text NOT NULL,
  title text NOT NULL,
  description text NOT NULL DEFAULT '',
  slug text NOT NULL,
  status text NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived', 'blocked')),
  preview_enabled boolean NOT NULL DEFAULT false,
  preview_duration integer NOT NULL DEFAULT 30 CHECK (preview_duration >= 5 AND preview_duration <= 180),
  display_price_cents integer CHECK (display_price_cents IS NULL OR display_price_cents >= 0),
  currency text NOT NULL DEFAULT 'USD' CHECK (char_length(currency) = 3),
  commerce_status text NOT NULL DEFAULT 'deferred'
    CHECK (commerce_status IN ('deferred', 'enabled', 'paused')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (product_id),
  UNIQUE (slug),
  CHECK (metadata::text !~* '(storage_object_path|audio_storage|artwork_storage|signedurl|https?://|service_role|secret|private/)')
);

CREATE TABLE IF NOT EXISTS public.marketplace_entitlements (
  id text PRIMARY KEY DEFAULT ('mp_ent_' || replace(gen_random_uuid()::text, '-', '')),
  product_id text NOT NULL REFERENCES public.marketplace_products(id) ON DELETE CASCADE,
  user_id text NOT NULL,
  entitlement_type text NOT NULL DEFAULT 'stream'
    CHECK (entitlement_type IN ('stream', 'download', 'creator_grant')),
  source text NOT NULL DEFAULT 'manual_grant'
    CHECK (source IN ('manual_grant', 'operator_grant', 'creator_grant', 'imported', 'test_seed')),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'revoked', 'expired')),
  starts_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz,
  granted_by text,
  grant_reason text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at IS NULL OR expires_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS marketplace_entitlements_active_product_user_idx
  ON public.marketplace_entitlements (product_id, user_id)
  WHERE status = 'active';

CREATE TABLE IF NOT EXISTS public.marketplace_player_sessions (
  id text PRIMARY KEY DEFAULT ('mp_play_' || replace(gen_random_uuid()::text, '-', '')),
  product_id text NOT NULL REFERENCES public.marketplace_products(id) ON DELETE CASCADE,
  listing_id text REFERENCES public.marketplace_listings(id) ON DELETE SET NULL,
  user_id text NOT NULL,
  entitlement_id text REFERENCES public.marketplace_entitlements(id) ON DELETE SET NULL,
  access_scope text NOT NULL
    CHECK (access_scope IN ('preview', 'entitled_stream', 'owner_stream')),
  expires_at timestamptz NOT NULL,
  audit_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (audit_context::text !~* '(storage_object_path|audio_storage|artwork_storage|signedurl|https?://|service_role|secret|private/)')
);

CREATE INDEX IF NOT EXISTS marketplace_products_creator_idx
  ON public.marketplace_products (creator_user_id, updated_at DESC)
  WHERE status <> 'archived';

CREATE INDEX IF NOT EXISTS marketplace_products_type_genre_idx
  ON public.marketplace_products (product_type, genre, updated_at DESC)
  WHERE status = 'active';

CREATE INDEX IF NOT EXISTS marketplace_listings_catalog_idx
  ON public.marketplace_listings (status, published_at DESC, updated_at DESC);

CREATE INDEX IF NOT EXISTS marketplace_entitlements_user_idx
  ON public.marketplace_entitlements (user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS marketplace_player_sessions_user_idx
  ON public.marketplace_player_sessions (user_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.set_marketplace_foundation_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

DO $$
BEGIN
  CREATE TRIGGER marketplace_products_set_updated_at
    BEFORE UPDATE ON public.marketplace_products
    FOR EACH ROW EXECUTE FUNCTION public.set_marketplace_foundation_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER marketplace_rights_set_updated_at
    BEFORE UPDATE ON public.marketplace_rights_policies
    FOR EACH ROW EXECUTE FUNCTION public.set_marketplace_foundation_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER marketplace_listings_set_updated_at
    BEFORE UPDATE ON public.marketplace_listings
    FOR EACH ROW EXECUTE FUNCTION public.set_marketplace_foundation_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TRIGGER marketplace_entitlements_set_updated_at
    BEFORE UPDATE ON public.marketplace_entitlements
    FOR EACH ROW EXECUTE FUNCTION public.set_marketplace_foundation_updated_at();
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE public.marketplace_products ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_rights_policies ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_listings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_entitlements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.marketplace_player_sessions ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "allow_select_published_marketplace_products" ON public.marketplace_products
    FOR SELECT USING (
      creator_user_id = auth.uid()::text
      OR EXISTS (
        SELECT 1 FROM public.marketplace_listings l
        WHERE l.product_id = marketplace_products.id
          AND l.status = 'published'
      )
      OR EXISTS (
        SELECT 1 FROM public.marketplace_entitlements e
        WHERE e.product_id = marketplace_products.id
          AND e.user_id = auth.uid()::text
          AND e.status = 'active'
          AND e.starts_at <= now()
          AND (e.expires_at IS NULL OR e.expires_at > now())
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_owner_insert_marketplace_products" ON public.marketplace_products
    FOR INSERT WITH CHECK (creator_user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_owner_update_marketplace_products" ON public.marketplace_products
    FOR UPDATE USING (creator_user_id = auth.uid()::text)
    WITH CHECK (creator_user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_marketplace_rights" ON public.marketplace_rights_policies
    FOR SELECT USING (
      EXISTS (
        SELECT 1 FROM public.marketplace_products p
        WHERE p.id = marketplace_rights_policies.product_id
          AND (
            p.creator_user_id = auth.uid()::text
            OR EXISTS (
              SELECT 1 FROM public.marketplace_listings l
              WHERE l.product_id = p.id
                AND l.status = 'published'
            )
          )
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_owner_write_marketplace_rights" ON public.marketplace_rights_policies
    FOR ALL USING (
      EXISTS (
        SELECT 1 FROM public.marketplace_products p
        WHERE p.id = marketplace_rights_policies.product_id
          AND p.creator_user_id = auth.uid()::text
      )
    )
    WITH CHECK (
      EXISTS (
        SELECT 1 FROM public.marketplace_products p
        WHERE p.id = marketplace_rights_policies.product_id
          AND p.creator_user_id = auth.uid()::text
      )
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_marketplace_listings" ON public.marketplace_listings
    FOR SELECT USING (
      status = 'published'
      OR seller_user_id = auth.uid()::text
    );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_owner_insert_marketplace_listings" ON public.marketplace_listings
    FOR INSERT WITH CHECK (seller_user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_owner_update_marketplace_listings" ON public.marketplace_listings
    FOR UPDATE USING (seller_user_id = auth.uid()::text)
    WITH CHECK (seller_user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_marketplace_entitlements" ON public.marketplace_entitlements
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_marketplace_player_sessions" ON public.marketplace_player_sessions
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_insert_own_marketplace_player_sessions" ON public.marketplace_player_sessions
    FOR INSERT WITH CHECK (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
