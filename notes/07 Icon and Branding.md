# Icon and branding

## Name history
Cold Room (launch name) → **ShelfLife** (2026-07-19 rebrand) →
**Stocked** (2026-07-28, current). Chosen for being the plain-English word
that covers the app's actual scope: pantry inventory, shelf life, shopping
lists, and meals — "ShelfLife" undersold the meal-planning and shopping
sides.

## Current icon
A bowl (the food half the name doesn't say) under a check (handled, in
stock, ticked off the list). Dark ground with the app's own dark-mode
accent green, so the icon and the app read as the same product. Deliberately
two flat shapes, no fine detail, so it survives every size a home screen
throws at it.

Geometry is maskable-safe: every painted pixel sits inside the centre
circle (radius 204 of a 512 viewBox) that Android's launcher crops to —
tested clipping at 29px–120px against both iOS's ~22.5% corner rounding and
Android's circular crop; nothing gets cut off.

Files: `icon.svg` (web/manifest), `apple-touch-icon.png` (180×180, iOS).

## The renamed-cache trap
`sw.js`'s image cache is still literally named `'shelflife-img'` after the
rename to Stocked — **on purpose**. That cache holds every product
thumbnail already downloaded; renaming the cache key would orphan all of
them and blank out photos for anyone using the app offline. The app-shell
cache (`CACHE`) does get a fresh name/version on every release; the image
cache doesn't, ever, regardless of app name.

## The stale-icon trap (real, hit this project)
iOS reads the icon and app name from `manifest.webmanifest` /
`apple-touch-icon.png` **exactly once** — the moment "Add to Home Screen"
is tapped. After that, the home-screen shortcut is a frozen snapshot; it
does not re-check the manifest, ever, the way the app's own content updates
live via the service worker. Changing the icon/name in code does nothing
for an already-installed shortcut.

**The only fix:** delete the old home-screen shortcut (long-press →
Remove App) and re-add it fresh from Safari (Share → Add to Home Screen).
Always tell the user to back up first (`[[05 Backup and Restore]]`) before
doing this, as a safety habit — the data itself lives keyed to the site
origin, not the icon, so it should survive, but backups are cheap insurance.
