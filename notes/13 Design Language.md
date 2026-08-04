# Design language

Derived 2026-08-04 from 53 App Store screenshots the user collected and
described as "the kind of design I was looking for — clean, easy visual,
easy to navigate."

This file exists because design taste is the one thing that can't be
inferred from a codebase. It is the reference to check work against, so
"does this look right?" has an answer that isn't a guess. When a screen is
built or changed, it should be checkable against the rules below.

Apps sampled: Stocked (the existing one), Food Stock, AnyList, Listonic,
Out of Milk, Fridge Buddy, KitchenPal, Grocery Map, Summo, HopDrop, Cozzo,
and several smaller inventory apps.

---

## The one-line version

**Big bold left-aligned title → search → chip row → sectioned content of
photo cards.** Real photography instead of illustration. Colour used only
to mean something. Generous space, hairline dividers, almost no shadow.

The best-looking references (Grocery Map, Food Stock, Summo) are all the
same skeleton. That skeleton is the target.

---

## Layout skeleton

Every primary screen, top to bottom:

1. **Page title** — left-aligned, ~30–34px, weight 700–800, near-black.
   Sits directly on the page background, not inside a bar. iOS-style
   centred nav titles appear only in *sub*-screens.
2. **Search field** — full width, immediately under the title. Tinted grey
   fill (never a white box with a border), radius ~12–14px, magnifier glyph
   left, placeholder in real language: *"Search food items…"*.
3. **Filter chips** — one horizontal scrolling row, clipped at the screen
   edge so it's visibly scrollable. Pills, ~15px radius.
   - inactive: light tinted fill, dark text, no border
   - **active: solid brand fill, white text** — this is the single most
     repeated pattern in the whole sample
4. **Sections** — a small bold header with a **count** beside it
   (`Items (1)`, `Storage Locations`, `To Buy` / `Purchased`). The count is
   information, not decoration; it belongs on every section.
5. **Content** — two-column photo cards, or full-width rows.

## Cards

The dominant object. Two columns, ~12px gutter.

- Photo fills the **top ~65–70%** of the card, flush to its edges.
- A label strip underneath on a white/near-white ground: **name in bold**,
  then one muted meta line (`5 items • 1 low`, `Qty: 5`, `Inventory: 4 •
  Fruits`).
- Radius ~14–16px, hairline border, shadow either absent or barely there.
  These references are flat. Heavy drop shadows read as dated.
- Optional count badge in a photo corner.

**Split action footer.** The strongest interaction idea in the sample
(Food Stock): a full-width bar across the card bottom, split red `−` /
green `+`. No menu, no long-press, no swipe to discover — the two things
you actually do are permanently on screen, thumb-sized. Worth stealing
outright.

## Stat tiles

Three across, above the content, on a location or summary screen:
icon on top, **big number**, then a tiny ALL-CAPS label
(`14 ITEMS` / `3 LOW STOCK` / `4 EXPIRING`). Each tile tinted with its own
status colour at low opacity. Reads in under a second, which is the point.

## Photography

**Real photos, not illustration.** Food Stock uses actual photographs of a
fridge, a freezer, a pantry and a storage room as the location cards, and
that single choice is most of why it feels tangible rather than generated.

Corollary: this is exactly what the interactive-fridge idea is for. A
photo of *your* shelf outperforms any stock image, and the app already
stores user photos.

## Colour

Semantic only. Brand green may double as "good" (the app IS freshness),
but nothing else gets a colour for decoration.

- green — fresh / in stock / ready / done
- amber — soon / low stock / one thing missing
- red — expired / wasted / destructive

**Never colour alone.** Every reference pairs it with a word or glyph:
`● Ready to cook`, `● 1 ingredient missing`, `Fresh` / `Low stock` chips.
Keep that — it's also what makes the app usable for colour-blind users.

## Navigation

Newer references (Grocery Map, Summo, the orange inventory app) use a
**floating pill tab bar** — a rounded, inset, translucent bar hovering
above the content rather than a full-width bar welded to the bottom edge.
Active tab is a filled pill. It looks current; the full-width bar looks
2019.

Four to five destinations, never more.

## Type

- Page title 30–34 / 700–800
- Section header 17–20 / 700
- Card title 15–17 / 600
- Meta and secondary 13–14 / 400–500, muted
- Stat number 22–28 / 700
- Tiny caps label 10–11 / 600, letter-spaced

One sans family throughout. The decorative serif and rounded display faces
in the sample belong to the *marketing screenshots*, not the apps — don't
confuse the two.

## Spacing

16px page gutter. 12px between cards. 24–32px between sections. Let empty
space do the separating; use hairlines only where a boundary is genuinely
ambiguous.

---

## What to change in Stocked

Measured against the above, the app is closest on structure and furthest
on surface:

- ✅ big left-aligned titles, chip filters, photo tiles, traffic-light
  status — already correct in principle
- ❌ **locations have no photos** — the highest-impact single change
- ❌ **no stat-tile row** on location screens
- ❌ full-width bottom nav rather than a floating pill
- ❌ **no split `−`/`+` footer** on item tiles; the actions hide behind taps
- ❌ section headers frequently lack their count

---

## Marketing screenshots (separate discipline)

For the store listing, the Grocery Map format is the one to copy:

1. tiny eyebrow label — `● GROCERY MAP`
2. huge headline, two or three words per line
3. one-line subtitle in plain language
4. the device below, cropped by the frame edge
5. a soft pastel gradient behind it, a different hue per screenshot so the
   carousel reads as a set

Headlines are **benefits, not features**: *"Forget less on the way home"*,
*"Dinner from what you already have"*, *"Your pantry builds itself."*
