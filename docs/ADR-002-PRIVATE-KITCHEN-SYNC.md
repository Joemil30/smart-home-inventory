# ADR-002: Private kitchens, explicit household sharing, durable sync

**Status:** Accepted for development; hosted rollout remains gated
**Date:** 2026-10-04
**Deciders:** Stocked owner (product requirements), implementation agent (technical design)

## Context

Accounts must restore useful food and recipe data on another device. Family
membership must not expose every member's private inventory or recipes. Existing
device data and app updates must remain recoverable. The current local-first UI
is already useful; replacing every screen would introduce unnecessary risk.

Constraints: static GitHub Pages frontend, Supabase Auth/PostgreSQL, a small
household deployment, existing `coldroom` IndexedDB and legacy optional sync.
No existing user's food is a test fixture. Real credentials stay out of source.

## Decision

Keep three explicit kitchens:

| Kitchen | Who can read/write | How it loads |
| --- | --- | --- |
| Original device | Existing browser user, as before | Original `coldroom` database |
| My private kitchen | Signed-in verified account only | Server + separately scoped IndexedDB |
| Shared household | Current verified household members | Server + separately scoped IndexedDB |

A household owner administers membership, not other people's personal data.
Sharing is an explicit **copy**, not an ACL change on the private original.
Selected food or recipes can be copied; unselected records, device credentials,
local profile lists and dietary settings are not implicitly uploaded by transfer.
Copied food carries its referenced storage location. Copy IDs are deterministic
per source/record to make interrupted transfer retries skip existing copies.

Each cloud local database is scoped by provider hostname + user + scope kind +
scope ID. The original database is never renamed, cleared or reused. Switching
accounts cannot send the previous account's outbox. Legacy code-based SYNC is
disabled inside cloud kitchens. Browser appearance/API configuration stays local.

## Alternatives and trade-offs

| Option | Complexity | Benefit | Reason not chosen |
| --- | --- | --- | --- |
| Reuse legacy generic `sync` | Low | Fastest apparent integration | Permissive deployments, last-write-wins, unscoped cache |
| Per-record arbitrary family ACLs | High | Share with selected subsets | Harder audit, revocation, mixed-list and conflict semantics |
| Separate personal/shared kitchens | Medium | Clear privacy boundary, reuse existing UI | Switching views; no combined personal + shared recipe matching yet |

Future subset sharing needs its own permission model. It is deliberately not
simulated by hiding items in the UI. Admin database operators inherently have
backend access; this is access-controlled storage, not end-to-end encryption.

## Storage and API contract

`stocked_records`: scope + store + record ID, JSON body, integer revision,
tombstone, server timestamp and authenticated updater. Allowed synced stores:
items, catalog, saved recipes, shopping, plan, and `meta/household` layout.
Recipe API cache, activity log and `meta/cfg` do not sync.

`stocked_kitchen_read` returns a complete authorized snapshot. It errors above
5,000 records rather than silently truncating at an API row limit. Each record
is limited to 512 KiB. These are conservative V1 limits, not an infinite-scale
design. Large snapshots/operation journals need pagination and retention work
before broader distribution.

`stocked_kitchen_write` takes an expected revision and a UUID operation ID.
Direct table writes are forbidden. Verified identities, scope authorization,
membership locks, ID validation and size limits are enforced on the server.
Duplicate acknowledged operations return their original result. Stale revisions
return a conflict with the current record, never silently overwrite it.

Local record edits and durable outbox operations commit in one IndexedDB
transaction. Web Locks coordinate same-browser tabs. Acknowledgements remove
only committed operations. A newer pending edit cannot be coalesced over by a
stale tab; its attempted edit is retained as a recovery checkpoint.

## Refresh, offline behavior and revocation

Sync runs every 30 seconds and on reconnection. An open kitchen accepts offline
edits into its durable outbox. New page loads require an online identity and
scope authorization check; failure does not fall back to unverified cloud data.
The original local kitchen remains available separately.

Remote changes show **Load new changes** rather than replacing an in-progress
form. Reload applies the new snapshot. Conflict UI compares both versions and
requires an explicit choice. Both are retained in local recovery history.

Removal denies subsequent server reads/writes; active clients lock when an
authorization failure is observed. It cannot instantly revoke data already
downloaded by an offline member or copies they exported. The UI states this.
Never promise that private data cannot be read by someone controlling the same
unlocked browser profile or by the Supabase project operator.

## Recovery and updates

App shell cache updates are separate from IndexedDB and server records. Existing
update tests still deep-compare original stores. Cloud databases use a stable
versioned namespace, not the release number. Future schema changes must be
additive/migrated; a new release must not rotate the namespace to an empty DB.

Transfer keeps originals and an explicit selected-record checkpoint. Server
deletions are tombstones. Recovery JSON includes records, outbox, conflicts and
checkpoints but excludes device credential configuration. It is an operator
recovery format, not an automatic one-click restore promise. It must not be
blindly imported into another account or uploaded to an issue/repository.

Sync is not a backup against deletion, provider loss or browser storage erasure.
Configure independent database backups and perform a restore drill before
public production. Unsynced edits can still be lost if browser storage is cleared.

## Release gates / follow-up

- [x] Implement isolated schema and storage adapter.
- [x] Implement previewed transfer, privacy labels and conflict recovery.
- [x] Test real PostgreSQL policies and browser/IndexedDB RPC integration.
- [x] Preserve local app and existing update/backup regression suites.
- [x] Create/configure user-owned staging project and apply migrations.
- [x] Test actual Supabase Auth, REST grants, two accounts and parallel clients (2026-10-05).
- [ ] Test email verification/reset on phones and installed PWAs.
- [ ] Configure independent backups; verify restoration in a separate project.
- [x] Complete TOTP/backup authenticator, database enforcement and account deletion; all-factors-lost recovery remains operator-assisted.
- [ ] Review public-release limits, quotas, abuse controls and operation retention.

Relevant vendor guidance: [RLS](https://supabase.com/docs/guides/database/postgres/row-level-security),
[user management](https://supabase.com/docs/guides/auth/managing-user-data),
[database backups](https://supabase.com/docs/guides/platform/backups).
