/* Narrator service worker: offline app shell + Android share-target inbox. */
importScripts('version.js', 'db.js');

// Every app in this repo shares one origin (and so one Cache Storage), so cache
// names are namespaced per app and we only ever delete our own.
const PREFIX = 'sandbox/narrator/';
const CACHE = PREFIX + self.APP_VERSION;
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'version.js',
  'db.js',
  'parsers.js',
  'app.js',
  'vendor/jszip.min.js',
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
    for (const key of await caches.keys()) {
      if (key.startsWith(PREFIX) && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;

  if (event.request.method === 'POST' && url.pathname.endsWith('/share-target')) {
    event.respondWith(handleShare(event.request));
    return;
  }
  if (event.request.method !== 'GET') return;

  // Stale-while-revalidate: instant offline loads, updates picked up next launch.
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const isNav = event.request.mode === 'navigate';
    const cached = await cache.match(isNav ? 'index.html' : event.request, { ignoreSearch: isNav });
    const network = fetch(event.request).then((res) => {
      if (res.ok && !isNav) cache.put(event.request, res.clone());
      return res;
    }).catch(() => null);
    if (cached) { event.waitUntil(network); return cached; }
    return (await network) || new Response('Offline', { status: 503 });
  })());
});

async function handleShare(request) {
  try {
    const form = await request.formData();
    const files = form.getAll('files').filter((f) => f && typeof f.arrayBuffer === 'function');
    for (const f of files) {
      await DB.addToInbox({ name: f.name || 'Shared file', type: f.type, data: await f.arrayBuffer(), at: Date.now() });
    }
    const text = (form.get('text') || '').toString();
    if (!files.length && text.trim() && !/^\s*https?:\/\/\S+\s*$/.test(text)) {
      const title = (form.get('title') || 'Shared text').toString().replace(/[\\/:*?"<>|]/g, ' ');
      await DB.addToInbox({ name: title + '.txt', type: 'text/plain', data: new TextEncoder().encode(text).buffer, at: Date.now() });
    }
    for (const c of await self.clients.matchAll({ type: 'window' })) c.postMessage({ type: 'inbox' });
  } catch (e) {
    console.error('share failed', e);
  }
  return Response.redirect('./?shared=1', 303);
}
