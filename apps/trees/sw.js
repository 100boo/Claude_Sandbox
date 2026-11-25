/* Grove service worker: offline app shell, plus a capped cache of map tiles you've viewed. */
importScripts('version.js');

const CACHE = 'grove-' + self.APP_VERSION;
const TILES = 'grove-tiles-v1';
const MAX_TILES = 2000;
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'version.js',
  'geo.js',
  'db.js',
  'app.js',
  'vendor/leaflet.js',
  'vendor/leaflet.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) if (key.startsWith('grove-') && key !== CACHE && key !== TILES) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (url.hostname === 'tile.openstreetmap.org') {
    event.respondWith(tile(req));
    return;
  }
  if (url.origin !== self.location.origin) return;

  // Stale-while-revalidate for the app shell.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(req, { ignoreSearch: true });
    const fresh = fetch(req).then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(fresh); return cached; }
    return (await fresh) || (req.mode === 'navigate' ? cache.match('index.html') : Response.error());
  })());
});

// Network first so the map stays current; fall back to the last copy when offline.
async function tile(req) {
  const cache = await caches.open(TILES);
  try {
    const res = await fetch(req);
    if (res.ok) {
      await cache.put(req, res.clone());
      trim(cache);
    }
    return res;
  } catch {
    return (await cache.match(req)) || Response.error();
  }
}

let trimming = false;
async function trim(cache) {
  if (trimming) return;
  trimming = true;
  try {
    const keys = await cache.keys();
    for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]);
  } finally {
    trimming = false;
  }
}
