# Reading the list in your own language, and the impact number

Two small features from the reference set (HopDrop, KitchenPal) that both
turned out to hinge on the same rule: **never overwrite what someone typed.**

## Multi-language lists

One shared list, each person reading it in theirs.

The whole design sits on one decision: translation is **per device**, cached
**beside** the name, never replacing it.

```js
s.name          // exactly what was typed. This is what syncs.
s.tr = { es: 'Cilantro', fr: 'Coriandre' }   // cached translations
```

Two reasons it has to be that way round, both of which would be quiet
data corruption rather than a visible bug:

1. **The row is shared.** Overwriting `name` on a synced row changes what
   everyone else sees. One person switching to Spanish would rewrite the
   family's list.
2. **The catalog is keyed on canonical name.** `recordCatalog` upserts by
   `norm(name)`, so a translated name creates a *second* history record —
   "Cilantro" and "Coriander" would accumulate separate purchase histories
   for the same thing, and every store's history would slowly fork. See
   `[[03 Categorization guessCat]]` for why canonical naming is load-bearing.

The list shows the translation with the original underneath in small grey,
so the person who wrote "cilantro" can still recognise their own line.

Cost is one AI call per *batch* of new items, not per item, and the result
is cached on the line — so a list already translated is free to reopen and
works offline afterwards.

## The impact number

KitchenPal's version shows global totals ("people in 181 countries have
saved 440,960 items"). That needs many households on one backend, so it's
Phase 2 — see `[[15 Auth and Hardening]]`.

What is honest today is **your own rate against the published range**:
the UNEP Food Waste Index puts household food waste at roughly 20–36%.
`lifetimeImpact()` computes yours over all history — not the 30-day window
Insights uses — because a lifetime number is the one worth quoting.

Deliberately counted, not priced. The app has prices now, but most items
won't carry one, so a money figure would be confidently wrong. Counting is
something the app actually knows.

This is also the number for a college application or an App Store listing:
*"cut tracked household waste from 30% to 11%"* is a claim with a method
behind it, which "has 47 features" is not.
