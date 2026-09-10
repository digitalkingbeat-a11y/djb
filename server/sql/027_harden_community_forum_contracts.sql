-- 027_harden_community_forum_contracts
-- Additive hardening for Tranche 9 server-backed Community forum contracts.
-- Apply after 020_create_community_forum.sql. This migration does not alter
-- commerce, marketplace entitlement, settlement, payment or payout tables.

-- Preserve one active reaction per user per target before enforcing the index.
WITH ranked_reactions AS (
  SELECT
    id,
    row_number() OVER (
      PARTITION BY user_id, target_type, target_id
      ORDER BY active DESC, updated_at DESC, created_at DESC, id DESC
    ) AS reaction_rank
  FROM public.community_reactions
  WHERE active IS TRUE AND removed_at IS NULL
)
UPDATE public.community_reactions reaction
SET active = false,
    removed_at = COALESCE(reaction.removed_at, now()),
    updated_at = now()
FROM ranked_reactions ranked
WHERE reaction.id = ranked.id
  AND ranked.reaction_rank > 1;

DROP INDEX IF EXISTS community_reactions_unique_active_target_idx;

CREATE UNIQUE INDEX IF NOT EXISTS community_reactions_one_active_per_target_idx
  ON public.community_reactions(user_id, target_type, target_id)
  WHERE active IS TRUE AND removed_at IS NULL;

CREATE INDEX IF NOT EXISTS community_posts_feed_stable_order_idx
  ON public.community_posts(status, visibility, category_id, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS community_comments_thread_stable_order_idx
  ON public.community_comments(post_id, parent_comment_id, created_at, id);

CREATE INDEX IF NOT EXISTS community_reports_reporter_queue_idx
  ON public.community_reports(reporter_user_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS community_moderation_actions_operator_idx
  ON public.community_moderation_actions(operator_user_id, created_at DESC);

ALTER TABLE public.community_posts
  DROP CONSTRAINT IF EXISTS community_posts_no_private_attachment_paths,
  ADD CONSTRAINT community_posts_no_private_attachment_paths CHECK (
    attachments::text !~* '(storage_object_path|storageObjectPath|signedUrl|privateUrl|downloadAccessToken|private/library-audio|private/battle-entries|private/marketplace)'
  );

DROP POLICY IF EXISTS allow_select_public_community_comments ON public.community_comments;
CREATE POLICY allow_select_public_community_comments ON public.community_comments
  FOR SELECT USING (
    status IN ('active', 'deleted')
    AND EXISTS (
      SELECT 1 FROM public.community_posts p
      WHERE p.id = community_comments.post_id
        AND p.visibility = 'public'
        AND p.status IN ('active', 'locked')
    )
  );

DROP POLICY IF EXISTS allow_operator_update_community_reports ON public.community_reports;
CREATE POLICY allow_operator_update_community_reports ON public.community_reports
  FOR UPDATE USING ((auth.jwt() ->> 'role') IN ('admin', 'operator', 'owner'))
  WITH CHECK ((auth.jwt() ->> 'role') IN ('admin', 'operator', 'owner'));

COMMENT ON TABLE public.community_posts IS
  'Server-backed DJ community posts. Server responses must sanitize attachments and never expose private storage paths, emails, tokens or unpublished media.';

COMMENT ON TABLE public.community_reactions IS
  'Forum reactions. Application code and community_reactions_one_active_per_target_idx enforce one active reaction per user per post/comment target.';

COMMENT ON TABLE public.community_reports IS
  'User-generated reports visible to moderators/operators only. Public responses must not expose reporter private data.';

COMMENT ON TABLE public.community_moderation_actions IS
  'Append-only moderator audit history for community forum moderation decisions.';

COMMENT ON INDEX community_reactions_one_active_per_target_idx IS
  'Guarantees one active reaction per authenticated user per community target while preserving inactive reaction history.';
