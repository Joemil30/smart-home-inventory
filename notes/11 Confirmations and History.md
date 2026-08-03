# Confirmations, and history as a surface

Two features that shipped together on 2026-07-29 because they're the same
idea from two sides: the app should be hard to damage by accident, and
nothing you've ever bought should be hard to get back.

## History = the catalog, scoped by shop

There has only ever been one catalog (`S.catalog`, `recordCatalog`), holding
both products and meals (`kind`: `product` | `meal`). What changed is that
it's now *shown* the way the user thinks about it: **per shop**.

- `catalogList(kind, { store, q })` already filtered by store — the shop
  screen now leans on it for a real, always-visible History section under
  each store tab (`paintHistory`).
- **Store tabs come first, General last.** General isn't "the main list with
  shops as a filter"; it's the fallback for things that belong to no shop
  yet. `viewShopping` also defaults `S.store` to the first real shop.
- Ticking something off a shop's list records it into *that shop's* history
  (`recordCatalog(..., { store })`). Re-buying bumps the one record rather
  than duplicating — the catalog is keyed by canonical name, which is what
  makes "chedar" and "Cheddar" one memory. See
  `[[03 Categorization guessCat]]`.

### Editing
`historySheet(c)` is the single editor for both kinds — rename, aisle,
which shops it belongs to, times bought/made, photo, delete. `restockSheet`
and the Cook → Made tab both route into it, so "fix this" works the same
wherever you meet a remembered thing.

A **rename is a move**: the canonical name IS the id, so renaming writes
under a new id and tombstones the old one (`renameCatalog`). If something
already lives at the new id the two histories *merge* — counts sum, shops
union — because you renamed it precisely to say they're the same thing.

### Seeding real history
`my-list.json` (the user's old written-down list, 147 records across 7
shops) imports in one tap from Settings. Two non-obvious rules in
`applyBackup`, both learned the hard way:
- **Remap store ids by name.** A seed carries its own ids; if the household
  already shops at "Costco" with a different id, every seeded record has to
  be re-pointed at the real one, or a year of history lands on a phantom
  second Costco.
- **A seed may never create or replace a household.** Its household is a
  stub that exists only to carry shop names — writing it as-is on a fresh
  phone yields a household with no shelves, breaking every "which shelf?"
  sheet.

## The confirm layer

`confirmed({ title, body, yes, danger })` → `Promise<boolean>`. Opens on its
**own** `<dialog id="cdlg">`, deliberately not the shared full-screen sheet:
a confirm has to be able to stack on top of an item sheet without destroying
it, and a yes/no question shouldn't take over the screen.

**The confirm lives on the tap, never in the data funnel.** `deplete()` and
`tossItem()` are plain data operations that must never open a dialog;
`tapDeplete()` / `tapToss()` are thin wrappers that ask first and are only
ever reached from a click handler. This was learned by breaking it: with the
confirm inside `deplete()`, every programmatic caller — the cook sheet,
receipt review, barcode scans, voice — blocked forever on a dialog that
nothing was there to answer.

Gated: `tapDeplete`, `tapToss`, the item sheet's "all gone",
`removeFromList`, "Clear bought", and every history/store deletion.

**Voice deliberately does not confirm.** It calls `deplete()` / `tossItem()`
straight, because it exists for the moment your hands are covered in raw
chicken and a sheet you have to tap defeats the entire feature. The toast's
undo is the safety net there.

Settings → **Taps & confirmations** turns it off (`cfg.confirmActions`),
default on. When off, `confirmed()` resolves `true` immediately, so every
call site stays a plain `if (await confirmed(...))` with no branching.

### The async-close bug (worth not re-introducing)
`<dialog>`'s `close` event is delivered **asynchronously**, and `onclose` is
a *property* that the next `confirmed()` call overwrites. So dismissing one
dialog and immediately opening another meant the first dialog's queued close
event ran the *second* dialog's handler — silently answering "no" to a
question the user hadn't seen yet. The fix is two guards: a generation
counter, plus `!dlg.open` (if the dialog is on screen right now, this event
belongs to a question already answered). Caught by `history-test`, not by
inspection — see `[[09 Testing]]`.
