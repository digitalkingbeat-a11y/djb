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
- 034_add_tournament_deadlines_host_controls.sql — adds round deadlines, no-show forfeits, scheduled start dates and cancel support to tournaments (apply after 033)
- 035_add_social_notification_types.sql — adds the tournament match, battle chat and timed comment notification types plus their Settings on/off switches (apply after 034)
- 036_create_direct_messages.sql — creates `direct_messages` (one-on-one DJ messages), lets them be reported, and adds the "New direct message" notification type (apply after 035)
- 037_add_dj_search_fields.sql — adds city, main genre and a "show me in search" switch to DJ profiles for Find DJs (apply after 036)
- 038_create_shared_crate_tracklists.sql — creates `shared_crate_tracklists` (public crate tracklists: title, artist, BPM and key only, never audio) (apply after 037)
- 039_create_practice_goals.sql — creates `practice_goals` (weekly practice goal per DJ, synced across devices) (apply after 038)
- 040_create_push_subscriptions.sql — creates `push_subscriptions` (phone lock-screen alerts: one row per device, with its chosen alert types; server only) (apply after 039)
- 041_create_result_review_requests.sql — creates `result_review_requests` ("Request a review" of a judged result) and adds the "judge finished reviewing" notification type (apply after 040)
- 042_create_account_deletion_requests.sql — creates `account_deletion_requests` (Delete my account with a 7-day grace period) (apply after 041)
- 043_create_crews.sql — creates `crews`, `crew_members` (one crew per DJ, up to 4) and `crew_battles` (2-vs-2 crew battles with combined scores) (apply after 042)
- 044_create_dj_tips.sql — creates `dj_tips` ("Tip a DJ" through Stripe Checkout) (apply after 043)
- 045_create_beat_discount_codes.sql — creates `beat_discount_codes` and `beat_discount_redemptions` (Beat Store discount codes) (apply after 044)
- 046_create_view_events.sql — creates `view_events` ("Who's watching" weekly views and sources; stores no visitor details) (apply after 045)
- 047_add_discount_code_reservations.sql — a discount code use now only counts after Stripe confirms payment (held while the buyer is on the checkout page, given back if it expires or fails) (apply after 046)
- 048_create_dj_invites.sql — creates `dj_invite_codes` and `dj_invite_joins` (personal invite-a-friend links with join counts) and adds the "A friend joined from your invite" notification type (apply after 047)
- 049_create_remix_contests.sql — creates `remix_contests`, `remix_contest_entries` and `remix_contest_votes` (remix contests with crowd voting), lets contests and remixes be reported, and adds the "Your remix won" / "Sell your winning remix?" notification types (apply after 048)
- 050_add_tournament_sizes_group_stage.sql — allows 4- and 32-DJ tournaments and adds the "group stage" format (`format`, `group_count`, match `stage`/`group_number`; group matches are round 0) (apply after 049)
- 051_create_beat_wishlist.sql — creates `beat_wishlist_items` (the Beat Store heart) and adds the `wishlist_alert` / `gift_received` notification types (apply after 050)
- 052_create_beat_gifts.sql — creates `marketplace_beat_gifts` (gift a beat at checkout, one-time hashed claim links) (apply after 051)
- 053_create_beat_share_links.sql — creates `marketplace_share_links` and `marketplace_share_events` (beat share links that credit the DJ who shared; visitors stored only as a salted hash) (apply after 052)
- 054_allow_m4a_mix_uploads.sql — lets the private `battle-mixes` bucket accept iPhone/Safari takes (audio/mp4, .m4a) (apply after 053)
- 055_add_profile_links.sql — adds `website_url` and `booking_info` to `dj_progression_profiles` (website link and booking info on public DJ profiles) (apply after 054)
