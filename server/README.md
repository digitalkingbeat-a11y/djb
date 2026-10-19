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
