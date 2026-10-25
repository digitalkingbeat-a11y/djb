# DJ Battle Server

Express server for authenticated DJ Battle contracts: score submission, private mix uploads, judging results, battle prep snapshots, battle-room sync, rankings, community, challenges, and relationship workflows.

## Setup

1. Install dependencies:

```bash
cd server
npm install
```

2. Configure Supabase environment variables:

```bash
export SUPABASE_URL="https://your-project.supabase.co"
export SUPABASE_KEY="your-anon-key"
export SUPABASE_SERVICE_KEY="your-service-role-key"
node index.js
```

3. Apply the SQL migrations in `server/sql` for the contracts you enable.

4. Open http://localhost:4000. The server also serves the browser front end (an allowlist of `index.html`, root CSS/JS, `studio/`, and `judge/` files). Set `SERVE_FRONTEND=false` for API-only mode.

## Tests

```bash
npm test
```

The FFmpeg probe is optional and requires a working local FFmpeg binary:

```bash
npm run test:ffmpeg
```

## Notes

- Protected routes derive ownership from the verified Supabase token.
- Private audio paths and service credentials are never returned to public clients.
- Public result and leaderboard routes return sanitized rows only.

## Beat Store: paid sales (Stripe) and fan confirmation emails

Everything is configured with environment variables on the server. Never put keys in the code or the front end; the app only ever sees `GET /api/marketplace/storeConfig`, which returns on/off flags and the *names* of missing settings.

### Database

Run in the Supabase SQL editor (skip any already run): `sql/022_create_marketplace_player_foundation.sql`, `sql/023_create_marketplace_commerce_settlement.sql`, `sql/024_create_marketplace_free_email_leads.sql`.

### Paid sales with Stripe Connect

| Variable | Required | What it is |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | yes | Your platform's Stripe secret key (use a test-mode key first). |
| `STRIPE_WEBHOOK_SECRET` | yes | Signing secret of the webhook endpoint below. |
| `APP_PUBLIC_URL` | yes, unless you set the three URLs below | Public address of the app, e.g. `https://djbattle.example`. Used to build the default return URLs. |
| `MARKETPLACE_STRIPE_SUCCESS_URL` | optional | Where Stripe Checkout returns after payment. Default `APP_PUBLIC_URL/?checkout=success#store`. The server adds `order=<id>`. |
| `MARKETPLACE_STRIPE_CANCEL_URL` | optional | Where Checkout returns on cancel. Default `APP_PUBLIC_URL/?checkout=cancel#store`. |
| `STRIPE_CONNECT_RETURN_URL` | optional | Where sellers land after Stripe onboarding. Default `APP_PUBLIC_URL/?stripeConnect=return#store`. |
| `STRIPE_CONNECT_REFRESH_URL` | optional | Where an expired onboarding link sends sellers. Default `APP_PUBLIC_URL/?stripeConnect=refresh#store`. |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | optional | Signing secret of a separate *Connect* webhook endpoint (for `account.updated`), if you create one. |
| `MARKETPLACE_PLATFORM_FEE_BPS` | optional | Platform fee in basis points. Default `1000` (10%). |

Stripe dashboard steps:

1. Turn on **Connect** for your account (sellers onboard as Express accounts).
2. Add a webhook endpoint at `https://<your-server>/api/marketplace/webhooks/stripe` listening to `checkout.session.completed`, `checkout.session.expired`, `payment_intent.payment_failed`, `charge.refunded` and `charge.dispute.created`. Put its signing secret in `STRIPE_WEBHOOK_SECRET`.
3. Optional: add a Connect webhook (events on connected accounts) at the same URL for `account.updated`, and put its secret in `STRIPE_CONNECT_WEBHOOK_SECRET`. Without it, sellers' status still updates when they return from onboarding or press "Check status".

How it flows: the seller presses **Connect Stripe** (`POST /api/marketplace/sellerAccounts/onboard`) and finishes Stripe's hosted onboarding, then sets a price (`PATCH /api/marketplace/listings/:listingId/price`, US dollars, $0.99 to $500, MP3s with Original/Licensed/Royalty-free/Platform-cleared rights only). A buyer presses **Buy** (`POST /api/marketplace/checkout`) and pays on Stripe Checkout; the payment goes to the seller's connected account minus the platform fee. The signed webhook marks the order paid and grants the download, which the success page fetches with `POST /api/marketplace/downloads/access`. Sellers see orders and earnings at `GET /api/marketplace/sales`.

With `STRIPE_SECRET_KEY` (or the webhook secret, or the return URLs) missing, the app shows "Paid sales aren't set up on the server yet" and free downloads keep working.

### Fan confirmation emails

| Variable | Required | What it is |
| --- | --- | --- |
| `EMAIL_PROVIDER` | optional | `resend` or `sendgrid`. Picked automatically from whichever API key is set; `log` (default) only logs a masked address. |
| `RESEND_API_KEY` | with Resend | Resend API key. |
| `SENDGRID_API_KEY` | with SendGrid | SendGrid API key. |
| `EMAIL_FROM` | yes | Verified sender, e.g. `DJ Battle <beats@yourdomain.com>` (the domain must be verified with your provider). |
| `APP_PUBLIC_URL` | yes | The confirm link in the email points to `APP_PUBLIC_URL/?beatConfirm=1&lead=…&token=…#store`. |

When all of these are set, new free beats are created with confirmation required: fans get a "Confirm and download" email, the app calls `POST /api/marketplace/freeEmail/verify`, then downloads. Without them, claims stay instant and owners see those emails marked "Unconfirmed". Free beats listed before email was set up keep their original instant setting.

