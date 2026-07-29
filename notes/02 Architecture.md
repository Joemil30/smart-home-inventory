# Architecture

One HTML file, no build step, no framework. This is deliberate — the whole
app is something that can be `fetch()`'d and re-served as a working
self-contained document (see `[[05 Backup and Restore]]`).

## The files

- **`index.html`** (~5300+ lines) — markup, CSS, and all app logic in one
  file. Views are rendered by hand into a root `app` element; there is a
  single `render()` that redraws based on `S` (global state) and `S.view`.
- **`sw.js`** — the offline service worker. Cache-first for the app shell
  (`CACHE`, bumped every release — see `[[08 iOS Safari Quirks]]`), plus a
  separate persistent `IMG` cache for product thumbnails that survives app
  updates (renaming the app didn't rename this cache on purpose — renaming
  it would orphan every downloaded thumbnail).
- **`manifest.webmanifest`**, **`icon.svg`**, **`apple-touch-icon.png`** —
  the installable-app identity. See `[[07 Icon and Branding]]` for why
  changing these doesn't change anything already on a home screen.
- **`test/`** — 12 Playwright-driven suites (`sh test/run.sh`) that boot the
  real `index.html` in headless Chromium and call the app's own functions.
  Nothing is mocked; a test only passes if the shipped code actually works.
  See `[[09 Testing]]`.
- **`notes/`** + **`CLAUDE.md`** — this vault. See
  `[[10 Working Notes and Obsidian]]`.

## Storage: `DB`

A small IndexedDB wrapper (`index.html`, near the top of the script) backing
stores: `items`, `catalog`, `recipes`, `meta`, `log`, `shopping`, `plan`,
`saved`. As of 2026-07-28 it has an in-memory fallback for contexts where
IndexedDB throws (`file://` on iOS Safari) — see
`[[08 iOS Safari Quirks]]`. All writes funnel through a handful of named
functions (`saveItem`, `addItem`, `deplete`, `tossItem`, `learnProduct`,
`logAction`, `saveCfg`) rather than touching `DB` ad hoc.

## Deploy

`.github/workflows/deploy.yml` deploys the repo root as static content to
GitHub Pages on every push to `claude/cold-room-pwa-mpph5h`. There is no
staging branch and no manual approval step — **a push is live on the user's
phone within seconds.** The live URL is
`https://joemil30.github.io/smart-home-inventory/` — not to be confused
with `github.com/Joemil30/smart-home-inventory`, which is the source-code
viewer, not the app (see `[[08 iOS Safari Quirks]]`).

## Optional cloud layer

Family sync (Supabase), free push notifications, and per-store learning are
all opt-in and layered on top of the local-first core — the app is fully
functional with none of it configured. See `[[06 Family Sync]]`.
