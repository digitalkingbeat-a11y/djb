-- Oct 20: "Delete my account" with a 7-day grace period. One row per DJ; the server deletes the
-- account once scheduled_for has passed, unless the DJ cancelled. Apply after 041. Safe to re-run.
CREATE TABLE IF NOT EXISTS public.account_deletion_requests (
  user_id uuid PRIMARY KEY,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled','cancelled','completed')),
  requested_at timestamptz NOT NULL DEFAULT now(),
  scheduled_for timestamptz NOT NULL,
  cancelled_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS account_deletion_requests_due_idx ON public.account_deletion_requests (status, scheduled_for);
ALTER TABLE public.account_deletion_requests ENABLE ROW LEVEL SECURITY;
