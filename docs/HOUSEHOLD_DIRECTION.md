# Stocked: the household direction

The product should answer: **What is in my house, what needs attention, what can I cook, and what should I buy?**

This records the user's supplied product/design north star. It is a direction, not a claim that every capability is implemented.

## The four jobs

| Screen | Job | v62 decision |
|---|---|---|
| Today | What matters now? | Attention rows first, one dinner suggestion, alternatives and shopping context below. No inventory dashboard duplication. |
| Inventory | What do we have, and where? | Search and physical locations first; compact quantity controls by default. Optional photos and maps remain secondary. |
| Cook | What can I make? | Food-led recipe gallery, availability context, readable Ingredients/Steps, one main cooking action. |
| Shop | What do we need? | Fast entry, aisle groups, provenance and at-home context. Purchasing still leads into the existing restock review. |

Adding/scanning is an action, not a fifth primary destination. The global + asks what the user is doing before selecting the capture method.

## Visual contract

- Roughly 70% quiet utility, 20% appetizing food imagery, 10% personality.
- Warm off-white background, white surfaces, dark neutral text, muted green actions. Amber/red have status meaning.
- Editorial serif headings; readable system-sans controls and lists. No external font dependency.
- Different treatments for different jobs: food imagery for discovery, compact rows for household management, simple circles for shopping.
- No emoji-led primary navigation, giant gradient placeholder cards, or several competing primary buttons.
- Secondary capabilities belong behind a clearly labeled disclosure, not removed or buried in unexplained menus.
- Honest empty states and image fallbacks; reduced-motion preference respected.
- Default light regardless of OS theme, while preserving deliberate user choice.

## What is implemented, and what is not

v62 improves presentation and connections between existing capabilities. It does **not** deliver ReciMe feature parity, a fully automatic household inventory, or a new synchronization backend.

Recipe availability matches ingredient names and configured staples. It does not validate exact quantities or prove food is safe. An empty or stale household record is not a trustworthy inventory. Past-date foods remain reviewable; they are not promoted by rescue scoring. AI imagery is illustrative, not evidence that a recipe was cooked or that a product is owned.

The app remains local-first. Shared-household behavior requires the existing optional configuration. A local backup is still important; the release does not promise cloud backup merely because a user sees the app online.

## Highest-value work after v62

1. **Inventory trust:** explicitly distinguish confirmed quantities, estimates, missing dates and recently reviewed stock; test real groceries in the household before broadening scope.
2. **Review and correction:** make capture results easy to reconcile without accidentally duplicating existing food. Prioritize a quick shelf/date review over another input method.
3. **Cook/restock accuracy:** quantity-aware ingredient matching with explicit unknown amounts, batch/location handling and a clear review before deduction or restocking.
4. **Household pilot:** use it for 30 days, record where people stop updating it, then fix those specific frictions. Measure time to capture a grocery trip and correction frequency, not feature count.
5. **Sync reliability:** verify concurrent edits, offline replay and recovery using isolated test households before treating sharing as dependable automation.

Social feeds, followers, creator profiles, broad retailer integrations, perfect social-video imports and advanced nutrition dashboards remain later. They do not solve stale household inventory.

## Scope discipline

Preserve existing household records, IDs, history and backups. Never silently seed demonstration groceries into a real account. Store each shipped version in Git and document visible changes in the changelog. Small verified improvements to the connected loop take precedence over apparent feature completeness.

The main application is still a large single HTML file. The v62 design stylesheet is separated so its visual rules can be inspected, but this is not a completed component-architecture refactor. Future extraction should be incremental and covered by the existing browser tests.
