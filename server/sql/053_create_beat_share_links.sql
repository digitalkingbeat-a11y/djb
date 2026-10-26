-- Oct 25: beat share links that credit the DJ who shared. Apply after 052. Safe to re-run.
-- One short public code per (beat, sharer). Visits and plays store only a salted hash of the
-- visitor (never an IP, user agent or user id), one row per visitor per kind per day.
-- Sales are credited through marketplace_orders.provider_metadata->>'shareCode'. Service role only.
CREATE TABLE IF NOT EXISTS public.marketplace_share_links (
  code text PRIMARY KEY CHECK (code ~ '^[a-z0-9]{10}$'),
  listing_id text NOT NULL,
  sharer_user_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (listing_id, sharer_user_id)
);
CREATE INDEX IF NOT EXISTS marketplace_share_links_listing_idx ON public.marketplace_share_links (listing_id);
ALTER TABLE public.marketplace_share_links ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.marketplace_share_events (
  id text PRIMARY KEY,
  code text NOT NULL REFERENCES public.marketplace_share_links(code) ON DELETE CASCADE,
  listing_id text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('visit', 'play')),
  visitor_hash text NOT NULL CHECK (visitor_hash ~ '^[0-9a-f]{64}$'),
  day date NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code, kind, visitor_hash, day)
);
CREATE INDEX IF NOT EXISTS marketplace_share_events_listing_idx ON public.marketplace_share_events (listing_id);
ALTER TABLE public.marketplace_share_events ENABLE ROW LEVEL SECURITY;