## Battle chat, tournaments, timed comments and embeds (Oct 19)

Run these in the Supabase SQL editor, in order, then redeploy the server:

- `server/sql/031_create_battle_chat_messages.sql` — battle room chat (and lets chat messages and timed comments be reported)
- `server/sql/032_create_tournaments.sql` — 8/16-DJ knockout tournaments (replaces the unmerged `028_create_tournaments.sql` draft on the `tranche11-tournament-foundation` branch; that draft was never applied)
- `server/sql/033_create_result_timed_comments.sql` — comments pinned to a moment of a public battle result

Until a file is applied, its feature answers `503` with the SQL file name, and the app shows a "needs the server" note.
The embed player (`embed.html`) is the only page the server lets other sites frame (`frame-ancestors *`); everything else keeps `X-Frame-Options: DENY`.

## Tournament deadlines, host controls, notifications, chat unsend and tournament wins (Oct 19b)

Run these in the Supabase SQL editor, in order (after 031–033 above), then redeploy the server:

- `server/sql/034_add_tournament_deadlines_host_controls.sql` — round deadlines (12 h, 24 h, 48 h default, 72 h or 1 week), no-show forfeits, an optional start date, and cancelled tournaments
- `server/sql/035_add_social_notification_types.sql` — the three new Activity-bell notification types and their Settings on/off switches

Important: tournaments need 034 once this version of the server is deployed. Creating or updating a tournament writes the new columns, so run 034 before (or right after) you redeploy.

How it works:

- **Deadlines and forfeits.** When a match becomes ready it gets a deadline (now + the round length). The bracket checks deadlines every time a tournament is opened. If time is up and only one DJ sent in a mix, that DJ wins by forfeit. If neither did, the higher seed goes through so the bracket keeps moving. If both did, it waits for the judges.
- **Host controls.** `PATCH /api/tournaments/:id` (name any time; start date and round length before it starts), `POST /api/tournaments/:id/remove` with `{ publicProfileId }` (frees the seat before the start, or forfeits that DJ's current match after), `POST /api/tournaments/:id/cancel`. Only the host can call these. When a start date passes and at least 2 DJs signed up, the bracket is drawn automatically.
- **Notifications.** Tournament match ready, battle chat messages (at most one per opponent every 10 minutes) and timed comments on your mix go to the Activity bell through the existing `dj_notifications` table (category `battle`). `GET`/`PUT /api/notificationPreferences/social` reads and sets the three switches; turning one off stores a mute row for that type.
- **Chat unsend.** `DELETE /api/battles/:battleId/chat/:messageId` (own messages only). No SQL needed; it uses the `deleted` status that 031 already allows.
- **Tournament wins.** `GET /api/me/tournaments` (how far you got in each), `GET /api/publicProfiles/:publicProfileId/tournaments` and `GET /api/tournamentChampions` (trophies in Rankings). No extra SQL.

No new environment variables are needed.

## Direct messages, Find DJs, live watching, shared tracklists and weekly goals (Oct 19c)

Run these in the Supabase SQL editor, in order (after 034–035 above), then redeploy the server:

- `server/sql/036_create_direct_messages.sql` — the `direct_messages` table, reporting for messages, and the "New direct message" notification type
- `server/sql/037_add_dj_search_fields.sql` — city, main genre and a "show me in search" switch on DJ profiles
- `server/sql/038_create_shared_crate_tracklists.sql` — public crate tracklists (title, artist, BPM and key only)
- `server/sql/039_create_practice_goals.sql` — one weekly practice goal per DJ

Until a file is run, the matching feature shows a friendly "needs setup" message instead of failing.

How it works:

- **Direct messages.** `GET /api/messages` (your conversations with unread counts), `GET /api/messages/:publicProfileId` (one conversation; marks it read), `POST /api/messages/:publicProfileId` with `{ body }` (up to 1000 characters, 10 per 30 s), `DELETE /api/messages/item/:messageId` (unsend your own). A block either way hides the conversation and stops sending. Muting a DJ keeps their messages but silences the Activity bell. Messages can be reported with `targetType: "direct_message"` by the person who received them.
- **Find DJs.** `GET /api/djs/search?q=&city=&genre=&belt=` (public, up to 50 results; private profiles, DJs who turned search off and blocked DJs are left out). `PUT /api/me/searchProfile` with `{ hometown, genre, searchable }`. Follow and Challenge use the existing endpoints.
- **Watch live.** `GET /api/liveBattles` and `GET /api/battles/:battleId/live` (public): each DJ's status, the watching count and a read-only copy of battle chat. Fans' browsers send `POST /api/battles/:battleId/watch` with a random viewer key every 20 s; the count is kept in server memory for 45 s, so it resets if the server restarts. Crowd voting (028) opens as soon as the battle finishes; fans vote with `POST /api/battles/:battleId/live/vote` and `{ publicProfileId }`, so the live page never sees auth user ids. Battle chat now tells DJs that fans can read it.
- **Shared tracklists.** `POST /api/sharedCrates` with `{ name, crateId, tracks:[{ title, artist, bpm, key }] }`; any other field (audio, artwork, file names, links) is dropped. `GET /api/sharedCrates/:id` (public), `GET /api/sharedCrates` (yours), `DELETE /api/sharedCrates/:id` (stop sharing). "Copy to my library" saves the tracks as a to-find list in that browser; it never copies audio.
- **Weekly goals.** `GET`/`PUT /api/practiceGoal` with `{ sessionsPerWeek }` (0–21; 0 turns it off). Progress comes from the practice log and resets every Monday; each week you hit the goal adds to your goal streak.

No new environment variables are needed.
