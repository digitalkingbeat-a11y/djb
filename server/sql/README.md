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
- 028_create_battle_crowd_votes.sql — creates `battle_crowd_votes` (one winner pick per listener per finished battle; writes go through the server)
- 029_create_profile_avatars_bucket.sql — creates the public `profile-avatars` storage bucket (512 KB JPG/PNG/WebP profile photos; uploads go through server-signed URLs)
- 030_create_practice_sessions.sql — creates `practice_sessions` (the full practice log on each DJ's account; writes go through the server)
- 031_create_battle_chat_messages.sql — creates `battle_chat_messages` (battle room chat between the two DJs) and lets chat messages and timed comments be reported
- 032_create_tournaments.sql — creates `dj_tournaments`, `dj_tournament_seats` and `dj_tournament_matches` (8- or 16-DJ knockout brackets; each match links to a normal battle)
- 033_create_result_timed_comments.sql — creates `result_timed_comments` (comments pinned to a moment of a public battle result)
