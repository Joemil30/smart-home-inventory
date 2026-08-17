# Running two builds of the app at once

The 29 July build is served at `/old/` so the two designs can be compared on
one phone rather than from memory. Both are installable; the old one has a
banded icon and a banner so they can't be confused.

Mostly worth writing down because copying the files was the easy part, and
two things about it would have quietly damaged the live app.

## The service workers would have wiped each other

**Cache Storage is per-ORIGIN, not per-path.** Both workers' `activate`
handlers did the usual thing — delete every cache that isn't mine:

```js
ks.filter(k => k !== CACHE && k !== IMG).map(k => caches.delete(k))
```

So each launch of one app would delete the other's offline shell, and the
other would return the favour on its next launch. The app would still work
online, which is exactly what makes it a nasty bug: offline would break
intermittently for both, and nothing would look wrong.

Both now sweep only their own family — `stocked-*` for the live app,
`sidebyside-old-*` for the copy.

## IndexedDB is per-origin too

Without intervention the old build would have been reading and writing the
**real family database**. Anything done while "just comparing" would have
been done for real.

It uses `coldroom-sidebyside` instead, and copies the live database in once
on first run, **opened read-only**. Verified by deleting an item in the old
build and confirming the live app still had it.

Consequence worth knowing: the old copy is a *snapshot*. Food added there
never reaches the family. It's a showroom, not a kitchen.

## Two smaller things

- The old build kept offering **"a new version is ready"** on seeing the live
  app's newer worker. That's a promise a frozen snapshot cannot keep, so it's
  silenced there.
- **iOS uses `apple-touch-icon.png` and ignores the manifest icon**
  (`[[08 iOS Safari Quirks]]`), so the banded "JUL 29" icon had to be
  rasterised as a real PNG. Without that both home-screen icons look
  identical and the comparison is useless the moment you close one.

## Deleting it

Remove the `old/` directory and push. Nothing else references it, and the
isolated database is discarded with the site data.
