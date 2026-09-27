# Tournament Tranche 11 checkpoint

Migration `server/sql/028_create_tournaments.sql` is staged for review, not applied to a live Supabase project. It creates private tournament, seat and match tables. The service-role-only `claim_tournament_seat` RPC serializes claims under a tournament row lock, returns the same seat on retry, and creates all seven bracket positions when seat eight is claimed.

The pure `server/tournaments.js` contract seeds and advances an eight-seat single-elimination bracket. It is not yet connected to routes or the UI. Do not expose raw tournament rows in browser responses: they contain auth user IDs. Map participants to approved public profiles in the server API.

Next work: protected create/join/read endpoints, validated battle creation for each ready match, authoritative result reconciliation and atomic winner advancement, notifications and recovery, tournament UI, and live database concurrency tests. The earlier forum-to-battle live integration still needs two real magic-link sessions and its Supabase environment.

Local checks on this checkpoint: 262 server passing, 2 optional FFmpeg probes pending; 153 frontend passing; frontend build passed. SQL was inspected through contract tests but not executed against Supabase.
