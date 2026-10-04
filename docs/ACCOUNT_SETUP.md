# Account foundation: setup and release gates

**Development preview only. The live v62 application has not been switched to this system.**

Implemented: email/password signup and sign-in, verification resend, password
reset/update, SDK-managed sessions, household creation, invitation preview/join,
roster, removal/leave and ownership transfer. Not implemented: inventory transfer,
family inventory sync, MFA enrollment/challenge/recovery, complete account deletion,
social sign-in, background backup or notification delivery.

## Operator setup — staging first

1. Choose a Supabase project owned by the user. Prefer a fresh staging project.
   Do not repurpose a legacy project or apply SQL to production without reviewing
   current tables, policies, data and backups. This schema refuses cloud activation
   if `public.sync` exists and does not modify that table.
2. Apply `supabase/accounts-foundation.sql` in staging. It is rerunnable and adds
   only the new tables, their named policies and functions. Inspect the result.
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
7. Open `/account.html`. This page intentionally does not register the pantry
   service worker or connect legacy SYNC. Signing in never uploads local food.

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

## Inventory transfer and sync: separate next stage

The account preview must not mark itself "Synced". Before linking a kitchen,
show local and cloud counts and a review of the intended transfer. Preserve a
recoverable local backup. Store each account/household in a separate local scope;
signing out or changing accounts must never upload the previous user's records.
Use acknowledged writes, durable offline operations and server revisions. Surface
conflicts rather than silently dropping edits. Test two devices, disconnects,
repeated taps and restart during transfer.

## Rollback

Keep `enabled: false` and leave v62 deployed if staging fails. Do not delete or
reset local databases. Do not attempt to "fix" RLS by opening a policy to everyone.
The foundation tables are isolated from legacy data; deleting them is not a normal
rollback step. If preview accounts were created, review their cleanup separately.
