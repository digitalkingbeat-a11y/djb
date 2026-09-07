-- 005_create_timing_analysis.sql
-- Stores timing analysis events and summaries for audits and improvement tracking

CREATE TABLE IF NOT EXISTS timing_analysis (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  battle_id text,
  recorded_at timestamptz DEFAULT now(),
  duration numeric,
  meta jsonb DEFAULT '{}'::jsonb,
  events jsonb DEFAULT '[]'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_timing_user ON timing_analysis(user_id);
CREATE INDEX IF NOT EXISTS idx_timing_battle ON timing_analysis(battle_id);
