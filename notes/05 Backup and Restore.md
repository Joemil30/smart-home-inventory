# Backup and restore

Two different things people mean by "back up my app," so the app ships
both (Settings → Backup & restore):

## 1. `.json` — data only
`backupData()` exports `items`, `catalog`, `shopping`, `plan`, `saved`,
`log`, plus household + cfg (with secrets like API keys stripped —
`CFG_SECRETS`). Small, mergeable. Restoring it (`applyBackup`) merges by
record id — a restore never clobbers something newer already on the phone.
Needs the in-app "Restore from a backup file" picker to open.

## 2. `.html` — the whole app, self-contained
`snapshotHTML()` fetches the live `index.html` source and appends the
backup JSON as a `<script id="shelflife-restore">` tag just before
`</body>`. The result is a genuinely complete, working copy of the app —
open it anywhere (phone, laptop, no internet) and it runs, data included.
`loadSnapshotSeed()` reads that embedded tag on boot: if the opening
device's app is empty, it becomes the new data; if not, it offers to merge
via a toast instead of overwriting silently.

**Known bug, fixed 2026-07-28:** opening a `.html` snapshot directly (i.e.
`file://`, e.g. double-tapping it in the iOS Files app) blocked IndexedDB
entirely — WebKit refuses IndexedDB for `file://` origins. `DB.init()`
threw, `boot()`'s `await` never resolved, and `render()` never ran: a blank
screen in the app's own background color, nothing else. See
`[[08 iOS Safari Quirks]]` for the fix (in-memory `DB` fallback).

## The "seed" convention
A restored file can carry a `seed: true` flag, meaning "fold this data in"
(an old shopping list, a starter catalog) rather than "this is a full
household snapshot" — a seed only contributes stores its lines point at,
so it can't clobber a real household's members/allergies/shelves.

## Real cross-device sync is a different feature
The `.html`/`.json` files are manual, point-in-time backups — not sync.
For live, always-in-sync data across multiple phones, see
`[[06 Family Sync]]`.
