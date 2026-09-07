# DJ Battle Platform Audit and Extension Plan

Date: 2026-09-02

## Scope and Decision Record

This audit covers the existing DJ battle application and the requested expansion to producer beat battles, marketplace products, email-gated downloads, payments, voting, tournaments, and seller payouts.

Marketplace payout model: sellers connect their own Stripe accounts through Stripe Connect. Buyer checkout, seller onboarding, payout accounting, refunds, disputes, tax obligations, and digital delivery must remain separate server-side concerns.

No runtime behavior is changed by this document.

## Already Implemented

### Authentication, ownership, and storage

- Supabase token authentication and server-side ownership enforcement for protected operations.
- Private audio storage, server-issued signed upload URLs, upload verification by size and MIME type, and short-lived owned playback access.
- Music-library metadata with rights classification, visibility, source type, audio linkage, artwork, crates, ordered memberships, and private cache protections.
- Existing rights classifications include `original`, `licensed`, `royalty_free`, `platform_cleared`, `commercial_copyrighted`, and `unknown`.

### DJ battles and submissions

- Battle records, entries, immutable prep snapshots, room state, capacity enforcement, presence, start state, deadlines, resolution, and progression awards.
- Compact horizontal battle lobby rows with participant count and capacity, plus current battle filters and sorting.
- Capacity concurrency protection in the database and server join logic. Current database capacity is $1 \ldots 16$; the requested $32$/$64$ capacities are not supported yet.
- A common `mix_submissions` lifecycle and protected upload/judging pipeline suitable for both externally uploaded mixes and Battle Studio recordings.
- Battle Studio with two visible desktop decks, mixer, recording workflow, browser, private local-file loading, controller scan, and audio setup.

### DJ judging, results, and profiles

- Measured DJ judging includes timing, beat alignment, Phrase Mixing, transition quality, frequency overlap, gain, clipping, EQ, harmonic compatibility, and other evidence-backed components.
- Phrase Mixing already calculates phrase-boundary offset in beats and records inferred or documented fallback phrase structure. No neutral score is fabricated when evidence is missing.
- Private result history, opt-in verified public result sharing, leaderboards, rankings, progression, and public-profile redaction controls.

### Quality baseline

- Frontend regression suite: $139/139$ passing at the latest recorded run.
- Server regression suite: $199$ passing with $2$ optional FFmpeg integration probes pending.
- Browser smoke checks cover desktop and mobile viewport overflow.

## Partially Implemented

| Area | Existing asset | Required extension |
| --- | --- | --- |
| Battle lobby | Compact row rendering, filters, capacities | Explicit user-selected grid/list mode, persisted preference, type badges/details, open-seat and auto-start copy |
| Multiplayer | Capacity, join locking, full state, live room | Formal `OPEN -> FILLING -> FULL -> STARTED -> SUBMISSIONS -> JUDGING -> RESULTS` transition contract, timers/notifications for every capacity |
| Battle Studio | Shared battle session, recording and upload flow | Persist `submission_source` as `uploaded_mix` or `battle_studio` in the standardized submission contract |
| DJ judging | Evidence-backed score components and results | Publish Phrase Mixing details in result presentation and make transition-mode weights configurable and locked at start |
| Rights | Library rights classification and private storage | Separate rights certification/review state from self-declared classification before commerce eligibility is granted |
| Public sharing | Public verified results and profile views | Public battle/listening routes, share records, and an explicitly configurable voting window |
| Payments | Payment-related metadata appears only for external Bitcoin rewards | A complete order, payment, entitlement, refund, and payout domain |

## Missing

### Producer and tournament competition

- Producer/beat battle type, beat-submission asset model, producer rubric, producer leaderboard/profile dimension, and challenge payloads.
- Tournament container, rounds, matchups, advancement rules, bracket/leaderboard structures, and tournament-aware results.
- Battle capacity beyond $16$ and a migration strategy for high-capacity events. There is no missing multi-seat persistence layer for current DJ battles: `battle_records.capacity` is persisted, and each participant seat is one persisted `battle_entries` row. The missing work is a tournament and producer-specific model, not a duplicate participant table.

## Multiplayer Persistence Clarification

- **Capacity storage:** `public.battle_records.capacity` persists the configured capacity. Its database constraint currently permits $1 \ldots 16$.
- **Participant and seat storage:** `public.battle_entries` persists one row per participant. `UNIQUE (battle_id, user_id)` prevents the same account occupying two seats in one battle.
- **Restart behavior:** battle records and entries reside in Supabase, so roster membership and capacity survive an Express server restart. The server has no in-memory roster authority.
- **Authoritative membership:** server join, room recovery, readiness, submission, and resolution all query `battle_entries`; browser state is a display/cache and is not authoritative.
- **Atomic final-seat protection:** the `enforce_battle_record_entry_capacity` trigger locks the parent `battle_records` row with `FOR UPDATE`, counts non-withdrawn entries, and rejects an insert/update once capacity is reached. The service also performs preflight conflict checks for clear user feedback.
- **Current lifecycle:** `open`/`waiting` accepts seats; the final successful join locks the roster and writes `full`; existing readiness checks then atomically transition to `started` and establish `started_at` and `deadline_at`. Legacy `matched` records remain recoverable and startable for backward compatibility.

### Marketplace catalog and delivery

