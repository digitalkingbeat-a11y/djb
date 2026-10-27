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

## Lock-screen alerts, Add to calendar, DJ software import, result reviews and my data (Oct 20)

Run these in the Supabase SQL editor, in order (after 036–039 above), then redeploy the server:

- `server/sql/040_create_push_subscriptions.sql` — one row per device that turned on lock-screen alerts, with the alert types it chose
- `server/sql/041_create_result_review_requests.sql` — "Request a review" of a judged result, plus the "A judge finished reviewing your result" notification type
- `server/sql/042_create_account_deletion_requests.sql` — "Delete my account" with a 7-day grace period

Until a file is run, the matching feature shows a friendly "needs setup" message instead of failing. Never run the old `028_create_tournaments.sql` from the tournament foundation branch; `032_create_tournaments.sql` replaced it.

### New environment variables (lock-screen alerts only)

Lock-screen alerts use "VAPID" keys: a public/private key pair that proves alerts come from your server. Make them once on your own computer (not in chat, never committed to git):

```
cd server
npx web-push generate-vapid-keys
```

It prints a **Public Key** and a **Private Key**. In your server host's environment settings add:

- `VAPID_PUBLIC_KEY` — the Public Key
- `VAPID_PRIVATE_KEY` — the Private Key (keep it secret)
- `VAPID_SUBJECT` — `mailto:` plus an email address you read, e.g. `mailto:Digitalkingbeat@gmail.com` (push services contact this address if something goes wrong; if you leave it out, `EMAIL_FROM` is used)

Then redeploy. Keep the same keys forever: changing them signs every device out of alerts, and DJs have to switch them on again. Nothing else in the app needs a key.

### How it works

- **Lock-screen alerts.** Settings → Phone alerts has an on/off switch for this device plus a checkbox per alert type: tournament match ready, battle chat message, comment on your mix, direct message, and new/accepted challenge. They are the same events as the Activity bell (Oct 19b), so a type switched off under Notifications sends no alert either. `GET /api/push/config` (public: whether the server is set up, the public key and the types), `GET`/`POST`/`DELETE /api/push/subscriptions` (signed in; up to 10 devices), `POST /api/push/test`. Alerts say who it's from but never the message text. Devices that uninstall or block alerts are forgotten automatically. **iPhone:** alerts only work after the DJ adds DJ Battle to the Home Screen (Share → Add to Home Screen) and opens it from there (iOS 16.4+); the Settings panel says so.
- **Add to calendar.** "📅 Add to calendar" next to battle start times / submission deadlines, challenge respond-by deadlines and tournament round deadlines. It offers Google Calendar, Outlook and an `.ics` file (Apple Calendar and everything else), with a 30-minute reminder. Runs entirely in the browser; no setup.
- **Import from Rekordbox / Serato.** Music Library → "Import from Rekordbox / Serato", or Battle Studio → "Import Rekordbox / Serato". Rekordbox: File → Export Collection in xml format; brings in playlists, names, BPMs, keys, hot cues and memory cues. Serato: pick a `.crate` file from `Music/_Serato_/Subcrates`; Serato keeps BPM, key and cues inside the audio files, so those are filled in from tracks already in your library with the same file name. Audio is never copied: tracks you already uploaded are matched (same file name, or same title and artist); the rest show as "needs audio" until you upload them. Runs in the browser; no setup.
- **Request a review.** Profile → battle history → "Request a review" on a judged result. The DJ picks a reason and can add a note; the result shows "⚖ Under review". `POST /api/battleResults/:submissionId/review`, `GET /api/resultReviews/mine`. Operators see the queue at the bottom of Judging Operations (`GET /api/operations/resultReviews`) and confirm the score or rescore it 0–100 (`POST /api/operations/resultReviews/:id/decision`); the DJ gets an Activity-bell notification. One open review per result, two reviews per result at most.
- **Download my data.** Settings → My data & account → "Download my data" saves one `.json` file with everything stored for the account (profile, results, library, crates, practice, messages, comments, follows, purchases, review requests) plus this device's settings. Other DJs' account ids are replaced with `other-dj`, and secrets (payment ids, push keys, tokens) are left out. Audio files are not inside it. `GET /api/account/export`.
- **Delete my account.** The DJ types `DELETE MY ACCOUNT`; deletion is scheduled 7 days out and a banner with "Keep my account" shows on every page until then (`GET`/`POST`/`DELETE /api/account/deletion`). The server checks hourly; when the 7 days are up it deletes the DJ's mix audio, their rows in every app table and their sign-in account, using the existing `SUPABASE_SERVICE_KEY`. Sales records (`marketplace_orders`) are kept for tax/legal reasons with the account gone.

## Crews, Tip a DJ, discount codes, Who's watching and beatmatching lessons (Oct 20b)

