# Cloud kitchen verification — updated 2026-10-05

**Not a production app deployment report.** Live Stocked remains v62. The
user-owned staging project `qeqgxuubasxvpdvmvvda` is configured with all four
account/sync/security/deletion SQL migrations. The `stocked-delete-account`
Edge Function is deployed. The public frontend config is filled but disabled.

Real hosted authentication, PostgreSQL isolation, concurrent writes, browser
sync, TOTP and account deletion were tested on October 5 using two disposable
`@example.test` accounts created through the dashboard. These accounts were
confirmed by the operator for testing only: this is NOT an email-delivery test.
Both accounts were deleted through the actual app at the end of testing.
The final dashboard SQL check found zero remaining test accounts, kitchen records,
households or operation records. All five account/sync tables still had RLS enabled.

| Verification | Result | Boundary |
| --- | --- | --- |
| Existing app regression suites | 24 passed | Includes real local update/data-preservation and backup flows |
| Account database suite | 38 checks passed | PGlite PostgreSQL; synthetic Supabase identities |
| Account browser suite | Passed | Real UI with simulated Auth/RPC transport |
| Kitchen database suite | 32 checks passed | Private/shared RLS, grants, CAS, replay, tombstones, membership |
| Kitchen integration suite | 33 checks passed | Real app + IndexedDB + PGlite RPCs; simulated Auth transport |
| Hosted kitchen suite | 26 checks passed | Real Supabase Auth/REST, two accounts and two independent browser contexts |
| Security/deletion database suite | 15 checks passed | Real PGlite SQL; MFA boundary and transactional deletion |
| Hosted MFA browser suite | 9 checks passed | Enrollment, backup factor, challenge, wrong code, direct REST denial, removal |
| Deletion Edge Function handler | Passed | Actual handler; controlled upstream responses and all rejection paths |
| Hosted deletion suite | 8 checks passed | Actual account page, deployed function, Auth deletion and SQL cleanup |
| JS syntax and Git whitespace checks | Passed | Main app, cloud adapter, sharing UI, account UI |
| Sharing screens | Inspected at 390 / 1280 px | Also overflow-tested at 320 / 768 px |

The integration test covers different devices and same-browser tabs, offline
outbox, stale drafts, conflict retention, restart after a lost acknowledgement,
account changes, exact preservation of all original device stores, selected food
and recipe sharing, repeat-copy prevention, credential-free recovery export,
empty-browser preview and initialization, sign-out and revoked membership.

No real pantry data was used. Hosted fixtures included only synthetic food and
households. Local tests use disposable browser contexts and databases. Hosted
tests use the real SDK and real server; a loopback server enables configuration
only for those disposable browser contexts. No auth token or authenticator
secret is saved in test reports or screenshots.

Hosted checks establish that anonymous callers cannot read the five tables or
call account RPCs; direct table writes are denied; private records stay private
even from household owners; simultaneous edits yield one commit and one conflict;
replayed operations do not duplicate writes; revocation takes effect with an
existing token; another browser loads synced records and reconnecting uploads
offline edits. MFA is enforced on direct REST and RPCs. Account deletion blocks
owners with remaining members, removes private data, preserves shared member
contributions with author ID removed, and deletes the last member's household.

The server requires email verification and 12-character passwords, disallows
anonymous sign-in, and has secure email change and secure password change enabled.
Four exact redirect URLs are configured: live account/recovery and loopback
`127.0.0.1:4173` account/recovery. No wildcard callback is configured.

Evidence: `outputs/kitchen-sync/hosted-verification.json`,
`hosted-security-verification.json`, `hosted-deletion-verification.json`,
`account-security-390.png`, `account-deleted-390.png` (workspace outputs, not shipped).
Dashboard evidence: `supabase-email-security.png`, `supabase-cleanup-verified.png`.

Release blockers: no custom email sender/domain, no real signup/reset email
delivery checks, no physical-phone/installed-PWA callback check, and no independent
database backup/restore drill. All-authenticators-lost recovery remains an operator
identity-verification process, not self-service recovery codes. Broad signup stays
disabled in the frontend until these rollout requirements are resolved.
Full snapshots are bounded
to 5,000 records; an open cloud kitchen supports queued offline edits, but a new
cloud page requires an online authorization check. Remote changes require a
deliberate reload; there is no advertised instantaneous realtime merge.
