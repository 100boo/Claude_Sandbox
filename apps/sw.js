/*
 * Cleanup worker for the site root. Narrator used to live at the root and
 * installed a service worker here. Browsers that still have it will fetch
 * this file on their next visit; it removes the old worker and its cache,
 * then reloads the page so the launcher shows. Nothing registers this file
 * itself. Safe to delete once old installs are gone (e.g. a few months after the 0.1.1 move).
 */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (/^narrator-\d/.test(key)) await caches.delete(key); // old root Narrator cache only
    }
    await self.registration.unregister();
    for (const c of await self.clients.matchAll({ type: 'window' })) c.navigate(c.url);
  })());
});
