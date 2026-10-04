# ADR-001: Managed accounts and an explicit household boundary

**Status:** Accepted for development; production activation pending staging verification

**Date:** 2026-10-04

**Deciders:** Stocked project owner; implementation by Codex

## Context

v62 is a local-first household app. Legacy optional Supabase setup asks every
device for a project URL/key and household code. The original SQL allows all
callers to access sync rows, and the alternate authenticated schema is not fully
wired into create/join flows. Neither should be promoted as a consumer account
system. We have not established which backend project, if any, is deployed.

Existing local food must survive account creation, joining, sign-out and failure.
The user approved starting account/cloud work, not silently transferring their
household data to an unverified backend.

## Decision

Use managed Supabase Auth for email/password signup, verification, reset and
sessions. Build a separate account preview, `account.html`, with its own SDK
storage key. It does not read or write the `coldroom` database or legacy SYNC.
Operator configuration is public and disabled by default. No per-user API setup.

Use new `stocked_homes`, `stocked_members` and `stocked_invites` tables. Only
verified users can perform household RPCs. Server membership, not a browser
household code, determines access. Table writes are not granted to browser roles.
One household per account in V1; explicit removal/leave before joining another.
Owners manage invitations, removal and ownership transfer. Members cannot promote
themselves. The last owner cannot leave without transferring ownership.

Invites have cryptographically random tokens stored only as hashes, expire after
48 hours, and admit one person. A new invitation replaces the prior unused token.
The recipient reviews the home/owner identity before accepting. Tokens travel in
the link fragment, are removed from the address bar and use a no-referrer policy.

Do not migrate the legacy schema automatically. The new UI refuses activation
when a legacy `public.sync` table exists. A fresh staging project is preferred;
an existing project needs a separately reviewed migration and backup plan.

## Options considered

| Option | Complexity | Consequence |
|---|---|---|
| Extend current code-only sync | Initially low | Preserves manual configuration and an unsafe multi-household boundary. Rejected. |
| Supabase Auth + new membership schema | Moderate | Reuses the existing vendored SDK; separates identity, membership and later inventory transfer. Selected. |
| Move to another managed backend | Moderate/high | Viable but requires a new client and data integration with no demonstrated advantage here. Deferred. |
| Write password/session handling ourselves | High | Adds avoidable credential and recovery responsibilities. Rejected. |

No pricing assumption is required for this decision; project limits and mail
delivery costs must be reviewed before activation.

## Consequences

The account foundation can be tested without changing the live kitchen. It is
not family inventory sync yet. The main app remains v62, and no deployed release
or service-worker version is changed by this work.

Next stage must define per-account/household local cache isolation, explicit
local-to-cloud migration review, a durable outbox, server revisions/conflict
resolution, membership revocation, multi-tab coordination and offline recovery.
The old last-write-wins queue is not approved as the new sync engine.

MFA enrollment/challenge/recovery, account deletion, real email delivery,
branded email templates, abuse protection and production monitoring remain
release gates for their respective functionality. Do not advertise them as done.

## Action items

- [x] Account UI and provider integration, disabled by default.
- [x] Household RPCs, RLS, invitations and ownership management.
- [x] Embedded PostgreSQL policy tests and browser tests with simulated provider.
- [ ] Select a user-controlled staging project and configure email delivery.
- [ ] Verify real Auth callbacks and two independent household accounts.
- [ ] Implement/review local data transfer and the replacement sync engine.
- [ ] Implement MFA with recovery and complete account deletion.
- [ ] Activate and deploy only after staged verification.

References: [Supabase Auth](https://supabase.com/docs/guides/auth),
[password flows](https://supabase.com/docs/guides/auth/passwords),
[database functions](https://supabase.com/docs/guides/database/functions).
