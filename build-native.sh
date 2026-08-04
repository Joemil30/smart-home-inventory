#!/bin/sh
# Assemble www/ for the Capacitor wrap.
#
# There is no build step in this project and there isn't one here either —
# this only copies the files that must ship inside the binary, and refuses
# to run if anything required is missing. That refusal matters: an app that
# ships without sw.js still launches, still looks fine, and silently loses
# the offline behaviour that is the whole point of it.
#
#   sh build-native.sh          # populate www/
#   npx cap sync                # push it into ios/ and android/
#
set -eu
cd "$(dirname "$0")"

REQUIRED="index.html sw.js manifest.webmanifest icon.svg apple-touch-icon.png zxing.min.js supabase.min.js my-list.json"
OPTIONAL_DIRS="tess"

missing=""
for f in $REQUIRED; do
  [ -f "$f" ] || missing="$missing $f"
done
if [ -n "$missing" ]; then
  echo "Refusing to build — missing:$missing" >&2
  exit 1
fi

rm -rf www
mkdir -p www

for f in $REQUIRED; do
  cp "$f" www/
done

# Vendored OCR data, if it's present. Several MB, and the date scanner falls
# back to the AI reader without it, so it's a warning rather than an error.
for d in $OPTIONAL_DIRS; do
  if [ -d "$d" ]; then cp -R "$d" www/; else echo "note: $d/ not found — on-device date OCR will be unavailable" >&2; fi
done

# The service worker's cache-first shell is what makes the app work with the
# network off. Inside a Capacitor binary the assets are already local, so the
# worker is belt-and-braces rather than load-bearing — but leaving it out
# would change behaviour between the web and native builds for no reason.
echo "www/ ready ($(find www -type f | wc -l | tr -d ' ') files, $(du -sh www | cut -f1))"
echo
echo "Next:"
echo "  npx cap sync"
echo "  npx cap open android     # Android Studio — works on any OS"
echo "  npx cap open ios         # Xcode — macOS only"
