# Context handoff — paste this into a new chat

Everything a fresh session needs to pick this up. Written 2026-08-04.

---

## What this is

A **single-file, offline-first household food inventory PWA**. One family
uses it daily on iPhone home screens. It exists to stop food being wasted:
know what's in the house, what's dying, what you can cook right now, and
what you actually need to buy.

- **Live:** https://joemil30.github.io/smart-home-inventory/
- **Repo:** `joemil30/smart-home-inventory`, branch
  `claude/cold-room-pwa-mpph5h`
- **Deploys automatically on every push to that branch.** There is no staging
  step — every push is on the user's family's phones within seconds. Test
  before claiming done.
- A frozen copy of the 29 July build is served at `/old/` for side-by-side
  comparison, with its own isolated database.

## Why it exists

It was built because his family kept buying food they already had and
throwing out food they'd forgotten. It answers one question — *what's in the
house, what's dying, and what do I actually need* — fast enough to be used
while standing in a shop.

Three constraints were fixed from the start, and they are the reason the app
deserves to exist rather than a feature list: **it works with the network
off**, **it is free with no subscription**, and **the data stays his**. Every
competitor studied fails at least one. Any decision that trades one of these
away for a feature is the wrong trade — check new work against them.

The ambition since grew: from a family tool to something strangers would
choose, good enough for the App Store, designed well enough not to look
homemade, and substantial enough to point at as real work on a college
application. Not a project that demos well — one with a number behind it:
*this many households, this much less waste*. That is why Insights and the
lifetime-impact figure exist at all.

**The interactive kitchen map was his own idea**, not taken from any of the
53 competitor apps he studied. It is the one thing in the app nobody else
has, and it should be protected as such.

**One line:** *Stop wasting food by making what you already own impossible to
forget — offline, free, and private by default.*

## Who you're working for

**A phone-only, non-technical user.** No local git clone, no terminal. Every
instruction has to be "open Safari, tap this, type this" — never "run this
command". He is a high-school student aiming to launch this on the App Store
and use it as a college extracurricular with measurable impact.

He is direct, moves fast, and expects thoroughness. He has said plainly that
the coding is strong but the **design instinct is not** — which is why the
design language is now written down from screenshots *he* chose, rather than
invented. Check work against `notes/13 Design Language.md` instead of
guessing.

## Read these first, in this order

1. `CLAUDE.md` — standing project memory and the non-obvious rules
2. `notes/01 Timeline.md` — full chronological history
3. `notes/13 Design Language.md` — his taste, on record
4. `notes/12 Going Public.md` — what App Store launch actually requires
5. `notes/15 Auth and Hardening.md` — the security work, written but unapplied

`notes/` is an Obsidian vault with `[[wikilinks]]`; it syncs to his phone.

---

## Architecture in one paragraph

Everything is `index.html` (~7,800 lines): markup, styles and app logic in
one file, no build step, no framework. `sw.js` is the offline service worker
(cache-first shell; bump `CACHE` on **every** release or shipped fixes never
reach installed phones). `DB` is a tiny IndexedDB wrapper with an in-memory
fallback for `file://`. **Zones (a shelf, a drawer) are locations carrying a
`parent`** — not a second hierarchy — so `item.loc` keeps working everywhere;
items gained `spot` {x,y} for map pins. Every shelf dropdown renders through
`locOptions()`. `test/` is 22 Playwright suites (629 assertions) that boot the
real `index.html` and call the app's own functions — nothing is mocked.
`sh test/run.sh` runs all of them; `syntax-check` runs first and reports a
real line number.

## Rules that must not get re-broken

These each cost real debugging once already.

- **Bump `CACHE` in `sw.js` on every release.**
- **`guessCat` must match whole words, specific phrases before general ones.**
  "cola" ⊂ chocolate, "egg" ⊂ eggplant, "tortilla" ⊂ tortilla chips,
  "tomato" ⊂ tinned tomatoes — all were live bugs.
- **The confirm belongs on the tap, not in the data funnel.** `deplete()` and
  `tossItem()` must stay dialog-free; ask in `tapDeplete()`/`tapToss()`.
  Voice never confirms on purpose.
- **`confirmed()` lives on its own `#cdlg`**, and its close handling has two
  guards for a real async bug. Don't simplify them.
- **Store tabs come first, General LAST.**
- **Translations never overwrite `name`** — the catalog is keyed on canonical
  name, so a translated name forks every history record.
- **URL actions can only ADD.** Nothing reachable from a query string may
  consume, delete or overwrite.
- **iOS never re-reads the manifest** for an existing home-screen icon.
- **`github.com` ≠ `github.io`.** Always give him the `.io` link.
- **"Stocked" is already a shipping App Store app.** The name cannot ship.

---

## Everything he has asked for, in order

1. Fix wonky photos; switch off dark-mode default; rename ShelfLife → Stocked
2. Light/dark switch in Settings; icon design options
3. Which external tools would improve development (Obsidian, iCloud sync)
4. Per-store history as a first-class surface; confirmations on destructive
   taps; everything in history editable; import his old 147-item written list;
   General tab last
