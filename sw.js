// Makes the app open instantly and work without signal once it has been opened once.
const SHELL = 'ga-shell-v1';
const HEAVY = 'ga-heavy-v1'; // cutout engine + model: big files that never change

self.addEventListener('install', (e) => {
  self.skipWaiting();
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll([
    './', 'index.html', 'css/app.css', 'manifest.webmanifest',
    'js/app.js', 'js/cutout.js', 'js/db.js', 'js/editor.js', 'js/github.js', 'js/layouts.js', 'js/seg-worker.js', 'js/touchup.js',
    'assets/bg-brown.jpg', 'assets/bg-tan.jpg', 'assets/bg-espresso.jpg', 'assets/logo.png', 'assets/icon-180.png', 'assets/icon-192.png',
  ]).catch(() => {})));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== SHELL && k !== HEAVY) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  const url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  const heavy = /\/(models|vendor)\//.test(url.pathname);
  if (heavy) {
    e.respondWith((async () => {
      const cache = await caches.open(HEAVY);
      const hit = await cache.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok && res.status === 200) cache.put(req, res.clone()).catch(() => {});
      return res;
    })());
    return;
  }
  // App files: newest version when online, saved copy when offline.
  e.respondWith((async () => {
    const cache = await caches.open(SHELL);
    try {
      const res = await fetch(req);
      if (res.ok && res.status === 200) cache.put(req, res.clone()).catch(() => {});
      return res;
    } catch (err) {
      const hit = (await cache.match(req)) || (req.mode === 'navigate' && (await cache.match('index.html')));
      if (hit) return hit;
      throw err;
    }
  })());
});
