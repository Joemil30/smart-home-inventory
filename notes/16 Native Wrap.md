# The native wrap

Written 2026-08-04. Scaffolding is committed; nothing is built, because
building it needs hardware and accounts that don't exist yet. This is the
file to open on the day they do.

Related: `[[12 Going Public]]` (the four gates), `[[15 Auth and Hardening]]`
(what must land before strangers).

## What's already in the repo

- `capacitor.config.json` — app id `app.coldroom.pantry`, `webDir: www`.
- `build-native.sh` — assembles `www/` from the files already here. No build
  step, because the project has none. It **refuses to run** if a required
  file is missing, which matters: an app that ships without `sw.js` still
  launches and still looks right, and silently loses the offline behaviour
  that is the entire point.
- `.gitignore` for `www/`, `ios/`, `android/` — all regenerable, all full of
  machine-specific paths.

## The whole sequence

```sh
npm install @capacitor/cli @capacitor/core @capacitor/android @capacitor/ios
sh build-native.sh
npx cap add android          # any OS
npx cap add ios              # macOS only
npx cap sync
npx cap open android
```

After **every** change to `index.html`: `sh build-native.sh && npx cap sync`.
Forgetting that ships the previous version — and unlike the web app, there's
no cache-bump to save you.

## Android first, deliberately

$25 once, no Mac, review in hours, and no age-of-majority friction in
practice. Every store asset (screenshots, description, privacy URL, content
rating, data-safety form) gets built once here and reused for Apple later.

The Play data-safety form must match `privacy.html`. If the hosted backend
from `[[15 Auth and Hardening]]` is live by then, the answer to "does your
app collect data?" changes from no to yes — say so. A mismatch is a takedown,
not a warning.

## What Apple will actually check

- **Guideline 4.2, minimum functionality.** A wrapper that loads a remote URL
  is a near-certain rejection. Capacitor bundles the app *inside* the binary,
  which is the difference. Lead the review notes with the native capabilities:
  camera, barcode scanning, on-device OCR, notifications, offline storage.
- **Guideline 5.1.1(v)**, in-app account deletion — built, see
  `[[15 Auth and Hardening]]`.
- **Guideline 4.8**, Sign in with Apple — avoided by offering email-only.
- **App Privacy nutrition label** must match reality and `privacy.html`.
- **Icon**: 1024×1024 PNG, opaque, square, **no alpha channel and no
  pre-rounded corners**. Both stores reject alpha and round it themselves.
  `icon.svg` needs exporting and flattening; don't upload the SVG.

## Only after the wrap exists

These four were chosen from the reference apps and are genuinely impossible
in a PWA. Nothing about them is started:

- **Home-screen widgets** — SwiftUI (`WidgetKit`) on iOS, Kotlin
  (`AppWidgetProvider`) on Android. Real native code, not configuration. The
  most-loved feature in the reference set.
- **Siri / App Intents** — but note the PWA already answers to `?add=`, so
  "Hey Siri, add milk" works *today* through a Shortcut. Native App Intents
  make it feel first-party; they don't unlock the capability.
- **Geofenced reminders** — background location, which needs a native
  permission and a documented justification at review.
- **Pickup / delivery ordering** — partner APIs and ongoing maintenance. Not
  a solo roadmap item; kept on the list only because the user asked for it.

## The honest cost

$99/year Apple, forever — the app delists if it lapses. $25 once for Google.
A Mac for Xcode. And once real users exist, Supabase Pro at $25/month,
because the free tier pauses a project after 7 days idle.
