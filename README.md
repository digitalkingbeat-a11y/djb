# DJ Battle Platform

A dependency-free browser DJ battle platform with battle discovery, Battle Studio, a central music library, community, rankings, verified results, and guarded server contracts.

## Run It

### Open Directly
Open `index.html` in a modern browser.

### Local Server
From this folder:

```bash
npx serve .
```

or use the VS Code Live Server extension.

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
