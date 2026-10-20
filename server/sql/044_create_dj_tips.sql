-- Oct 20b: "Tip a DJ" through Stripe Checkout (money goes to the DJ's connected Stripe account).
-- Apply after 043. Safe to re-run. Server-only table.
CREATE TABLE IF NOT EXISTS public.dj_tips (
  id text PRIMARY KEY,
  tipper_user_id uuid NOT NULL,
  recipient_user_id uuid NOT NULL,
  recipient_public_profile_id text NOT NULL,
  verified_result_id text,
  amount_cents integer NOT NULL CHECK (amount_cents BETWEEN 100 AND 50000),
  currency text NOT NULL DEFAULT 'usd',
  message text CHECK (message IS NULL OR char_length(message) <= 280),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','paid','canceled','refunded')),
  provider text NOT NULL DEFAULT 'stripe',
  provider_checkout_id text,
  paid_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS dj_tips_recipient_idx ON public.dj_tips (recipient_user_id, status);
CREATE INDEX IF NOT EXISTS dj_tips_tipper_idx ON public.dj_tips (tipper_user_id);
ALTER TABLE public.dj_tips ENABLE ROW LEVEL SECURITY;
