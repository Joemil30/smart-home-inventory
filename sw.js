/* Cold Room — offline shell.
   The whole reason this exists: your downstairs freezer has bad wifi,
   and an inventory app that won't load in the basement is a dead app.
   App shell is cache-first. Live data is IndexedDB, so it never needs
   the network at all. Only barcode lookups and Gemini do. */

const CACHE = 'coldroom-v3';
const SHELL = ['./', './index.html', './manifest.webmanifest', './icon.svg', './apple-touch-icon.png', './zxing.min.js'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const { request } = e;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  // Never cache the APIs — a stale product lookup or recipe is worse than none.
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