- Public product catalog and product pages for beats and certified DJ mixes.
- Product variants/license tiers, included-file manifests, license terms/versioning, price records, and downloadable asset variants such as MP3, WAV, and stems.
- Rights-certification state, reviewer/system decision evidence, and policy enforcement that prevents a seller from self-enabling commercial delivery.
- Email lead capture, consent versioning, unsubscribe state, verification state, attribution, seller lead dashboard, and free-download entitlements.

### Payments and payouts

- Payment-provider abstraction, Stripe adapter, PayPal adapter, provider configuration/readiness, checkout sessions, webhook signature verification, idempotency, and normalized payment lifecycle.
- Stripe Connect onboarding/account status, payout capability status, seller payable ledger, platform-fee calculations, refunds, disputes, chargebacks, and payout reconciliation.
- Orders, payments, refunds, entitlements, download audit records, and short-lived buyer-authorized signed URLs.
- Tax handling, invoices/receipts, jurisdiction policy, seller terms, and compliance workflows. These cannot be safely inferred from code.

### Social voting

- Per-battle voting configuration, scoring-weight lock at battle start, blind entry identities, voter eligibility, server-side vote records, abuse controls, and audit trail.

## Conflicts and Constraints

- Current public library access is owner-only. A marketplace needs separately sanitized public product projections; do not widen access to private `music_library_tracks` or private storage paths.
- Existing `rights_classification` is self-declared metadata and is insufficient by itself for sale eligibility. Commerce must require a separate approval/certification state.
- Existing mix-submission immutability must stay intact. A market product should reference an approved immutable submission/library asset rather than rewrite it.
- Existing `battle_records` supports capacities and resolution but is DJ-mode-centric. Producer rules must share contest infrastructure while using a separate rubric/result namespace.
- Browser payment success pages are not proof of payment. Only verified provider webhooks may transition an order to `paid` and create an entitlement.
- Do not put Stripe secrets, Connect account secrets, private audio paths, permanent signed URLs, payment provider event payloads, or personal-email lead data in browser storage, public result records, or public profiles.

## Recommended Extension Points

### Competition domain

- Extend battle records with a `discipline` such as `dj` or `producer`, locked judging/voting configuration, and a capacity policy; preserve current DJ battle mode IDs and entries.
- Add `battle_rounds` and `battle_matchups` referencing existing battle records for tournament reuse.
- Add `submission_source` to `mix_submissions`; add a producer submission table or generalized `competition_submissions` only after verifying which existing invariant cannot be safely reused.
- Keep `judge_engine.js` for DJ evidence. Add a separate producer judge engine and result contract rather than merging unrelated score semantics.

### Commerce domain

- Add independent tables: `marketplace_products`, `product_variants`, `product_assets`, `rights_certifications`, `orders`, `payments`, `entitlements`, `download_events`, `seller_accounts`, `seller_ledger_entries`, `payouts`, `email_leads`, and `lead_consents`.
- Product records reference approved library tracks or completed mix submissions by immutable ID; deliverable file records use private storage paths only.
- Add a `checkout_service` with provider adapters. Its normalized payment states are `pending`, `processing`, `paid`, `failed`, `canceled`, `refunded`, `partially_refunded`, and `disputed`.
- Implement `stripe_connect_adapter` first. It creates hosted Checkout sessions, records only provider IDs, verifies signed webhooks against the raw request body, and creates idempotent orders/entitlements after payment settlement.
- Implement PayPal only as a second adapter after the common checkout and entitlement tests exist.

### Delivery and email domain

- Resolve every download through an authenticated or signed-email-token server endpoint that checks active entitlement, permitted asset, optional count limit, and expiry before issuing a short-lived storage URL.
- For free-email products, create an entitlement only after consent capture and optional verified-email completion. Record consent text version and collection source, and expose unsubscribe controls outside the download token path.

## Delivery Tranches

1. Battle contract and lobby audit follow-up: persisted list/grid preference, capacity lifecycle normalization, and user-facing seat/status information.
2. DJ submission unification: explicit external-upload/Battle-Studio source on the existing standardized submission path.
3. Producer battle infrastructure: discipline, producer submission constraints, dedicated rubric, and isolated producer rankings.
4. Marketplace catalog: approved public product projections, player UI, products, variants, assets, licenses, certification states, and seller configuration without checkout.
5. Payments and delivery: checkout abstraction, Stripe Connect onboarding, webhook verification, order/payment/entitlement ledger, and authorized downloads.
6. Email-gated downloads: leads, consent, verification, entitlement issuance, and seller lead visibility.
7. Certified DJ-mix marketplace: rights review/certification and approved mix product publishing.
8. Public battle sharing and configurable community voting: blind mode, vote audit, and locked scoring formula.
9. Tournament integration, producer/DJ profile separation, complete regression, deployment review, and compatibility certification.

## Stripe Connect Preconditions

Before Tranche 5, obtain and configure server-only Stripe credentials and webhook signing secret outside source control. Confirm the legal entity that operates the marketplace, platform country, supported seller countries, platform fee policy, refund/dispute policy, tax collection/remittance responsibility, music-license terms, privacy notice, and email-marketing consent language.

The browser may contain only Stripe's publishable key. The server environment will require at minimum `STRIPE_SECRET_KEY` and `STRIPE_WEBHOOK_SECRET`; Connect configuration depends on the chosen account and charge model. Do not place those values in a browser configuration file or send them through chat.