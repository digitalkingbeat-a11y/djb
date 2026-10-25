-- Oct 20c: a Beat Store discount code use now only COUNTS once Stripe confirms the payment.
-- While a buyer is still on the Stripe checkout page the use is "reserved" (held), so a code
-- with a usage limit can't be oversold; the hold is given back if the checkout expires or fails.
-- Apply after 046. Safe to re-run.
ALTER TABLE public.beat_discount_codes
  ADD COLUMN IF NOT EXISTS reserved_uses integer NOT NULL DEFAULT 0;

-- Uses recorded before this change were already counted, so they start out as 'confirmed'.
ALTER TABLE public.beat_discount_redemptions
  ADD COLUMN IF NOT EXISTS status text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS expires_at timestamptz,
  ADD COLUMN IF NOT EXISTS settled_at timestamptz;

ALTER TABLE public.beat_discount_redemptions
  DROP CONSTRAINT IF EXISTS beat_discount_redemptions_status_check,
  ADD CONSTRAINT beat_discount_redemptions_status_check CHECK (status IN ('reserved','confirmed','released'));
ALTER TABLE public.beat_discount_codes
  DROP CONSTRAINT IF EXISTS beat_discount_codes_reserved_uses_check,
  ADD CONSTRAINT beat_discount_codes_reserved_uses_check CHECK (reserved_uses >= 0);

-- One discount use per order, so a repeated webhook can never add a second one.
CREATE UNIQUE INDEX IF NOT EXISTS beat_discount_redemptions_order_uniq ON public.beat_discount_redemptions (order_id);
CREATE INDEX IF NOT EXISTS beat_discount_redemptions_reserved_idx ON public.beat_discount_redemptions (code_id) WHERE status = 'reserved';
ALTER TABLE public.beat_discount_redemptions ENABLE ROW LEVEL SECURITY;
