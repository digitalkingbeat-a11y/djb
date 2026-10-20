-- Oct 19b: Activity-bell notifications for tournament matches, battle chat and timed comments.
-- Apply after 034. Adds the new notification types to dj_notifications and lets DJs switch each
-- one off in Settings (stored as a dj_notification_mutes row for that type). Safe to re-run.
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
    'moderation_update',
    'mention_received',
    'tournament_match_ready',
    'battle_chat_message',
    'timed_comment_received'
  ));

ALTER TABLE public.dj_notification_mutes
  DROP CONSTRAINT IF EXISTS dj_notification_mutes_notification_type_check,
  ADD CONSTRAINT dj_notification_mutes_notification_type_check CHECK (
    notification_type IS NULL OR notification_type IN (
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
      'moderation_update',
      'mention_received',
      'tournament_match_ready',
      'battle_chat_message',
      'timed_comment_received'
    )
  );
