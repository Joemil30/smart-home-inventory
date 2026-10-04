# Tests

The unreleased account foundation has separate suites:
`accounts-ui-test.js` (actual browser UI, simulated Supabase transport) and
`accounts-db-test.js` (actual embedded PostgreSQL, synthetic auth identities).
See [account test setup and limits](../docs/ACCOUNT_SETUP.md). These do not prove
production email delivery or live multi-device sync. The database suite requires
PGlite. Run both account suites separately before an account release; the regular
browser runner covers the deployed pantry application, not these staged features.

```sh
sh test/run.sh
```

Every suite serves the repo over a local HTTP server, opens the real
`index.html` in headless Chromium, and calls the app's **own** functions.
Nothing is mocked. A test can only pass if the shipped code behaves — which is
why these have caught real bugs rather than describing intentions.

Off this machine, point them at your own install:

```sh
PLAYWRIGHT_MODULE=playwright CHROME_PATH=/path/to/chrome sh test/run.sh
```

| suite | what it protects |
|---|---|
| `verify` | the broad one — boot, barcode round-trip, receipts, expiry, voice, date OCR, sync, backup, search |
| `aisle-test` | aisle grouping and per-store walk order, recipe match ratios, week-based planning |
| `cat-test` | `guessCat` — 72 real product names, each asserted into the right aisle |
| `sheet-test` | full-screen sheets + back arrow, drag-reorder, photo framing, the photos/compact toggle |
| `catalog-test` | the shared catalog spine and per-store lists |
| `home-test` | the Home dashboard and its counts |
| `import-test` | the `my-list.json` seed: merges without overwriting a real household |
| `backup-test` | export/restore round-trips, including the self-contained HTML snapshot |
| `sw-test` | **the update path** — installs, ships a new build, asserts it's noticed, applied, and still works offline |
| `update-test` | the Settings update card, and that a clean reinstall never eats your data |
| `theme-test` | light/dark override beating the phone, and the status-bar colour following the app |
| `ai-test` | model auto-pick, dead-model healing, quota-error wording |
| `history-test` | per-store history, the confirm layer, and editing/merging history records |
| `insights-test` | the eaten/wasted maths, rankings, date windowing, and the spending guard |
| `map-test` | zones-as-locations, pin placement, and that the map maintains itself |
| `shop-test` | the missed band, low-stock thresholds, and the running total |
| `storemap-test` | the aisle map, per-store aisle names, and store colour/badge |
| `recipe-test` | JSON-LD import, the CORS fallback, ratings and times-cooked |
| `calendar-test` | month-grid layout maths, day tinting, and list progress |
| `urlaction-test` | URL actions, the share target, and that links can only *add* |
| `latest-test` | buying rhythm, unified search, plain lists, sharing, low-stock chip, impact, translation |
| `recipe-pro-test` | scaling, units, nutrition, cooking mode, recipe imports and organization |
| `household-test` | v61 upgrade preserving all eight stores with 500 items; four responsive sizes; local and uploaded covers; broken-image fallback; recipe tabs and shopping context |

The household upgrade suite requires Git and the `stocked-v61` tag (`git fetch --tags`
in a shallow/new checkout). Its fixture is synthetic and runs in a disposable
browser context; it never opens or changes the production household. Screenshots
go to `STOCKED_SCREENSHOTS` or the workspace's `outputs/stocked-v62` directory.

Test servers must serve `.css` as `text/css` and `.webp` as `image/webp`.
The app now has a separate design stylesheet and locally bundled food imagery;
testing only inline HTML no longer verifies its actual presentation.

`syntax-check` runs first and is not a browser suite: it parses `index.html`'s
inline script, `sw.js` and the manifest, and reports a real file line. Without
it a stray bracket surfaces as every suite failing with `S is not defined`,
which points at nothing.

`genlist.js` is not a test — it regenerates `my-list.json` from the shopping
list in its header, by driving the app's own `addStore`/`addToList`/
`recordCatalog` so the records are exactly the shape the app produces.

## Adding one

Copy the header of any suite (server + browser boot), then drive the app
through its real functions and assert on real DOM. Two habits worth keeping:

- **Read computed styles while the element is still attached.** Detaching
  first resets them and you'll chase a phantom failure.
- **Derive versions and cache names from the source**, never hardcode them —
  `verify` and `sw-test` read `CACHE` out of `sw.js`, because hardcoding it is
  exactly how a suite ends up asserting against a version the app dropped.
# Cloud kitchen tests (unreleased)

Run `node test/kitchen-db-test.js` for the private/shared database protocol, and
`node test/kitchen-sync-test.js` for real browser/IndexedDB + PostgreSQL integration.
Use the same `PGLITE_MODULE`, `PLAYWRIGHT_MODULE` and `CHROME_PATH` environment
variables as the account suites. These are separate from `test/run.sh` because
they require the extra PGlite development dependency.

Auth is synthetic in the integration test; SQL/RLS, storage, outbox, transfer and
the app are real. This is not a substitute for hosted JWT/email or concurrent
PostgreSQL tests. Fixtures never touch the live app's browser data. See
`docs/ACCOUNT_SETUP.md` for hosted gates and rollback.
