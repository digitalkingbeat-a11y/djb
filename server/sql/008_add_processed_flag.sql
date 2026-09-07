-- 008_add_processed_flag.sql
-- Adds a processed flag to telemetry_events so processing workers can mark handled rows

ALTER TABLE telemetry_events
  ADD COLUMN IF NOT EXISTS processed boolean DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_telemetry_processed ON telemetry_events(processed);
