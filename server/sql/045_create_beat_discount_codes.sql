-- Oct 20b: Beat Store discount codes (percent or fixed amount off, optional end date and usage
-- limit) and a log of each use. Apply after 044. Safe to re-run. Server-only tables.
CREATE TABLE IF NOT EXISTS public.beat_discount_codes (
  id text PRIMARY KEY,
  seller_user_id uuid NOT NULL,
  code text NOT NULL CHECK (code ~ '^[A-Z0-9_-]{3,20}$'),
  kind text NOT NULL CHECK (kind IN ('percent','fixed')),
  percent_off integer CHECK (percent_off IS NULL OR percent_off BETWEEN 1 AND 90),
  amount_off_cents integer CHECK (amount_off_cents IS NULL OR amount_off_cents BETWEEN 50 AND 100000),
  ends_at timestamptz,
  usage_limit integer CHECK (usage_limit IS NULL OR usage_limit >= 1),
  times_used integer NOT NULL DEFAULT 0,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS beat_discount_codes_seller_code ON public.beat_discount_codes (seller_user_id, code);
ALTER TABLE public.beat_discount_codes ENABLE ROW LEVEL SECURITY;

CREATE TABLE IF NOT EXISTS public.beat_discount_redemptions (
  id text PRIMARY KEY,
  code_id text NOT NULL REFERENCES public.beat_discount_codes(id) ON DELETE CASCADE,
  order_id text NOT NULL,
  buyer_user_id uuid NOT NULL,
  discount_cents integer NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS beat_discount_redemptions_code_idx ON public.beat_discount_redemptions (code_id);
ALTER TABLE public.beat_discount_redemptions ENABLE ROW LEVEL SECURITY;
