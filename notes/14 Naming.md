# Naming

Opened 2026-08-04, when a competitor screenshot in the user's own reference
batch turned out to be an App Store listing for an app called **Stocked** —
food inventory, same category, same pitch ("organize and visualize the items
in your pantry and fridge"). See `[[12 Going Public]]` for why that blocks a
store filing.

## What's already taken

Checked against the App Store on 2026-08-04:

| Name | Status |
|---|---|
| **Stocked** | **Taken.** Direct collision — food inventory, same category, same pitch. |
| **Larder** | **Taken.** UK App Store, scan items + best-before dates + swipe to use/bin. Near-identical feature set. |
| **Crisper** | **Taken.** "Crisper — Grocery Tracker", crisper.studio. Receipt scanning, shared kitchen, expiry warnings. Recent and close. |
| **Cold Room** | **Weak collision only.** One "Cold Room Calculator" by LU-VE S.p.A. — an industrial refrigeration sizing tool. Same class (009) but a different product for a different audience. |
| Rummage | No food/pantry app found. |
| Onhand | No food/pantry app found. |

The pattern is worth stating plainly: **every descriptive name in this
category is gone.** Larder, Crisper, Stocked, Pantry-anything, Fridge-
anything — all occupied, most by apps shipped in the last two years. A name
that describes the product is both hard to register and hard to rank for.

## Shortlist

1. **Cold Room** — the project's original name, still on the branch. Only
   collision is an industrial calculator, so the audience never overlaps. It
   doesn't literally describe the app, which is exactly what makes it
   registrable. Strongest option.
2. **Rummage** — what you actually do in a fridge. Nothing in the category
   found using it. Memorable, slightly playful, easy to own in search.
3. **Onhand** — the phrase the app exists to answer ("what have we got on
   hand?"). Clean, but generic enough that registration may be contested.

## Caveats that must not be skipped

- **App Store absence is not trademark clearance.** A registered mark can
  exist with no app attached, and it still blocks. Before spending anything
  on branding: search **tmsearch.uspto.gov**, classes **009** (software) and
  **042** (SaaS).
- Check domain availability at the same time — the name and the domain
  should be settled together, because the domain is what makes the app
  independent of GitHub (`[[12 Going Public]]`).
- The rename is cheap in code (a handful of strings, the manifest, the
  service-worker cache name) and expensive in habit — the user's family have
  the current icon on their home screens, and iOS never re-reads the
  manifest for an existing shortcut (`[[08 iOS Safari Quirks]]`). Rename
  once, deliberately, not twice.
