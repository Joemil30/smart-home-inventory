# v63 household pilot release

Date: 2026-10-07. Scope: device-only household use. Cloud activation is excluded.

## Release gates

- Local app suite: 25 suites, including `pilot-test.js`.
- Account regression suite: accounts-db, kitchen-db, kitchen-sync, accounts-ui,
  account-security-db and account-deletion-function.
- Exact v62 → current preservation across eight stores, plus the existing
  v61 upgrade test with 500 synthetic inventory entries.
- Actual browser receipt review, failed-save retry, repeat taps, catalog stock,
  empty selection, kitchen check, confirmation/cancel, undo, stale edits.
- Responsive screenshots at 390px; overflow assertions at 320/390/768/1280px.
- Existing offline/update/backup/recipe/shopping tests.
- `cloud-config.js` must keep `enabled:false`; no new hosted database changes.
- Git tag and immutable snapshot branch preserve v62 and v63.

## Deployment evidence

The immutable release is identified by tag `stocked-v63` and branch
`release/stocked-v63`. The GitHub Pages run must succeed for that commit.
`test/release-smoke.js` verifies the public files against the saved release,
then tests core flows, persistence, the disabled account gate and offline
startup in a disposable browser context. Run only with `STOCKED_LIVE_SMOKE=1`.
It generates timestamped evidence in the workspace's
`outputs/stocked-v63/live-verification.json` and screenshots alongside it.
The release handoff reports the actual result after publication; this source
file does not pre-claim that a future deployment succeeded.

## Known limits and tomorrow's routine

Use one household device. Accounts and family sync are not publicly activated.
Use the same browser/home-screen copy each time, and keep a JSON data backup.
Start with one shelf, one person handling groceries, and a kitchen check before
shopping. Family members can simply report what ran out. Receipt AI needs an
internet connection and a configured user-owned key; barcode/manual remain
available. Catalog history is not a guarantee that food is currently present.

Cloud activation still needs a user-owned sender/domain, verified signup/reset
delivery, actual phone/PWA callbacks and an independent backup/restore drill.
The hosted project stays protected; security settings are not relaxed to bypass
email requirements. Camera hardware, real AI receipt extraction and real iOS
installation are not validated by desktop browser tests.

## Rollback

If boot, data preservation, core grocery flows or offline startup fail, restore
the v62 application files in a new commit (not a force reset), bump the service
worker to a new rollback cache identifier, and push the production branch.
Preserve IndexedDB and all release tags. This release has no schema migration.
Git history is not a household-data backup. No production telemetry is installed;
do not invent error-rate, latency or real-user monitoring claims.
