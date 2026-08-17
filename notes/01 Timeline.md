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

## 2026-07-29 — History as a first-class surface, and a confirm layer
The user's own framing: the list is a checklist, the history is what was
previously on it, and ticking something off at the till should file it away
by itself. What shipped:
- **Per-store history in the Shop screen.** Each shop tab shows its own
  history (search, add by hand, tap to edit, tick to re-list). Store tabs
  now come FIRST and **General is last** — General is the catch-all, not the
  default. The app also opens on a real shop rather than General.
- **A confirm layer** (`confirmed()`, `#cdlg`). Using something up, throwing
  it out, removing a list line and clearing the bought pile all ask first —
  the checkbox and the ✕ sit a thumb's width apart. Settings → *Taps &
  confirmations* can turn it off. Paths that already confirm (the cook
  sheet, receipt review, a deliberate bin-scan) pass `ask:false`.
- **Everything in history is editable** — one `historySheet()` for products
  and meals: rename, re-aisle, re-assign shops, fix the count, photo,
  delete. Renaming merges when it collides with an existing record.
- **One-tap import** of the old written-down shopping list (Settings → *Your
  old shopping list*), which folds `my-list.json` in: ticked lines become
  per-shop history, outstanding ones become live list lines.
- Fixed a real dialog bug found by the new tests: `close` is delivered
  asynchronously and `onclose` is a property the next confirm overwrites, so
  a dismissed dialog's event silently answered "no" to the *next* question.
  See `[[11 Confirmations and History]]`.
- New suite `history-test` (45 checks) — `[[09 Testing]]`.
- Same day, corrected: the confirm had been put *inside* `deplete()` and
  `tossItem()`, which hung every programmatic caller (cook sheet, receipt
  review, scans, voice) on a dialog nothing could answer. Moved onto
  `tapDeplete()` / `tapToss()`; the data funnels are plain operations again.
  Voice stays unconfirmed by design. See `[[11 Confirmations and History]]`.

## 2026-07-31 — The question changes to "how do I launch this"
No code shipped; the scope did. The user wants Stocked in the App Store and
open to strangers. Wrote `[[12 Going Public]]`: what "independent of GitHub"
actually means (the repo is the backup — a domain and 2FA are the real
independence), the four hard gates (a Mac for Xcode, age of majority for a
developer account, ~$99/yr + $25/mo, and Guideline 4.2), and the three
security changes that must land before strangers arrive — the shipped RLS
policy is `using (true)`, the AI key must never enter a binary, and accounts
mean Supabase Auth plus an in-app delete button Apple actually checks for.
Recommended order: Android first, backend rebuild second, iOS last.

## 2026-08-04 — A design language, from his own references
The user collected 53 App Store screenshots and said "this is the kind of
design I was looking for." Written up as `[[13 Design Language]]` — the
shared skeleton (big left title → search → chip row → sectioned photo
cards), real photography over illustration, semantic-only colour, floating
pill nav, and the split `−`/`+` card footer worth stealing outright. Also
lists the five concrete gaps in Stocked today.

Discovered in the same batch: **"Stocked" is already a shipping App Store
app** in the same category with the same pitch. The name has to change
before any store filing — see `[[12 Going Public]]`.

## 2026-08-04 — Building the whole reference list
The user went through all 45 features found in the screenshots, chose
essentially all of them, and asked for the lot. Shipped in order, each with
its own suite:
- **Design pass** — floating pill nav, stat tiles, shelf photo cards, the
  split `−`/`+` tile footer. `[[13 Design Language]]`.
- **Insights** — eaten-vs-binned rings, most-eaten/most-wasted rankings,
  spending by category, 30/90/365 windows. Computed entirely from
  tombstoned items; nothing new is recorded.
- **The kitchen map** — photograph a shelf, tap food onto where it sits.
  Zones are locations with a `parent`, so `loc` still works everywhere;
  items gained `spot` {x,y} as fractions. Pins read live, so the map
  maintains itself.
