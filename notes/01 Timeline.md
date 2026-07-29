# Timeline

Chronological project history, reconstructed from commit history and
conversation. Newest entries added at the bottom by whoever (human or
Claude) is keeping this current — see `[[10 Working Notes and Obsidian]]`.

## 2026-07-18 — Cold Room v1
First commit: offline-first household food inventory PWA. iOS barcode
scanning via bundled ZXing (vendored, not CDN-loaded, so it works offline).
Light theme, off-white/near-black/orange. GitHub Pages auto-deploy wired up
same day. Receipt reader (one AI call reads a whole shopping trip), smart
expiry with printed-date reading + "still good" verification — see
`[[04 Photos Theme and Expiry]]`.

## 2026-07-19 — Cloud, AI healing, on-device everything
Big single day: fixed a dead Gemini model (`gemini-2.0-flash`, silently
zero-quota) with auto-heal + retry + a swappable free provider. Added
family cloud sync (Supabase) and a shared shopping list — see
`[[06 Family Sync]]`. Added free on-device date OCR (Tesseract, no AI
quota), a live-video date scanner, voice control (trash/eat/add-to-list via
Web Speech API), per-store learning, and free push notifications.
Rebranded **Cold Room → ShelfLife**.

## 2026-07-22 — Cooklist-grade redesign
Full IA overhaul: simpler nav, a Profile hub, onboarding. Home dashboard,
meal planner, rich recipes. Theme flip-flopped (dark green → back to light
green) before landing — see `[[04 Photos Theme and Expiry]]` for where it
settled. Real product photos via Open Food Facts; real recipe photos via
TheMealDB. Typo-tolerant search, a saved-recipe library, pantry
expiration-status filter, smart shopping↔pantry sync.

## 2026-07-23 to 07-25 — Fit and finish
Faster/more reliable shopping-list Add. Smarter search, more accurate
receipt scanning. Fixed a second Gemini failure mode ("limit: 0 before I
sent anything").

## 2026-07-28 — The big rename + hardening day
This is the day most of the current app's shape was decided:
- **Renamed ShelfLife → Stocked**, new bowl+check icon (dark mode) — see
  `[[07 Icon and Branding]]`.
- Catalog system unified across pantry/shop/plan — one history, per-store
  lists, big photo tiles.
- **Fixed photo framing** — `place-items:center` grid cells size to content,
  so `height:100%` never resolved; fixed with `position:absolute` + blurred
  photo backdrops. See `[[04 Photos Theme and Expiry]]`.
- **Fixed `guessCat` substring collisions** ("cola" ⊂ chocolate, "egg" ⊂
  eggplant, "nut" ⊂ pantry-adjacent words) — see
  `[[03 Categorization guessCat]]`.
- Rewrote the Appearance section: explicit light/dark switch, status bar
  follows the app's theme instead of the phone's.
- Added a permanent App version card in Settings (update check + clean
  reinstall that preserves IndexedDB).
- Committed the `test/` suite (12 Playwright-driven suites, ~390 checks,
  no mocks) to the repo for the first time.
- Shipped the service-worker fix that makes updates actually reach already-
  installed phones (cache-name bump forces re-registration).
- **Fixed the blank-screen bug**: opening a `.html` backup directly
  (`file://`) blocked IndexedDB on iOS Safari, so boot() threw before
  `render()` ran. Fixed with an in-memory `DB` fallback. See
  `[[08 iOS Safari Quirks]]`.
- Discovered the user had been confusing `github.com/...` (the code viewer)
  with `https://joemil30.github.io/smart-home-inventory/` (the actual
  running app) — see `[[08 iOS Safari Quirks]]`.
- Started this `notes/` vault + `CLAUDE.md` project memory, and set up the
  Obsidian ↔ repo sync loop — see `[[10 Working Notes and Obsidian]]`.
