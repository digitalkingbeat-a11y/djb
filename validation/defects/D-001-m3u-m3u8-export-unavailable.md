# D-001: M3U and M3U8 Export Unavailable

Status: Closed - verified

## Reproduction Steps

1. Serve the app and open Battle Studio.
2. Navigate to the Library toolbar.
3. Inspect the playlist export controls.
4. Select `Export Playlist` for an available playlist.

## Expected Result

The user can select M3U or M3U8 and export that format for re-import.

## Actual Result

The UI offers no format selector and the export operation generates CSV only.

## Evidence

- Browser observation: Battle Studio Library toolbar at `http://127.0.0.1:8080/` on 2026-09-01.
- Focused automated baseline: `node --test --test-concurrency=1 test/studio-hardening.test.js` passed parsing for M3U, M3U8, and CSV and passed CSV round trip; no corresponding M3U/M3U8 export scenario exists.

## Fix Scope

Add M3U and M3U8 export selection and serialization only. Preserve the existing CSV export/import behavior. Rerun validations `004` and `005` before the frozen regression suite.

## Resolution

On 2026-09-01, the Studio Library toolbar gained CSV, M3U, and M3U8 export selection. M3U-family exports use standard `#EXTM3U` and `#EXTINF` entries plus `#DJ-BATTLE` metadata comments so the app preserves order and available metadata on re-import.

Verification: `node --test --test-concurrency=1 test/studio-hardening.test.js` passed all 10 tests, including M3U and M3U8 export/re-import order-and-metadata round trips.