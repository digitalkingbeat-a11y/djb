-- Oct 25 Store: gift a beat at checkout. Apply after 051. Safe to re-run.
-- Only a SHA-256 hash of the one-time claim secret is stored. Service role only.
CREATE TABLE IF NOT EXISTS public.marketplace_beat_gifts (
  id text PRIMARY KEY,
  order_id text NOT NULL UNIQUE REFERENCES public.marketplace_orders(id) ON DELETE CASCADE,
  listing_id text NOT NULL,
  product_id text NOT NULL,
  buyer_user_id text NOT NULL,
  recipient_email text NOT NULL CHECK (char_length(recipient_email) BETWEEN 3 AND 254 AND recipient_email = lower(recipient_email)),
  message text NOT NULL DEFAULT '' CHECK (char_length(message) <= 280),
  from_name text NOT NULL DEFAULT '' CHECK (char_length(from_name) <= 60),
  status text NOT NULL DEFAULT 'pending_payment' CHECK (status IN ('pending_payment', 'sent', 'claimed', 'cancelled')),
  claim_token_hash text CHECK (claim_token_hash IS NULL OR claim_token_hash ~ '^[0-9a-f]{64}$'),
  expires_at timestamptz,
  claimed_by text,
  claimed_at timestamptz,
  email_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (status <> 'claimed' OR (claimed_by IS NOT NULL AND claimed_at IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS marketplace_beat_gifts_recipient_idx ON public.marketplace_beat_gifts (recipient_email) WHERE status = 'sent';
CREATE INDEX IF NOT EXISTS marketplace_beat_gifts_buyer_idx ON public.marketplace_beat_gifts (buyer_user_id, created_at DESC);
ALTER TABLE public.marketplace_beat_gifts ENABLE ROW LEVEL SECURITY;
