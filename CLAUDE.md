# Stocked — project memory

Read this first, every session. It's the standing context: what this app is,
how it's built, and what's already been decided — so decisions don't get
re-litigated and old bugs don't get re-introduced.

Deep history and reasoning live in `notes/` (Obsidian-compatible, linked with
`[[wikilinks]]`). This file is the index + the load-bearing facts; `notes/`
is the narrative.

## What this is

A single-file offline-first household food inventory PWA. One person's
family uses it daily on iPhone home screens. Live at
`https://joemil30.github.io/smart-home-inventory/`. Deploys automatically
on every push to `claude/cold-room-pwa-mpph5h` (see `.github/workflows/deploy.yml`)
— **there is no staging step; every push is live on the user's phone within
seconds.** Test before claiming done.

## Architecture, in one paragraph

Everything is `index.html` (~5300+ lines): markup, styles, and app logic in
one file, no build step, no framework. **Zones (a fridge shelf, a drawer)
are locations carrying a `parent`** — not a second hierarchy — so `item.loc`
keeps working everywhere; items gained `spot` {x,y} for map pins. Shelf
dropdowns all render through `locOptions()`. `sw.js` is the offline service worker
(cache-first shell, `IMG` cache for product thumbnails that survives app
updates). `DB` (index.html) is a tiny IndexedDB wrapper with an in-memory
fallback for contexts where IndexedDB is unavailable (see
`[[08 iOS Safari Quirks]]`). `manifest.webmanifest` + `icon.svg` +
`apple-touch-icon.png` are the installable-app identity. `test/` is 19
Playwright-driven suites that boot the real `index.html` and call the app's
own functions — nothing is mocked (`sh test/run.sh` runs all of them; keep
them green).

## Non-obvious rules that must not get re-broken

- **Bump `CACHE` in `sw.js` on every release.** If `sw.js` is byte-identical,
  the browser never re-registers it and shipped fixes never arrive on
  installed phones.
- **`file://` (a double-tapped backup `.html`) has no IndexedDB on iOS
  Safari.** `DB.init()` must keep its try/catch fallback to an in-memory
  store, or opening a backup shows a blank screen. See
  `[[08 iOS Safari Quirks]]`.
- **Store tabs come first, General LAST**, and history is scoped to the shop
  you're on. General is the fallback, not the default view.
- **Destructive actions go through `confirmed()`**, which lives on its own
  `#cdlg` dialog. Never route it through the shared `#dlg` — a confirm has
  to be able to stack on an open sheet. Its `close` handling has two guards
  for a real async bug; don't simplify them (`[[11 Confirmations and History]]`).
- **The confirm belongs on the tap, not in the data funnel.** `deplete()`
  and `tossItem()` must stay dialog-free — the cook sheet, receipt review,
  barcode scans and voice all drive them with nothing there to answer a
  dialog. Ask in `tapDeplete()` / `tapToss()` instead. Voice never confirms
  on purpose; its undo toast is the safety net.
- **`guessCat` must match whole words, not substrings**, and check specific
  phrases before general ones — "cola" ⊂ "chocolate", "egg" ⊂ "eggplant" are
  real regressions that happened once already.
- **Home-screen icon/name only update if the user deletes and re-adds the
  shortcut.** iOS never re-reads `manifest.webmanifest` for an existing
  "Add to Home Screen" icon. Don't promise an icon change will "just show up."
- **`https://github.com/...` and `https://joemil30.github.io/...` are
  different sites.** The user confused these once — github.com is the code
  viewer, github.io is the running app. Always give the `.io` link.
- **`[[13 Design Language]]` is the visual reference.** Derived from
  screenshots the user picked out himself, so it's his taste on record, not
  mine — check new screens against it instead of inventing a look.
- **"Stocked" is already an App Store app** in this exact category. The
  name cannot ship as-is; see `[[12 Going Public]]`.
- **The user is a phone-only, non-technical user.** No local git clone, no
  terminal on their end. Every instruction I give them has to be "open
  Safari, tap this, type this" — not "run this command."

## Where things stand

- Cloud sync ("Family sync" in Settings) is Supabase-backed, opt-in, and
  fully built — see `[[06 Family Sync]]`.
- History is a real surface, scoped per shop, and editable everywhere;
  destructive taps ask first. See `[[11 Confirmations and History]]`.
- App Store path (Capacitor wrap) is scoped in `APP_STORE_LAUNCH.md` +
  `[[12 Going Public]]` but not started; PWA is the live, recommended path
  today. **The shipped Supabase RLS policy is `using (true)`** — safe only
  because every family runs their own project and holds their own key. It
  is a breach the moment one backend serves many households, so any "let
  strangers use it" work starts with Supabase Auth, not with Capacitor.
- Full chronological history: `[[01 Timeline]]`.

## Keeping this current

A recurring job re-reads recent commits and updates `notes/` and this file
without the user needing to ask — see `[[10 Working Notes and Obsidian]]`
for how that's wired. If you're reading this as part of that job: check
`git log` since the date in `notes/01 Timeline.md`'s last entry, add
what's new, keep it terse.