5. "Is Claude design the way to go? Your design skills kinda suck"
6. Resume/marketing copy for the app
7. How to make it a real independent app, App Store ready, with proper
   privacy and security and accounts
8. Can Claude control his laptop/browser? Is this ChatGPT-only?
9. **53 App Store screenshots** of competitor apps → extract the design
   language and every feature → "ask me about every single one"
10. Build all 30 selected features; "do it all, don't stop"
11. Old and new versions installed side by side to compare
12. "What hasn't been done yet?" — twice, and both times the honest answer
    included things I had wrongly implied were finished
13. Go deep on the datasets, memory, search and AI integration
14. **Transform smart search; integrate AI to the max with zero cost**

## The design language, in one line

Big bold left-aligned title → search → chip row → sectioned photo cards.
Real photography over illustration. **Colour only ever means something, and
is always paired with a word.** Floating pill nav. Split −/+ footer on tiles.
Section headers carry counts. Full detail in `notes/13`.

---

## What is built

50 features counted; 32 of them added on 4 August. Highlights:

- **Interactive kitchen map** — photograph a shelf, tap food onto where it
  sits; pins read live so the map maintains itself
- **Buying rhythm** — learns how often you buy things, predicts what you're
  due for. **Median, not mean** — `[7,7,7,300,7]` means 7 days, not 66
- **Insights** — eaten vs binned, most wasted, spending, lifetime impact vs
  the UNEP 20–36% household range
- **Store map** — your list drawn as the walk, per-store aisle names/colour
- **Recipe import** — schema.org JSON-LD, with an honest paste fallback when
  CORS blocks the fetch
- **Siri with no native app** — the app answers to `?add=`, so an iOS
  Shortcut wrapping that URL is voice control
- **Unified search** across house, list, history, recipes and meals
- **AI model fallback** — quota out mid-receipt steps to the next model
- Expiry calendar, low-stock thresholds, share the list, plain named lists,
  multi-language lists, prices and running basket total

## What is NOT built, and why

| Item | Blocker |
|---|---|
| Widgets, geofenced reminders | Real Swift/Kotlin; needs the wrap + a Mac |
| Pickup/delivery ordering | Partner agreements + permanent API upkeep |
| Community photos & store layouts | One shared backend + moderation |
| Global impact totals | Same shared backend |
| Alexa | No equivalent URL trick for a web app |
| Quick-start list sizes | **Deliberate** — they seed a *new* list per trip; this app keeps one persistent list per shop |

## Written but NOT switched on

`supabase/schema-v2-auth.sql` plus the `ai` and `delete-account` Edge
Functions. **The shipped RLS policy is still `using (true)`** — safe only
because his family is the sole tenant of their own Supabase project, and a
total breach the day a stranger signs up. `notes/15` has the order.

## In progress when this was written

**Search transformation, not yet started in code.** The plan, all local and
zero-cost:

1. **Synonym/alias groups** — cilantro/coriander, aubergine/eggplant,
   courgette/zucchini, scallion/spring onion, garbanzo/chickpea, rocket/
   arugula. Biggest single win, costs nothing.
2. **Phonetic matching** to catch misspellings edit-distance misses.
3. **Query intent** — typing "expiring", "low" or a store name into search
   acts as a filter.
4. **Ranking signals** — things bought often and recently rank higher.

**Constraint he set: integrate AI hard but never incur a charge.** So:
on-device first (Tesseract OCR and Web Speech are already free and local),
cache AI results so the same question is never asked twice, batch calls, and
only reach for AI when local heuristics fail. Chrome's built-in on-device
model (`LanguageModel`/Gemini Nano) is worth *feature-detecting* behind a
guard — but its current shape was **not verified**, so treat it as unproven
and never assume it exists.

## Also still owed

- Tests for the very latest batch (rhythm and search have cover; the AI
  fallback has cover; anything newer will not)
- `APP_STORE_LAUNCH.md` still contains the dead "Stocked" name in its
  marketing copy

## What only he can do

Photograph his shelves (two minutes, biggest visible payoff) · trademark
search at tmsearch.uspto.gov classes 009/042 · buy a domain · run the auth
schema before strangers · Mac + Apple ($99/yr) and Google ($25) accounts ·
and he may not be 18, which gates the developer account.

---

## How to work on this

- Run `sh test/run.sh` before claiming anything works. All 22 must pass.
- Bump `CACHE` in `sw.js` with every change to shipped files.
- Commit messages here explain *why*, not what — match that.
- Screenshot the real app rather than describing intent; there is a
  Playwright harness pattern throughout `test/`.
- Update `CLAUDE.md` and `notes/` as part of the work, not afterwards.
- Be honest about gaps. He has twice asked "what hasn't been done", and both
  times the truthful answer included things previously implied as finished.
  That costs more trust than the gap itself.
