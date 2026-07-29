# Testing

`test/` — 12 suites, run with `sh test/run.sh`. Every suite serves the repo
over a local HTTP server, opens the real `index.html` in headless
Chromium, and calls the app's **own** functions. Nothing is mocked — a
test only passes if the shipped code actually behaves.

| suite | what it protects |
|---|---|
| `verify` | boot, barcode round-trip, receipts, expiry, voice, date OCR, sync, backup, search |
| `aisle-test` | aisle grouping, per-store walk order, recipe match ratios, week planning |
| `cat-test` | `guessCat` — 72 real product names into the right aisle (`[[03 Categorization guessCat]]`) |
| `sheet-test` | full-screen sheets, drag-reorder, photo framing (`[[04 Photos Theme and Expiry]]`) |
| `catalog-test` | the shared catalog spine and per-store lists |
| `home-test` | the Home dashboard and its counts |
| `import-test` | `my-list.json` seed merge without overwriting a real household |
| `backup-test` | export/restore round-trips, incl. the self-contained `.html` (`[[05 Backup and Restore]]`) |
| `sw-test` | the update path — install, ship a new build, notice it, apply it, still work offline |
| `update-test` | the Settings update card, and that a clean reinstall never eats data |
| `theme-test` | light/dark override beating the phone, status bar following the app (`[[04 Photos Theme and Expiry]]`) |
| `ai-test` | model auto-pick, dead-model healing, quota-error wording |

## The known gap
This suite runs in headless Chromium, on a machine with no phone. Every
real bug found in this project (`[[08 iOS Safari Quirks]]`) came from
actual iOS Safari behavior these tests structurally cannot see:
`file://` IndexedDB restrictions, home-screen icon caching, Safari-only
API gaps. **Testing green here is necessary, not sufficient** — always
say plainly when something hasn't been confirmed on a real device.

## Adding a new test
Copy the header of any suite (server + browser boot). Two habits worth
keeping:
- Read computed styles while the element is still attached — detaching
  first resets them.
- Derive versions/cache names from source, never hardcode — `verify` and
  `sw-test` read `CACHE` out of `sw.js` for exactly this reason.
