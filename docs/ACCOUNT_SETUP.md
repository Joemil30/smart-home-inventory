# Account foundation: setup and release gates

**Development preview only. The live v62 application has not been switched to this system.**

Implemented: email/password signup and sign-in, verification resend, password
reset/update, SDK-managed sessions, household creation, invitation preview/join,
roster, removal/leave and ownership transfer. Also implemented in development:
private/household cloud kitchens, revision-checked syncing, selected food/recipe
transfer, offline outbox, conflict review and recovery export. Hosted verification
passed with two disposable staging accounts on 2026-10-05; see `CLOUD_VERIFICATION.md`.

Implemented next: TOTP enrollment, challenge, backup authenticator and removal;
server MFA enforcement; account deletion with fresh password and optional MFA,
transactional private-data cleanup and shared-contribution preservation.
Not implemented: self-service recovery when all authenticators are lost, social
sign-in, automated off-site backup or notification delivery. Email sender setup
and real verification/reset delivery remain incomplete.

## Operator setup — staging first

1. Choose a Supabase project owned by the user. Prefer a fresh staging project.
   Do not repurpose a legacy project or apply SQL to production without reviewing
   current tables, policies, data and backups. This schema refuses cloud activation
   if `public.sync` exists and does not modify that table.
2. For the project creation security settings: **Data API ON**, **Automatically
   expose new tables OFF**, **Automatic RLS ON**. Keep the strong database password
   in the owner's password manager, never source control or chat. The Data API
   is needed for authenticated RPCs; it does not grant unauthenticated data access.
   Apply `supabase/accounts-foundation.sql`, `supabase/kitchen-sync.sql`,
   `supabase/account-security.sql`, then `supabase/account-deletion.sql` in
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

Deploy `stocked-delete-account` from the matching function directory after the
SQL migrations. Its server-only service credential is supplied by Supabase;
never put it in browser config. Gateway JWT verification remains ON, and the
function independently verifies identity, recent password sign-in, MFA and
ownership. Enable `accountDeletion` only with the tested function/schema pair.

Encourage a second authenticator as a backup. Supabase does not provide recovery
codes here. If both are lost, the project owner must independently verify identity
before removing a factor in the Auth dashboard. A household owner has no authority
to bypass another member's MFA. Password reset must not disable MFA.

## Tests

```sh
# Existing project test environment also needs Chromium/Playwright.
PLAYWRIGHT_MODULE=playwright CHROME_PATH=/path/to/chrome node test/accounts-ui-test.js

# Install this development-only test dependency through npm if needed:
npm install --no-save --ignore-scripts @electric-sql/pglite@0.5.8
node test/accounts-db-test.js
node test/kitchen-db-test.js
node test/kitchen-sync-test.js
node test/account-security-db-test.js
node test/account-deletion-function-test.js
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
- [x] Two different households cannot read/write one another's rows via direct REST requests.
- [ ] Anonymous and unverified callers cannot perform household operations.
- [ ] Simultaneous create/join/revoke/remove/transfer calls preserve membership and one owner.
- [ ] Removing a member revokes server access; other tabs do not display stale account data.
- [ ] Existing pantry records unchanged throughout signup, sign-in, invite acceptance and sign-out.
- [ ] No legacy permissive tables, leaked secret keys or diagnostic token logging.
- [x] TOTP, backup authenticator and account deletion verified on staging; lost-all-factors recovery is operator-assisted.
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

- [x] Anonymous REST access to all five account/sync tables and account RPC denied.
- [x] Hosted REST as two Auth users proves owner cannot read member private data.
- [ ] Concurrent edits, removal versus write, and lost responses on hosted Postgres.
- [ ] Fresh phone loads the same private and shared records after verification.
- [ ] Offline active edit queues; offline restart fails clearly, without data reset.
- [ ] Upgrading the PWA preserves original and scoped DBs, outboxes and conflicts.
- [ ] Selected food/recipe copy can be interrupted and retried without duplication.
- [ ] Export/restore drill, backup ownership, retention, storage and provider costs.

Cloud sync does not guarantee recovery after clearing unsynced browser storage.
Do not equate Git version history (code) with a backup of users' kitchen data.

### Hosted test runner

`test/hosted-kitchen-test.js`, `test/hosted-account-security-test.js`, and
`test/hosted-account-deletion-test.js` are opt-in. They require `STOCKED_TEST_URL`,
`STOCKED_TEST_KEY` (publishable only), and owner/member email/password environment
variables named `STOCKED_TEST_OWNER_EMAIL`, `STOCKED_TEST_OWNER_PASSWORD`,
`STOCKED_TEST_MEMBER_EMAIL`, `STOCKED_TEST_MEMBER_PASSWORD`. Only disposable emails
matching `stocked-test-…@example.test` are accepted. Never use a genuine account.
Create confirmed test users through the staging dashboard without sending mail.
Run kitchen, then security, then deletion tests. Between kitchen and deletion,
remove only the second empty test household identified in the kitchen report so
the member can rejoin the first. Deletion tests permanently remove both fixture
accounts through the app. Reports contain IDs/results, never credentials.

The MFA test creates and removes two factors. If interrupted, remove only those
test factors before retrying. The scripts are intentionally excluded from normal
regressions to prevent accidental external writes.

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
