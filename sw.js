/* ShelfLife — offline shell.
   The whole reason this exists: your downstairs freezer has bad wifi,
   and an inventory app that won't load in the basement is a dead app.
   App shell is cache-first. Live data is IndexedDB, so it never needs
   the network at all. Only barcode lookups and Gemini do. */

/* BUMP THIS ON EVERY RELEASE. The fetch handler below is cache-first, so a
   phone that already installed the app keeps serving the shell it cached
   until this string changes — if sw.js is byte-identical the browser never
   even re-registers, and shipped fixes silently never arrive. */
const CACHE = 'shelflife-v36';      // app shell — wiped on each version bump
const IMG = 'shelflife-img';        // product thumbnails — kept across app updates
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png', './zxing.min.js'];

/* Push notifications: show the payload, and focus the app on tap. */
self.addEventListener('push', e => {
  let d = {}; try { d = e.data ? e.data.json() : {}; } catch (x) { d = { body: e.data && e.data.text() }; }
  e.waitUntil(self.registration.showNotification(d.title || 'ShelfLife', {
    body: d.body || '', icon: './apple-touch-icon.png', badge: './apple-touch-icon.png',
    tag: d.tag || 'shelflife', data: { url: d.url || './' },
  }));
});
self.addEventListener('notificationclick', e => {
  e.notification.close();
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(cs => {
    for (const c of cs) if ('focus' in c) return c.focus();
    return clients.openWindow(e.notification.data?.url || './');
  }));
});

self.addEventListener('install', e => {
  // {cache:'reload'} forces each shell file past the HTTP cache. Without it a
  // fresh install can re-cache the very same stale index.html it was meant to
  // replace, and the new version never actually lands.
  e.waitUntil(
    caches.open(CACHE)
      .then(c => c.addAll(SHELL.map(u => new Request(u, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
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
