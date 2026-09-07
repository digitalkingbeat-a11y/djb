-- 006_create_judge_breakdowns.sql
-- Stores judge breakdown summaries and per-event details for each performance

CREATE TABLE IF NOT EXISTS judge_breakdowns (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  battle_id text,
  recorded_at timestamptz DEFAULT now(),
  duration numeric,
  meta jsonb DEFAULT '{}'::jsonb,
  per_event jsonb DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_judge_user ON judge_breakdowns(user_id);
CREATE INDEX IF NOT EXISTS idx_judge_battle ON judge_breakdowns(battle_id);
