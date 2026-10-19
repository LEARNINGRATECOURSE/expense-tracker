/* Offline-first service worker.
   - The app shell is precached into ONE versioned cache and served cache-first, so a page never
     mixes files from two deploys.
   - VERSION is stamped per deploy by .github/workflows/pages.yml; bump it by hand when serving elsewhere. */
const VERSION = 'kharcha-dev';
const FONTS = 'kharcha-fonts';
const SHELL = [
  './', './index.html', './manifest.webmanifest', './css/styles.css',
  './js/app.js', './js/store.js', './js/views.js', './js/forms.js', './js/lock.js', './js/util.js',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png', './icons/icon-maskable-512.png', './icons/apple-touch-icon.png',
];
const scopePath = new URL('./', self.location).pathname;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    // `reload` bypasses the HTTP cache (GitHub Pages sends max-age=600) so we never precache stale files.
    await Promise.all(SHELL.map(async (u) => {
      const r = await fetch(new Request(u, { cache: 'reload' }));
      if (!r.ok) throw new Error(`${u} -> ${r.status}`);
      await cache.put(u, r);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    // Only touch our own caches: github.io origins are shared with the owner's other projects.
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k.startsWith('kharcha-') && k !== VERSION && k !== FONTS).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Google Fonts: stale-while-revalidate in a cache that survives app updates.
  if (url.origin === 'https://fonts.googleapis.com' || url.origin === 'https://fonts.gstatic.com') {
    e.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      const net = fetch(req).then((r) => { if (r.ok) cache.put(req, r.clone()); return r; }).catch(() => hit || Response.error());
      return hit || net;
    })());
    return;
  }
  if (url.origin !== location.origin) return;

  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const r = await fetch(req);
      if (r.ok) cache.put(req, r.clone());
      return r;
    } catch {
      // Offline: only the app root maps to the shell; anything else must not render a broken page.
      if (req.mode === 'navigate' && (url.pathname === scopePath || url.pathname === scopePath + 'index.html')) return cache.match('./index.html');
      return Response.error();
    }
  })());
});
