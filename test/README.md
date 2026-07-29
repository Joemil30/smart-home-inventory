# Tests

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
