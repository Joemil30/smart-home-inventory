/* Cold Room — offline shell.
   The whole reason this exists: your downstairs freezer has bad wifi,
   and an inventory app that won't load in the basement is a dead app.
   App shell is cache-first. Live data is IndexedDB, so it never needs
   the network at all. Only barcode lookups and Gemini do. */

const CACHE = 'coldroom-v5';        // app shell — wiped on each version bump
const IMG = 'coldroom-img';         // product thumbnails — kept across app updates
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png', './zxing.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      // keep the shell for this version and the persistent image cache; drop the rest
      .then(ks => Promise.all(ks.filter(k => k !== CACHE && k !== IMG).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Is this an Open Food Facts *image* (not the JSON API)? Those we cache so
// thumbnails still show in the basement; the API JSON we never cache.
const isOffImage = url =>
  url.hostname.includes('openfoodfacts') && !url.pathname.includes('/api/') &&
  /\.(jpg|jpeg|png|webp)$/i.test(url.pathname);

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Product images: cache-first into the persistent image cache (offline-friendly).
  if (isOffImage(url)) {
    e.respondWith(
      caches.match(request).then(hit => hit || fetch(request).then(res => {
        // res may be opaque (cross-origin no-cors) — still cacheable for <img>.
        if (res && (res.ok || res.type === 'opaque')) {
          const copy = res.clone();
          caches.open(IMG).then(c => c.put(request, copy));
        }
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // Never cache the JSON APIs — a stale product lookup or recipe is worse than none.
  if (url.hostname.includes('openfoodfacts') || url.hostname.includes('googleapis')) return;

  // App shell: serve from cache instantly, refresh in the background.
  e.respondWith(
    caches.match(request).then(hit => {
      const net = fetch(request)
        .then(res => {
          if (res.ok && url.origin === location.origin) {
            const copy = res.clone();
            caches.open(CACHE).then(c => c.put(request, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || net;
    })
  );
});
