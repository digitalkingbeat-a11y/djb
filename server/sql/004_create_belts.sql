-- 004_create_belts.sql
-- Adds belts, belt_tests, user_belts, belt_attempts tables

CREATE TABLE IF NOT EXISTS belts (
  code text PRIMARY KEY,
  name text NOT NULL,
  "order" int NOT NULL,
  min_score int NOT NULL DEFAULT 0,
  meta jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS belt_tests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text,
  code text NOT NULL,
  name text NOT NULL,
  criteria jsonb NOT NULL,
  passing_score int NOT NULL,
  test_type text,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS user_belts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  belt_code text NOT NULL REFERENCES belts(code),
  dan_level int DEFAULT 0,
  awarded_at timestamptz DEFAULT now(),
  evidence jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS belt_attempts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id text NOT NULL,
  test_id uuid REFERENCES belt_tests(id),
  score numeric NOT NULL,
  passing_score numeric,
  breakdown jsonb DEFAULT '{}'::jsonb,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE user_belts ENABLE ROW LEVEL SECURITY;
ALTER TABLE belt_attempts ENABLE ROW LEVEL SECURITY;
ALTER TABLE belt_tests ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_belt_tests" ON belt_tests
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_belt_attempts" ON belt_attempts
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE POLICY "allow_select_own_user_belts" ON user_belts
    FOR SELECT USING (user_id = auth.uid()::text);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE belt_tests ADD COLUMN IF NOT EXISTS test_type text;
ALTER TABLE belt_tests ADD COLUMN IF NOT EXISTS user_id text;
ALTER TABLE belt_attempts ADD COLUMN IF NOT EXISTS passing_score numeric;

-- Insert default belts from definitions.json (synchronously applied in deployment)
