-- Oct 20: phone lock-screen alerts (Web Push). One row per device that turned alerts on, with
-- the alert types that device wants. Only the server (service role) reads or writes it. Safe to re-run.
CREATE TABLE IF NOT EXISTS public.push_subscriptions (
  id text PRIMARY KEY,
  user_id uuid NOT NULL,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  types text[] NOT NULL DEFAULT ARRAY['tournament_match_ready','battle_chat_message','timed_comment_received','direct_message','challenge_received'],
  device_label text,
  active boolean NOT NULL DEFAULT true,
  last_sent_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS push_subscriptions_user_idx ON public.push_subscriptions (user_id);
ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;
-- No browser policies on purpose: subscriptions are only touched through the server.