- **Shopping** — "didn't get last time", low-stock thresholds, prices and a
  running basket total.
- **Store map** — the list drawn as the walk, per-store aisle names, store
  colour and badge. Exposed three live `guessCat` collisions ("tortilla
  chips" → Bakery, "potato chips" → Produce, "tinned tomatoes" → Produce),
  now fixed and covered.
- **Recipe import** — schema.org JSON-LD when a site allows the fetch, an
  honest paste fallback when CORS blocks it, plus source/rating/times-cooked.
- **Expiry calendar** and the list progress bar with member faces.

Suites went 13 → 19 (`insights`, `map`, `shop`, `storemap`, `recipe`,
`calendar`).

Then, asked to continue rather than stop at the "needs a backend / needs a
Mac" line, most of that turned out to be reachable after all:
- **URL actions** — the app answers to `?add=`, `?view=`, `?store=`. An iOS
  Shortcut wrapping that URL *is* Siri, with no native code, no App Intents
  and no developer account. Same handles serve Android's share target and
  three home-screen shortcuts. Links can only ever **add**;
  `urlaction-test` proves it by firing twelve hostile query strings at a
  stocked pantry.
- **The security work, written and unapplied** — `schema-v2-auth.sql`
  replaces `using (true)` with `is_member()` over a membership table, plus
  Edge Functions for the AI key and account deletion. See
  `[[15 Auth and Hardening]]`.
- **Capacitor scaffolding** — `[[16 Native Wrap]]`.
- **Multi-language lists** — per device, cached on the line, never
  overwriting what was typed (the catalog is keyed on canonical name, so a
  translated name would fork every history record).
- **Impact** — your lifetime waste rate against the UNEP household range.
  The global "181 countries" version still needs many households on one
  backend.

Also added `syntax-check`, which runs before the browser suites and reports
a real line number. A stray bracket had twice surfaced as all nineteen
suites failing with `S is not defined`, which points at nothing.

Genuinely still blocked: widgets, geofencing and pickup/delivery ordering
(native code), and community photos/layouts plus the global impact page
(one shared backend).

## 2026-08-04 (later) — The rest of the reference list, and the memory layer
Re-reading the 53 screenshots against what existed turned up six features
picked from the list that were never built, plus three that had never made
it into the inventory at all — a running-low filter chip, list sharing, and
plain named lists. All built. Also Ideas/Queue/Calendar/Made, suggestion
shelves, and the AI habit summary. Quick-start list sizes were deliberately
skipped: they seed a *new* list per trip, and this app keeps one persistent
list per shop.

Then the four areas he named — datasets, memory, search, AI:
- **Buying rhythm** — `recordCatalog` now keeps real purchase timestamps, and
  predicts what you're due for from the **median** gap. `[7,7,7,300,7]` is
  the case that matters: a mean says every 66 days, the median says 7. Four
  purchases minimum, same-trip repeats collapsed, silent when the spread is
  too wide. See `[[18 Buying Rhythm and Search]]`.
- **One search box** across house, list, history, recipes and meals; recipes
  match on their ingredients. The magnifier now opens it from every screen.
- **AI model fallback** — quota out mid-receipt steps down the shortlist
  `candidates()` had always computed and `gen()` never used. A 400 is never
  retried down the list; capped at two hops.
- **Attribution** — Open Food Facts is ODbL, its photos CC BY-SA. That is a
  licence condition and the app had been shipping without it. `privacy.html`
  was rewritten from scratch; the old one named a dead app and its data
  table was simply false.

Also: the 29 July build now ships alongside at `/old/` for comparison — see
`[[19 Side by Side Builds]]`, which is mostly about the two ways that could
have damaged the live app. Suites 19 → 22 (`shop` was already there;
`urlaction`, `latest`, plus `syntax-check`), 629 assertions.
`HANDOFF.md` records the project's intent, not just its architecture.
