# Buying rhythm, and one search box

Two things added 2026-08-04 that both depend on data the app had already
been quietly collecting for weeks.

## Buying rhythm

The only part of the app that makes a **prediction**, which is why almost
all of its design is about refusing to.

### Why median, not mean

Household shopping is full of outliers: a stock-up before a holiday, a
fortnight away, three-for-two on something you buy monthly. The test case
that makes the point is `[7, 7, 7, 300, 7]` — five gaps, four of them a
steady week, one long trip away.

- mean → **66 days**
- median → **7 days**

The mean answer isn't slightly off, it's useless, and it would be delivered
with exactly as much confidence as a right one. That is the failure mode
worth designing against: a wrong prediction is worse than no prediction,
because it costs the credibility of every other number on the screen.

### What makes it stay quiet

- **4 purchases minimum.** Two gaps is a coincidence.
- **Same-trip repeats collapse.** Three yoghurts in one shop is one buy;
  without this, a single stock-up looks like a 4-hour buying cycle.
- **Gaps outside 0.5–180 days are dropped** before the median is taken.
- **Spread relative to the median must be under 0.85.** Milk every 6–8 days
  is predictable; coffee somewhere between 3 and 60 days is not, and
  pretending otherwise produces nagging.
- The band only offers things you **don't currently have** and that
  **aren't already on a list**.

### What it needed from the data model
`recordCatalog` now keeps a `buys` array of real timestamps, capped at 16 —
a year of weekly shopping, and small enough not to bloat the sync row.
`first`/`last`/`count` were enough for a mean and could never have supported
a median.

## One search box

The pantry search only ever answered *"is it in the house right now?"*,
which is the wrong question about half the time. "Where's the sour cream",
"have I ever bought tahini" and "what did I do with that chilli recipe" are
one gesture from the user's side and were three different screens.

`searchEverything()` runs the same typo-tolerant matcher over live items,
the shopping list, purchase history, saved recipes and meal history, then
groups results **by what you can do with them** rather than by which table
they came from. That grouping is the difference between a search screen and
a database browser.

The detail worth keeping: **recipes match on their ingredients**, at 0.75
weight. "What can I do with the aubergine" is the actual question, and the
answer is never in the recipe's title.

The magnifier now opens this from every screen instead of only the pantry.
