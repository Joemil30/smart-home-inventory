# Account foundation: setup and release gates

**Development preview only. The live v62 application has not been switched to this system.**

Implemented: email/password signup and sign-in, verification resend, password
reset/update, SDK-managed sessions, household creation, invitation preview/join,
roster, removal/leave and ownership transfer. Also implemented in development:
private/household cloud kitchens, revision-checked syncing, selected food/recipe
transfer, offline outbox, conflict review and recovery export. These have not yet
been connected to or verified against a hosted Supabase project.

Not implemented: MFA enrollment/challenge/recovery, complete account deletion,
social sign-in, automated off-site backup or notification delivery.

## Operator setup — staging first

1. Choose a Supabase project owned by the user. Prefer a fresh staging project.
   Do not repurpose a legacy project or apply SQL to production without reviewing
   current tables, policies, data and backups. This schema refuses cloud activation
   if `public.sync` exists and does not modify that table.
2. For the project creation security settings: **Data API ON**, **Automatically
   expose new tables OFF**, **Automatic RLS ON**. Keep the strong database password
   in the owner's password manager, never source control or chat. The Data API
   is needed for authenticated RPCs; it does not grant unauthenticated data access.
   Apply `supabase/accounts-foundation.sql`, then `supabase/kitchen-sync.sql` in
   staging. They are rerunnable and add isolated tables, named policies and RPCs.
   Explicit grants support projects with automatic exposure disabled. Inspect
   the result; never run old `schema.sql` or its public-access policy here.
3. Enable email/password authentication and **require email verification**. Set
   the server password policy to at least 12 characters. Configure suitable rate
   limits and bot protection before public access.
4. Configure an email sender/SMTP provider and verify its domain. Provider default
   mail limits are not evidence that arbitrary family addresses will receive mail.
   Do not enable the UI until real verification/reset delivery is tested.
5. Add exact allowed redirect URLs for the staging `account.html` route and
   `account.html?flow=recovery`. Set the appropriate site URL. Avoid broad wildcard
   production redirects. PKCE links should be opened in the requesting browser;
   test installed-PWA versus browser behavior on iPhone and Android.
6. In the staging build only, set `cloud-config.js` to `enabled: true`, the project
   HTTPS URL and its **publishable** key (or legacy `anon` public key). These are
   client configuration, not server secrets. Never put a service-role/secret key,
   database password, SMTP credential or management token into frontend files.
7. Open `/account.html`, then `/kitchens.html`. Signing in never uploads local food.
   Test the private kitchen first, then a deliberately shared synthetic household.
   Review selected records before transfer. Only then use genuine food records.

Do not enable MFA on test accounts until its full challenge/recovery UI is built.
Do not expose this foundation as a production-ready general signup flow yet:
account deletion and full recovery requirements still need completion.

## Tests

```sh
# Existing project test environment also needs Chromium/Playwright.
PLAYWRIGHT_MODULE=playwright CHROME_PATH=/path/to/chrome node test/accounts-ui-test.js

# Install this development-only test dependency through npm if needed:
npm install --no-save --ignore-scripts @electric-sql/pglite@0.5.8
node test/accounts-db-test.js
node test/kitchen-db-test.js
node test/kitchen-sync-test.js
```

`PGLITE_MODULE` can point to an existing PGlite installation. SQL tests execute
against real embedded PostgreSQL with synthetic Supabase identity fixtures.
They verify two-household isolation, direct-write denial, owner/member permissions,
invitation expiry/revocation/reuse, repeated creation, removal and ownership.
They do not test real parallel connections or Supabase's hosted token gateway.

Browser tests use the actual page and CSS with a **simulated Auth/RPC transport**.
They exercise validation, failures/retries, verification/reset messaging, recovery,
session-loss races, invitation confirmation, responsive layouts and unchanged
local IndexedDB. Screenshots show synthetic accounts, not working production users.

## Required hosted tests before activation

