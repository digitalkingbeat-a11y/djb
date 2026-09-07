# Validation 005: M3U8 Round Trip

Status: PASS - deterministic software validation

## Reproducible Observation

On 2026-09-01, the served Battle Studio Library toolbar exposed only one generic export command and no M3U8 format selection. The current export implementation generates CSV only. An M3U8 playlist can be imported, but the app cannot export M3U8 for a same-format round trip.

## Expected Result

An M3U8 playlist can be exported and then re-imported with item order and available metadata intact.

## Actual Result

No M3U8 export path is available.

## Evidence

- Browser: served app at `http://127.0.0.1:8080/`, Battle Studio Library toolbar, 2026-09-01.
- Source behavior: `exportActiveStudioPlaylist` generates `${crate.name}-export.csv` with `text/csv` content.

## Fix Verification

On 2026-09-01, after D-001 added M3U8 export and metadata preservation, `node --test --test-concurrency=1 test/studio-hardening.test.js` passed `playlist export M3U8 round-trips order and metadata`.

## Result

Result: PASS - deterministic software validation