/* Service worker.
   Strategy:
   - App shell (HTML + model.js): NETWORK-FIRST, fall back to cache when offline.
     => whenever you're online you get the latest code automatically; offline
        you still get the last-good cached version. No manual cache-busting.
   - Static assets (icons, manifest): CACHE-FIRST (they rarely change).
   Bump CACHE whenever the asset list or strategy changes. */
const CACHE = 'workout-v1';
const ASSETS = [
  './', './index.html', './model.js', './manifest.webmanifest',
  './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/icon-180.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isShell(url) {
  return url.pathname.endsWith('/') || url.pathname.endsWith('/index.html') || url.pathname.endsWith('/model.js');
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);

  if (isShell(url) || e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(e.request).then(hit => hit || caches.match('./index.html')))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then(hit => hit || fetch(e.request).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(e.request, copy)).catch(() => {});
      return res;
    }).catch(() => undefined))
  );
});