This builds on the Oct 20 changes above (PRs #30, #31 and #32 must be merged first). Run these in the Supabase SQL editor, in order (after 040–042), then **redeploy the server**:

- `server/sql/043_create_crews.sql` — crews, crew members (one crew per DJ, up to 4) and 2-vs-2 crew battles
- `server/sql/044_create_dj_tips.sql` — tips sent through Stripe
- `server/sql/045_create_beat_discount_codes.sql` — Beat Store discount codes and a log of each use
- `server/sql/046_create_view_events.sql` — "Who's watching" view log (no visitor details stored)

Until a file is run, the matching feature shows a friendly "needs setup" message instead of failing. As always, never run the old `028_create_tournaments.sql` from the tournament foundation branch.

**No new keys.** Tips and discount codes use the Stripe settings you already have for the Beat Store (`STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `APP_PUBLIC_URL`) and the same webhook address `/api/marketplace/webhooks/stripe`. Make sure that webhook sends `checkout.session.completed` and `checkout.session.expired` (it already does if you followed the Beat Store steps).

### How it works

- **Crews.** New "Crews" page. A DJ starts a crew with a name and a logo (an emoji on a colour, or an https image link) and gets an 8-character join code to share; up to 4 DJs, one crew per DJ. The owner can remove DJs or make a new code; if the owner leaves, the longest-standing member takes over, and the last one out deletes the crew. Crew rankings: win = 3 points, draw = 1. `GET /api/crews` (rankings, public), `GET /api/crews/mine`, `GET /api/crews/:id` (crew page, public), `POST /api/crews`, `POST /api/crews/join`, `PATCH /api/crews/:id`, `POST /api/crews/:id/leave`, `DELETE /api/crews/:id/members/:publicProfileId`.
- **2-vs-2 crew battles.** A crew member challenges another crew (with 2+ DJs) and picks two of their DJs; the other crew accepts by picking its two (or declines). Each of the four DJs then sends one of their own judged mixes, and each side's score is the two judged scores added together. When all four are in, the higher total wins and rankings update. Blocked DJs can't be challenged. `POST /api/crewBattles`, `POST /api/crewBattles/:id/respond`, `POST /api/crewBattles/:id/submit`.
- **Tip a DJ.** A "💸 Tip" button on public DJ profiles and public battle results: $2, $5 or any amount from $1 to $500, plus an optional note. The fan pays on Stripe's checkout page and the money goes straight to the DJ's connected Stripe account (DJ Battle takes no cut; Stripe's normal card fee applies). Only DJs who finished Stripe payouts setup in the Beat Store can receive tips; the button explains this otherwise. DJs see their tips on their Profile. `GET /api/tips/config`, `GET /api/tips/eligibility/:publicProfileId`, `POST /api/tips/checkout`, `GET /api/tips/mine`.
- **Discount codes.** Beat Store → Your beats → Discount codes: a code like `BATTLE20` for a percent off (1–90%) or a dollar amount off, with an optional end date and usage limit; codes can be turned off and on. Buyers tap "Have a code?" on a beat, see the new price, and Stripe charges the discounted price. The server works out the discount itself (never trusting the browser) and the price can't go below $0.50. `GET`/`POST /api/marketplace/discountCodes`, `PATCH /api/marketplace/discountCodes/:id`, `POST /api/marketplace/listings/:id/discountPreview`, and `discountCode` on `POST /api/marketplace/checkout`.
- **Who's watching.** Profile → "Who's watching": views this week of your public profile, public battle results and Beat Store beats, the trend vs last week, an 8-week chart and where visitors came from (Instagram, TikTok, search, direct…). It uses the existing view counters (`/api/publicProfiles/:id/views`, `/api/publicBattleResults/:id/views`) plus a new `POST /api/marketplace/listings/:id/views` (a beat counts as viewed when it's shown in the Store, once per visitor per 30 minutes). Only a rough source bucket is stored, never the visitor's IP, device or id. Views from before 046 is run aren't in the chart. `GET /api/insights/views`.
- **Beatmatching lessons.** Battle Studio → Learn. Runs entirely in the browser with synthesized sound (no audio files, nothing to license); see the main README. No setup.

## Passkeys

DJs can sign in with a fingerprint, Face ID or their phone's screen lock instead of waiting for an email link. The email magic link keeps working for everyone and is always the fallback.

**How it works:** this uses Supabase Auth's own passkey (WebAuthn) support. Supabase stores the passkeys, checks them and creates the sign-in session, so the DJ Battle server needs **no new code, no new environment variables and no new SQL** for this. The browser talks to Supabase directly (`supabase-js` 2.112.3, with `auth.experimental.passkey` switched on in `index.html`). Supabase marks passkeys as *experimental*, so the API could change in a later release.

**One-time setup in the Supabase dashboard:**

1. Open your project → **Authentication → Passkeys** and turn on **Enable Passkey authentication**.
2. Fill in the WebAuthn details:
   - **Relying Party Display Name:** `DJ Battle`
   - **Relying Party ID:** the bare domain the app runs on, with no `https://` and no path. For the GitHub Pages site that is `digitalkingbeat-a11y.github.io`. If you move the app to your own domain later, use that domain instead.
   - **Relying Party Origins:** every address the app is opened from, comma-separated (up to 5), for example `https://digitalkingbeat-a11y.github.io,http://localhost:8080`. Origins have no path (not `/djb`). Each one must be on the Relying Party ID domain, except `localhost` for testing.
3. Save. Nothing needs redeploying.

**Important:** passkeys are locked to the Relying Party ID. If you change it later (for example when moving to a custom domain), every existing passkey stops working and DJs need to add a new one under Settings → Security (their email link still works in the meantime). It's best to pick the final domain before many DJs add passkeys.

**Where DJs find it:** Settings → Security → *Add a passkey on this device* (must be signed in with the email link first). The list shows each passkey's device name, the date it was added and when it was last used, with Rename and Remove. The sign-in window shows **Sign in with passkey** only in browsers that support it. It works in the installed phone app (home-screen app) on iPhone and Android, because the passkey belongs to the site's domain.

## Discount codes count after payment, and invite-a-friend links (Oct 20c)

**Run these in Supabase (SQL editor), in order, after the Oct 20b files (043–046):**

1. `sql/047_add_discount_code_reservations.sql`
2. `sql/048_create_dj_invites.sql`

Both are safe to run more than once. No new keys or environment variables.

**Discount codes:** a code use is now only counted once Stripe confirms the payment (`checkout.session.completed`). While the buyer is on the Stripe page the use is *held*, so a code with a limit can't be oversold. The hold is given back when Stripe sends `checkout.session.expired` or a payment failure, if creating the Stripe page fails, or automatically after 24 hours. A repeated webhook never counts a use twice. Uses recorded before 047 stay counted. Until 047 is run, checkouts that use a code show "Discount codes need a quick server update (SQL 047)".

**Invite links:** Profile → *Invite friends* shows each DJ's personal link (`…/?invite=CODE`) with Copy / Share, how many friends joined and a badge (🤝 Connector at 1, 📣 Crew Recruiter at 3, 🌟 Scene Builder at 10, 👑 DJ Battle Ambassador at 25). Someone opening the link sees "DJ X invited you"; the code is remembered for 30 days in that browser and claimed right after they sign in. Only accounts created in the last 14 days count, each new DJ counts once, and your own link never counts. The inviter gets an Activity-bell alert ("… joined DJ Battle from your invite link"). Routes: `GET /api/invites/mine`, `POST /api/invites/claim`, `GET /api/invites/:code` (public, shows the inviter's DJ name only).

## Remix contests

**Run this in Supabase (SQL editor) after the Oct 20c files (047–048):** `sql/049_create_remix_contests.sql`. Safe to run more than once. No new keys or environment variables. Then redeploy the server.

**How it works:** the **Remix Contests** page (side menu) lists contests. Any signed-in DJ or producer can press *Host a contest*, give it a title and description, upload the full track or its parts (stems, up to 12 audio files), say how they have the rights (the same choices the Beat Store accepts: original, licensed, royalty-free, cleared by DJ Battle), tick the rights confirmation, and pick a submission deadline and a voting deadline (at least 24 hours each; submissions within 90 days, voting at most 30 days). The contest stays a draft until every part has finished uploading, then goes live.

- **Remixers** (signed in) download the parts through short-lived links and send one remix each (audio file, title, notes). They can replace or withdraw it until submissions close. Hosts can't enter their own contest.
- **Voting** opens automatically when submissions close and runs with a countdown until the voting deadline. One vote per account, never for your own remix. Vote counts stay hidden until voting closes.
- **Winner:** most votes wins; a tie goes to the remix that was sent first. The winner gets an Activity-bell alert and the 🎛️ **Remix Champion** badge (on their Profile and next to their name in Rankings). Contests are closed out every 15 minutes and whenever someone opens them.
- **Host controls:** edit the title, description or dates, or cancel, only until the first remix arrives.
- **Beat Store:** after the contest, the host can ask the winner to sell the winning remix (price $1–$500). The winner gets an alert and answers yes or no on the contest page. Only after a yes can the host list it. The winner is the seller, so sales go to the winner's Stripe payouts (the normal Beat Store Stripe setup applies).
- **Reports:** contests and remixes have a *Report* button that feeds the existing community report queue (`GET /api/community/reports`). Moderators can hide or restore a remix with `POST /api/remix-contests/entries/:entryId/moderate` `{ "action": "hide" | "restore" }`. Hidden remixes can't get votes or win.
- **Privacy:** pages show DJ names and public profile ids only, never account ids or storage paths. Audio files live in the private `battle-mixes` bucket under `private/battle-entries/remix-contests/`, and the browser only ever gets signed links that expire after 10–15 minutes.

Routes: `GET /api/remix-contests`, `POST /api/remix-contests`, `GET|PATCH /api/remix-contests/:id`, `POST /api/remix-contests/:id/publish`, `/cancel`, `/parts/:partId/download`, `/entry` (+ `/entry/complete`, `DELETE /entry`), `/entries/:entryId/play`, `/vote`, `/store-offer`, `/store-consent`, `/store-listing`; `GET /api/remix-contests/champions`, `GET /api/me/remix-contests`.

## Oct 25 Studio

- **No new SQL.** Favourite stars, private track notes and play counts for server-backed My Uploads tracks are stored in the existing `music_library_tracks.usage_relationships` jsonb column under `prefs` (only returned to the track owner). Do not apply `028_create_tournaments.sql`.
- New route: `POST /api/musicLibrary/tracks/:trackId/prefs` (auth required). Body: `{ favourite, note, playCount, lastPlayedAt, editedAt }`. Merge rule: newest `editedAt` wins for favourite/note; play count only goes up.
- Battle Library tracks, recently played, "played this set", beat jump size, slip and key shift are saved on the device only (localStorage `djBattleTrackPrefs`, `djBattleCurrentSet`).
- After merge: redeploy the server so the new route exists. No keys or env vars change.

## Oct 25 Store

Five Beat Store and tournament upgrades. Front end: `beat_store_five.js` (+ styles in `social.css`); server: `store_five.js`, `beat_gifts.js`, plus changes in `tournaments.js`, `marketplace_commerce.js`, `marketplace_foundation.js`, `push_alerts.js` and `social_notifications.js`.

1. **Licence per beat.** Sellers pick one of three licences (from `RIGHTS_LICENSE_TYPES`): *Battle use only* (`battle_use`), *Use in your own releases* (`creator_license`) or *Royalty-free* (`royalty_free_use`). Buyers see the terms in plain words and must tick them before Stripe. A snapshot of the terms is stored in the order's `provider_metadata.licence` and shown in **My purchases → Receipt & licence**. `GET /api/marketplace/licences`, `PATCH /api/marketplace/listings/:id/licence` (owner only; licensed music can't be offered royalty-free).
2. **Short previews.** `POST /api/marketplace/listings/:id/preview` `{ startSeconds?, lengthSeconds 30–60, voiceTag }` cuts a clip with ffmpeg on the server (start picked by the seller, or about 30% in) and stores it under `private/marketplace-previews/`. The optional spoken "DJ Battle" tag is `server/assets/dj-battle-voice-tag.wav`, generated by us (no third-party audio). Non-owners only ever get a signed URL for that clip; the old client-set preview path to the full library file is no longer accepted.
3. **Tournaments.** Sizes 4, 8, 16 and 32, plus a **Groups, then knockout** format: round-robin groups of about four (3 points a win; ties by head-to-head, then fewer forfeits, then seed), the top two from each group go into a cross-seeded knockout. Deadlines, forfeits, Remove a DJ, Edit and Cancel work in both stages.
4. **Wishlist heart.** ♡ on each card. A price drop or a new live discount code sends an in-app alert and a push (`wishlist_alert`), switchable in Settings. `GET/POST/DELETE /api/marketplace/wishlist[/:listingId]`.
5. **Gift at checkout.** Tick "Send it as a gift", add their email and a message, then pay with Stripe as usual. When the payment webhook arrives, the existing email sender sends a one-time claim link (only a SHA-256 of the token is stored; it expires after 365 days and can be claimed once). It lands in their purchases when they sign in with that email (`POST /api/marketplace/gifts/claim`, auto-claim via `GET /api/marketplace/gifts/inbox` for verified emails). Refunds and disputes cancel the gift and take back access.

**Dan's steps after merging**

1. In the Supabase SQL editor, run in order: `server/sql/050_add_tournament_sizes_group_stage.sql`, `051_create_beat_wishlist.sql`, `052_create_beat_gifts.sql`. Do **not** run the old tranche11 `028_create_tournaments.sql`.
2. Make sure `APP_PUBLIC_URL` and the email sender settings (`EMAIL_PROVIDER` plus its API key and from address) are set on the server; gift emails use them.
3. Make sure ffmpeg is available on the server (the existing ffmpeg check in `/health` must say it's ready) so previews can be cut.
4. Redeploy the server, then the site. Sellers re-open **Your beats → Make preview** to create clips for paid beats.
