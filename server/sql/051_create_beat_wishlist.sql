-- Oct 25 Store: Beat Store wishlist (the heart) + two new alert types.
-- wishlist_alert = a saved beat's price dropped or its producer made a discount code.
-- gift_received  = a beat gift you sent was claimed.
-- Apply after 050. Safe to re-run. Rows hold auth user ids: service role only (no browser policies).
CREATE TABLE IF NOT EXISTS public.beat_wishlist_items (
  user_id text NOT NULL,
  listing_id text NOT NULL REFERENCES public.marketplace_listings(id) ON DELETE CASCADE,
  saved_price_cents integer CHECK (saved_price_cents IS NULL OR saved_price_cents >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);
CREATE INDEX IF NOT EXISTS beat_wishlist_items_listing_idx ON public.beat_wishlist_items (listing_id);
ALTER TABLE public.beat_wishlist_items ENABLE ROW LEVEL SECURITY;

ALTER TABLE public.dj_notifications
  DROP CONSTRAINT IF EXISTS dj_notifications_type_check,
  ADD CONSTRAINT dj_notifications_type_check CHECK (type IN ('challenge_received','challenge_accepted','challenge_declined','challenge_cancelled','challenge_expired','challenge_converted_to_battle','rematch_requested','follow_started','comment_received','reply_received','reaction_received','moderation_update','mention_received','tournament_match_ready','battle_chat_message','timed_comment_received','direct_message','result_review_decided','invite_joined','remix_contest_won','remix_store_offer','wishlist_alert','gift_received'));
ALTER TABLE public.dj_notification_mutes
  DROP CONSTRAINT IF EXISTS dj_notification_mutes_notification_type_check,
  ADD CONSTRAINT dj_notification_mutes_notification_type_check CHECK (notification_type IS NULL OR notification_type IN ('challenge_received','challenge_accepted','challenge_declined','challenge_cancelled','challenge_expired','challenge_converted_to_battle','rematch_requested','follow_started','comment_received','reply_received','reaction_received','moderation_update','mention_received','tournament_match_ready','battle_chat_message','timed_comment_received','direct_message','result_review_decided','invite_joined','remix_contest_won','remix_store_offer','wishlist_alert','gift_received'));
