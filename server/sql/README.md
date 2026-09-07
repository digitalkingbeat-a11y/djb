Supabase SQL migrations for DJ Battle

Files
- 001_create_ai_scores.sql  — creates `ai_scores` table and RLS policies for authenticated inserts and public selects
- 002_create_battle_rankings.sql — creates `battle_rankings` table (server-maintained) and RLS policy that allows the Supabase service role to modify rows
- 003_views_and_aggregates.sql — creates `ai_leaderboard` and `battle_rankings_public` views and grants public SELECT

Applying the migrations
1. In the Supabase project, open the SQL editor (SQL > Editor) and paste each file in order, or upload them.
2. Alternatively, use the `supabase` CLI to run SQL files locally against your project.

Notes & security
- The `ai_scores` table allows authenticated users to INSERT only for their own `user_id` (RLS check: `auth.uid() = user_id`).
- The `ai_leaderboard` view is granted public SELECT so everyone can see aggregated leaderboard data.
- `battle_rankings` is intended to be updated by a trusted server process using the Supabase service role key. The SQL policy provided allows operations from `auth.role() = 'service_role'`.

Recommended next steps
- Create a small server endpoint (Node/Express) that uses the Supabase service role to update `battle_rankings` after validating AI + community votes from battle submissions.
- Add Row Level Security (RLS) conditions for specific admin roles if you want delegated editing (e.g., `is_admin` claim).
- For privacy, consider anonymizing or limiting fields exposed in the public views.

If you want, I can also produce the exact `supabase` CLI commands or an automated migration script next.
