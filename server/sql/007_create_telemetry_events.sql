-- 007_create_telemetry_events.sql
-- Stores raw telemetry events emitted by DJ Battle Bridge adapters for Mode 1 scoring

CREATE TABLE IF NOT EXISTS telemetry_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  session_id text,
  battle_id text,
  timestamp timestamptz DEFAULT now(),
  event_type text,
  payload jsonb DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_telemetry_user ON telemetry_events(user_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_session ON telemetry_events(session_id);
CREATE INDEX IF NOT EXISTS idx_telemetry_battle ON telemetry_events(battle_id);
