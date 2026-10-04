# DJ Battle Platform

A dependency-free browser DJ battle platform with battle discovery, Battle Studio, a central music library, community, rankings, verified results, and guarded server contracts.

## Run It

The front end is plain HTML/CSS/JS. All API calls go through `api_client.js` to `/api/...` on the
**API base URL** (`window.DJB_API_BASE`). The Node/Express server in `server/` runs on port 4000.

### Recommended: one server for app + API

```bash
cd server
npm install
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_KEY="your-anon-key"
export SUPABASE_SERVICE_KEY="your-service-role-key"
npm start
```

Open http://localhost:4000. The server serves the front end (only `index.html`, root CSS/JS, `studio/`,
and `judge/` files) and the API from the same origin, so no API base URL is needed. Set
`SERVE_FRONTEND=false` to run the server as API-only.

### Front end served separately

1. Copy `supabase-browser-config.example.js` to `supabase-browser-config.local.js` (git-ignored).
2. Fill in the browser-safe Supabase URL and anon key to enable Sign In.
3. Set `window.DJB_API_BASE = 'http://localhost:4000';` so API calls reach the server.
4. Serve this folder, for example `npx serve .` or VS Code Live Server, and start the server as above.

Opening `index.html` straight from disk (`file://`) defaults the API base to `http://localhost:4000`.

### Offline demo data

If the server can't be reached, or Supabase sign-in isn't configured, the app keeps working with
built-in sample battles, posts, and rankings and shows an **Offline demo data** banner. Changes made
in that mode are stored only in this browser. Without Supabase config, Sign In explains that sign-in
is not configured.

## Current Product Surface

- Compact battle discovery with filters, battle formats, matchmaking, and battle-room recovery
- Battle Studio with Deck A, Mixer, Deck B, recording workflow, controller scan, and audio setup
- Studio-scoped music browser for My Music, streaming metadata, and playlists
- M3U, M3U8, and CSV playlist import/export
- Central Music Library for uploaded tracks, crates, artwork, compatibility search, and battle prep
- Community feed with post/comment/reaction workflows and server-backed categories
- Rankings, verified public results, private progression detail, and public DJ profiles
- Activity, profile, settings, and virtual tour navigation
- Server-side authentication, submission lifecycle, judging worker, award ledger, and public leaderboard contracts

## Capability Boundaries

- Streaming connections are metadata-oriented unless a provider SDK, OAuth scope, and license explicitly allow deck playback.
- Browser-loaded local files can be used in Studio but file handles do not survive a refresh.
- Recording uses Web Audio and MediaRecorder where the browser supports them. Stopping creates a reviewable take; submitting is a separate user action.
- Bitcoin reward metadata is tracked as metadata only. Custody and transfers stay outside this platform.
- Protected writes require authenticated server routes and safe ownership checks.

## Tests

```bash
npm test
cd server
npm test
```

The Playwright smoke test expects the static app to be served at `http://127.0.0.1:8080/index.html`.

## Core Objects

- users
- profiles
- media_assets
- tracks
- playlists/crates
- battles
- battle_rules
- battle_track_assignments
- entries
- mix_submissions
- judge_breakdowns
- final_scores
- forum_posts
- comments
- follows
- judge_xp
- subscriptions/entitlements

Keep AI, community, and expert scores separate. Calculate final hybrid scores from stored components so weighting can change later without destroying historical judging data.
