-- Additive local migration for server-backed Community forum contracts.
-- Review and apply manually in Supabase after validating policies for production.

CREATE TABLE IF NOT EXISTS public.community_categories (
  id text PRIMARY KEY,
  slug text UNIQUE NOT NULL,
  label text NOT NULL,
  description text,
  sort_order integer NOT NULL DEFAULT 100,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  server_default boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.community_categories (id, slug, label, description, sort_order, server_default)
VALUES
  ('general', 'general', 'General DJ Discussion', 'General DJ discussion and questions.', 10, true),
  ('battle_talk', 'battle_talk', 'Battle Talk', 'Battle prep, opponent reads and judging talk.', 20, true),
  ('production', 'production', 'Production', 'Production, edits, flips and mixdown talk.', 30, true),
  ('gear', 'gear', 'Gear', 'CDJs, turntables, controllers, mixers and setup notes.', 40, true),
  ('events', 'events', 'Events', 'Shows, battles, meetups and streams.', 50, true),
  ('hip_hop', 'hip_hop', 'Hip-Hop', 'Hip-hop DJing, selection and scratch culture.', 60, true),
  ('house', 'house', 'House', 'House, tech house and club programming.', 70, true),
  ('scratch', 'scratch', 'Scratching', 'Scratch technique, drills and routines.', 80, true),
  ('open_format', 'open_format', 'Open Format', 'Open-format programming and transitions.', 90, true)
ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.community_posts (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  category_id text NOT NULL REFERENCES public.community_categories(id),
  title text NOT NULL CHECK (char_length(title) <= 180),
  body_text text NOT NULL CHECK (char_length(body_text) <= 4000),
  safe_links jsonb NOT NULL DEFAULT '[]'::jsonb,
  attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'followers', 'private')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'locked', 'deleted')),
  idempotency_key text,
  edited_at timestamptz,
  hidden_at timestamptz,
  locked_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS community_posts_user_idempotency_idx
  ON public.community_posts(user_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS community_posts_public_feed_idx
  ON public.community_posts(status, visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS community_posts_category_feed_idx
  ON public.community_posts(category_id, status, visibility, created_at DESC);
CREATE INDEX IF NOT EXISTS community_posts_owner_idx
  ON public.community_posts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.community_comments (
  id text PRIMARY KEY,
  post_id text NOT NULL REFERENCES public.community_posts(id),
  parent_comment_id text REFERENCES public.community_comments(id),
  user_id text NOT NULL,
  body_text text NOT NULL CHECK (char_length(body_text) <= 2200),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'hidden', 'deleted')),
  idempotency_key text,
  edited_at timestamptz,
  hidden_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS community_comments_user_post_idempotency_idx
  ON public.community_comments(user_id, post_id, idempotency_key)
  WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS community_comments_post_thread_idx
  ON public.community_comments(post_id, parent_comment_id, created_at);
CREATE INDEX IF NOT EXISTS community_comments_owner_idx
  ON public.community_comments(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS public.community_reactions (
  id text PRIMARY KEY,
  user_id text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id text NOT NULL,
  reaction_type text NOT NULL CHECK (reaction_type IN ('like', 'fire', 'respect', 'technique')),
  active boolean NOT NULL DEFAULT true,
  removed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS community_reactions_unique_active_target_idx
  ON public.community_reactions(user_id, target_type, target_id, reaction_type);
CREATE INDEX IF NOT EXISTS community_reactions_target_counts_idx
  ON public.community_reactions(target_type, target_id, active);

CREATE TABLE IF NOT EXISTS public.community_reports (
  id text PRIMARY KEY,
  reporter_user_id text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id text NOT NULL,
  reason text NOT NULL CHECK (reason IN ('spam', 'harassment', 'copyright', 'private_info', 'unsafe_content', 'off_topic', 'other')),
  context text CHECK (char_length(context) <= 800),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reviewing', 'resolved', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS community_reports_active_duplicate_idx
  ON public.community_reports(reporter_user_id, target_type, target_id, reason)
  WHERE status IN ('open', 'reviewing');
CREATE INDEX IF NOT EXISTS community_reports_queue_idx
  ON public.community_reports(status, created_at);

CREATE TABLE IF NOT EXISTS public.community_moderation_actions (
  id text PRIMARY KEY,
  operator_user_id text NOT NULL,
  target_type text NOT NULL CHECK (target_type IN ('post', 'comment')),
  target_id text NOT NULL,
  action text NOT NULL CHECK (action IN ('review', 'hide', 'restore', 'lock_comments', 'unlock_comments', 'remove_attachment')),
  reason text CHECK (char_length(reason) <= 400),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS community_moderation_actions_target_idx
  ON public.community_moderation_actions(target_type, target_id, created_at DESC);

ALTER TABLE public.community_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_posts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_comments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_reports ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.community_moderation_actions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS allow_select_active_community_categories ON public.community_categories;
CREATE POLICY allow_select_active_community_categories ON public.community_categories
  FOR SELECT USING (status = 'active');

DROP POLICY IF EXISTS allow_select_public_community_posts ON public.community_posts;
CREATE POLICY allow_select_public_community_posts ON public.community_posts
  FOR SELECT USING (visibility = 'public' AND status IN ('active', 'locked'));

DROP POLICY IF EXISTS allow_owner_manage_community_posts ON public.community_posts;
CREATE POLICY allow_owner_manage_community_posts ON public.community_posts
  FOR ALL USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS allow_select_public_community_comments ON public.community_comments;
CREATE POLICY allow_select_public_community_comments ON public.community_comments
  FOR SELECT USING (
    EXISTS (
      SELECT 1 FROM public.community_posts p
      WHERE p.id = community_comments.post_id
        AND p.visibility = 'public'
        AND p.status IN ('active', 'locked')
    )
  );

DROP POLICY IF EXISTS allow_owner_manage_community_comments ON public.community_comments;
CREATE POLICY allow_owner_manage_community_comments ON public.community_comments
  FOR ALL USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS allow_owner_manage_community_reactions ON public.community_reactions;
CREATE POLICY allow_owner_manage_community_reactions ON public.community_reactions
  FOR ALL USING (auth.uid()::text = user_id)
  WITH CHECK (auth.uid()::text = user_id);

DROP POLICY IF EXISTS allow_create_own_community_reports ON public.community_reports;
CREATE POLICY allow_create_own_community_reports ON public.community_reports
  FOR INSERT WITH CHECK (auth.uid()::text = reporter_user_id);

-- Operator review policies should be bound to your production admin role claim.
DROP POLICY IF EXISTS allow_operator_select_community_reports ON public.community_reports;
CREATE POLICY allow_operator_select_community_reports ON public.community_reports
  FOR SELECT USING ((auth.jwt() ->> 'role') IN ('admin', 'operator', 'owner'));

DROP POLICY IF EXISTS allow_operator_manage_community_moderation ON public.community_moderation_actions;
CREATE POLICY allow_operator_manage_community_moderation ON public.community_moderation_actions
  FOR ALL USING ((auth.jwt() ->> 'role') IN ('admin', 'operator', 'owner'))
  WITH CHECK ((auth.jwt() ->> 'role') IN ('admin', 'operator', 'owner'));

ALTER TABLE public.dj_notifications
  DROP CONSTRAINT IF EXISTS dj_notifications_type_check,
  ADD CONSTRAINT dj_notifications_type_check CHECK (type IN (
    'challenge_received',
    'challenge_accepted',
    'challenge_declined',
    'challenge_cancelled',
    'challenge_expired',
    'challenge_converted_to_battle',
    'rematch_requested',
    'follow_started',
    'comment_received',
    'reply_received',
    'reaction_received',
    'moderation_update'
  ));

ALTER TABLE public.dj_notifications
  DROP CONSTRAINT IF EXISTS dj_notifications_category_check,
  ADD CONSTRAINT dj_notifications_category_check CHECK (category IN ('challenge', 'battle', 'relationship', 'community'));

ALTER TABLE public.dj_notification_mutes
  DROP CONSTRAINT IF EXISTS dj_notification_mutes_category_check,
  ADD CONSTRAINT dj_notification_mutes_category_check CHECK (category IN ('all', 'challenge', 'battle', 'relationship', 'community'));