- [ ] Signup to two real controlled inboxes; verification, resend, spam folder and rate limits.
- [ ] Wrong-password, expired/reused email links, reset, sign-out, reload and session expiry.
- [ ] PKCE callbacks in desktop, phone browser and installed PWA; copied-to-another-browser failure handling.
- [ ] Two different households cannot read/write one another's rows via direct REST requests.
- [ ] Anonymous and unverified callers cannot perform household operations.
- [ ] Simultaneous create/join/revoke/remove/transfer calls preserve membership and one owner.
- [ ] Removing a member revokes server access; other tabs do not display stale account data.
- [ ] Existing pantry records unchanged throughout signup, sign-in, invite acceptance and sign-out.
- [ ] No legacy permissive tables, leaked secret keys or diagnostic token logging.
- [ ] MFA/recovery and account-deletion behavior completed before they are offered.
- [ ] Document provider quotas, email costs, operational ownership and rollback.

## Private / household sync verification

The implementation is documented in `ADR-002-PRIVATE-KITCHEN-SYNC.md`.
The browser integration test uses the real HTML/JS, real IndexedDB and PGlite
PostgreSQL RPCs, with synthetic Auth transport. It covers a second device,
offline edits, stale same-browser tabs, conflicting edits, lost acknowledgements,
restart/replay, account separation, unchanged original stores, explicit food and
recipe transfer, deduplication, credential-free exports, fresh browser storage,
member revocation and phone/desktop layout. PGlite serializes requests; it is
not evidence of real concurrent hosted transactions, SMTP or JWT validation.

Required additional hosted checks:

- [ ] No automatic grants: anonymous REST access to every new table/RPC denied.
- [ ] Direct SQL/REST as two real users proves owner cannot read member private data.
- [ ] Concurrent edits, removal versus write, and lost responses on hosted Postgres.
- [ ] Fresh phone loads the same private and shared records after verification.
- [ ] Offline active edit queues; offline restart fails clearly, without data reset.
- [ ] Upgrading the PWA preserves original and scoped DBs, outboxes and conflicts.
- [ ] Selected food/recipe copy can be interrupted and retried without duplication.
- [ ] Export/restore drill, backup ownership, retention, storage and provider costs.

Cloud sync does not guarantee recovery after clearing unsynced browser storage.
Do not equate Git version history (code) with a backup of users' kitchen data.

### Recovery procedure (operator-assisted V1)

1. Stop edits on the affected kitchen. Export a recovery copy; keep the original
   file immutable and private. If offline or revoked, don't clear browser storage.
2. Identify the original account/scope, pending operations and conflicts. Never
   replay another account's operation IDs or grant broad access to recover data.
3. Use conflict review for ordinary version conflicts. For deletions, compare
   tombstones/checkpoints and restore selected payloads with the current revision.
4. For provider failure, restore an independent database backup to an isolated
   project, verify account/scope relationships, then plan a controlled cutover.
5. Reopen the original account and verify counts, recipes and shopping. Preserve
   the pre-recovery export until the owner confirms the result.

### Deployment checklist

- [x] Local regression and isolated protocol tests run during development.
- [ ] Hosted staging gates above completed.
- [ ] Product owner verifies private/shared behavior with two accounts.
- [ ] Backup restore drill completed; rollout costs and quotas reviewed.
- [ ] Bump service-worker release cache and save a tagged production snapshot.
- [ ] Enable public config only for the tested intended project and deployment.
- [ ] Smoke-test deployed PWA updates and monitor errors/latency for 15 minutes.

Rollback on unexpected data exposure, lost writes, repeated auth failure, broken
account isolation or failing migrations. Disable cloud entry/config; preserve
server and local databases. Don't redeploy permissive legacy sync as a workaround.

## Rollback

Keep `enabled: false` and leave v62 deployed if staging fails. Do not delete or
reset local databases. Do not attempt to "fix" RLS by opening a policy to everyone.
The foundation tables are isolated from legacy data; deleting them is not a normal
rollback step. If preview accounts were created, review their cleanup separately.
