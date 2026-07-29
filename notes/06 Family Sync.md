# Family sync (Supabase)

The app's real answer to "sync across every phone in the family." Built
2026-07-19, opt-in, entirely on top of the local-first core — nothing about
it is required for the app to work solo.

## Why not literal Apple iCloud
Safari's web-content JavaScript has no access to CloudKit/iCloud at all —
there is no API surface for a website to reach it. "Family sync" is the
real, working equivalent: a free Supabase project the user creates and
owns, not a third-party service reading their data.

## How it works
- Settings → **Family sync** card (`renderSyncCard` in index.html).
- User creates a free Supabase project, pastes the app's setup SQL into
  Supabase's SQL editor (one `sync` table, row-level security scoped to a
  household code, realtime enabled).
- Pastes the Project URL + anon public key into the app → **Connect**.
- **Create new household** (generates a code) or **Join** an existing one
  with that code.
- All mutation funnels (`saveItem`, `learnProduct`, `logAction`, household/
  cfg/shopping saves) upsert to the shared `sync` table, stamped with
  `updatedAt`; last-write-wins on conflict. Realtime subscription applies
  incoming changes live.
- Optional: free push notifications via a Supabase Edge Function (needs a
  computer with the Supabase CLI to deploy once — the one part of this
  that isn't phone-only).

## Trade-off, stated plainly to the user
Turning this on puts inventory data in a cloud the user owns (not only
on-device). Only people with the Project URL + key + household code can
reach it.

## Per-store / family learning
Corrections to estimated expiry ("still good +Nd") feed a shared, synced
learning record per category, bounded so it can't run away from the base
shelf-life table. See `[[04 Photos Theme and Expiry]]`.
