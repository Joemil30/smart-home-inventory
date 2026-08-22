# Stocked release history

This is the human-readable record of changes to Stocked. Release branches preserve the
exact files for every deployed version, while this log explains what changed
and why.

## v61 — Recipe studio and light-first experience

**Released:** 2026-08-22
**Previous version:** `release/stocked-v60`

### Recipe experience

- Added serving controls that scale ingredient quantities from 1 serving upward.
- Added Original, Metric, and US customary measurement conversion.
- Added per-serving calories, protein, carbohydrates, and fat panels; Stocked's
  built-in values are clearly labeled as estimates.
- Added a focused step-by-step cooking mode with progress and best-effort screen wake lock.
- Added native recipe sharing with a clipboard fallback.
- Added custom cookbooks, tags, personal notes, ratings, and richer Saved search.
- Added manual recipe creation with cover photos.
- Added photo and text/Markdown/HTML/JSON recipe-file import paths.
- Added a local no-key parser so conventionally formatted pasted recipes remain usable offline.
- Extended schema.org imports to retain source-provided nutrition.

### Product behavior

- Light is now the default on every device, including phones set to dark mode.
- Existing installs that used the old Match-my-phone setting migrate to Light.
- Dark mode remains available only as an explicit choice in Appearance.
- Fixed generated-recipe shopping transfers so ingredients already declared as owned
  are not accidentally added to the shopping list.
- Removed horizontal recipe-dialog overflow at narrow phone widths.

### Verification

- All 23 browser suites pass, including the new recipe-studio regression suite.
- Visual checks pass at 320 px and 390 px in the light theme.
- Recipe scaling, conversions, nutrition, cooking steps, organization, search,
  no-key paste parsing, and shopping transfer are covered by browser tests.

## v60 — Visual food experience and connected recipes

**Released:** 2026-08-21
**Previous version:** `release/stocked-v59`

### User experience

- Reduced the primary navigation to Home, Inventory, Recipes, and Shop.
- Rebuilt Home as an action layer that recommends what to use and cook now.
- Added an offline, editorial food image for the signature Chicken Spinach Pasta recommendation.
- Reorganized Inventory so food appears before secondary storage-location cards.
- Replaced internal category and urgency language with consumer-friendly labels.
- Improved 320 px and 390 px mobile layouts and eliminated horizontal overflow.

### Recipes and shopping

- Added 14 built-in recipes that work without Gemini or another API key.
- Added inventory-aware ingredient matching and clear You Have / You Need groups.
- Added recipe search and filters for Use Soon, Have Everything, Under 30 Minutes,
  High Protein, and Vegetarian.
- Added one-tap transfer of missing recipe ingredients into Shopping with recipe-source metadata.
- Kept imported recipes, saved recipes, meal planning, and cooking history connected.

### Reliability and privacy

- Fixed date-only expiration parsing across US time zones.
- Preserved confirmed expiration dates when food moves between locations.
- Prevented failed Supabase writes from being silently removed from the retry queue.
- Pulls remote household state before retrying queued sync writes.
- Made automatic product-photo lookup an explicit opt-in because it sends product names
  to Open Food Facts.
- Added a timeout and actionable fallback for blocked recipe-link imports.
- Updated the offline shell to `stocked-v60` and cached the bundled recipe hero.

### Verification

- All 22 browser suites pass.
- Service-worker installation, upgrades, and offline startup pass.
- Visual checks pass at 320 px and 390 px with no page errors or layout overflow.

## v59 — Pre-redesign baseline

**Preserved:** 2026-08-21
**Release branch:** `release/stocked-v59`
**Commit:** `1926448`

This is the exact version that was live immediately before the connected Home,
Recipes, and Inventory redesign. It remains available as the rollback baseline.

## How to read the exact files

- `release/stocked-v59` is the last live build before the redesign.
- `release/stocked-v60` is the first release of the redesigned core experience.
- `release/stocked-v61` adds the complete local recipe-studio workflow and light-first default.
- Future deployments will add another dated section here and a matching release branch.
