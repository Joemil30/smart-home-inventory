# iOS Safari quirks — running log

This is the one that matters most going forward: **every real bug found on
this project so far was invisible to the automated test suite**
(`[[09 Testing]]` runs headless Chromium) and only showed up on the user's
actual iPhone in Safari. Add to this file the moment a new one turns up.

## `file://` blocks IndexedDB entirely
Opening a `.html` backup snapshot directly (double-tapping it in the Files
app, or from iCloud Drive) loads it over the `file://` scheme. WebKit
refuses IndexedDB for `file://` origins — `indexedDB.open()` throws.
Before the fix, this happened inside `boot()`'s unguarded
`await DB.init()`, so `render()` never ran: the page painted its CSS
background and then did nothing, which reads to a user as "it opened but
shows up as nothing, just the app colors."

**Fix (2026-07-28):** `DB.init()` now falls back to an in-memory store
(plain Maps, same `get/all/put/del` interface) when `indexedDB.open()`
rejects. The snapshot opens and shows data; it just won't persist edits
after the tab closes, which is the correct behavior for a "view a backup"
file anyway.

## Home-screen icon/name is a one-time snapshot
See `[[07 Icon and Branding]]` — iOS never re-reads the manifest for an
existing "Add to Home Screen" shortcut. Any icon/name change requires
delete-and-re-add, not just shipping new code.

## `github.com` vs `github.io` confusion
The user spent a while trying to use `https://github.com/Joemil30/
smart-home-inventory` (the source-code viewer) as if it were the app. The
actual live app is `https://joemil30.github.io/smart-home-inventory/`.
Worth double-checking which one a confused report is actually about before
assuming a code bug.

## Standing rule
When a user report doesn't match what the code should do, and the user is
on an iPhone, suspect a Safari/WebKit-specific behavior before suspecting
the test suite is wrong — the tests have been right every time so far; the
assumption that desktop-headless-Chromium behavior transfers to iOS Safari
has been wrong every time.
