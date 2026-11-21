// Service worker: makes the game installable and playable offline.
// Bump VERSION to force old caches to be cleared.
const VERSION = 'v14';
const CACHE = `shape-invaders-${VERSION}`;
const CORE = [
  './',
  './manifest.webmanifest',
  './favicon.ico',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(CORE);
      // Also cache the hashed JS/CSS bundles referenced by the page.
      const html = await (await cache.match('./')).text();
      const assets = [...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map((m) => m[1]);
      await cache.addAll(assets);
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const key of await caches.keys()) if (key !== CACHE) await caches.delete(key);
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;

  if (req.mode === 'navigate') {
    // Page: network first so updates arrive, cached copy when offline.
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          const cache = await caches.open(CACHE);
          cache.put('./', res.clone());
          return res;
        } catch {
          return (await caches.match('./', { ignoreVary: true })) ?? Response.error();
        }
      })(),
    );
    return;
  }

  // Assets (hashed file names): cache first.
  event.respondWith(
    (async () => {
      // ignoreVary: module scripts send an Origin header that the precached entries don't have.
      const hit = await caches.match(req, { ignoreVary: true });
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) (await caches.open(CACHE)).put(req, res.clone());
      return res;
    })(),
  );
});
