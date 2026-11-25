/* Grove storage (IndexedDB).
   entries: { id, createdAt, updatedAt, lat, lng, accuracy, locSource, species, notes,
              photos: [{ id, thumb: Blob }], photoCount }
   photos:  { id, entryId, blob }   full-size images, loaded only when an entry is opened */
(function (root) {
  'use strict';
  const NAME = 'grove';
  const VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('photos')) {
          db.createObjectStore('photos', { keyPath: 'id' }).createIndex('entryId', 'entryId');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  const done = (tx) => new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = tx.onabort = () => reject(tx.error);
  });
  const result = (req) => new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

  async function listEntries() {
    const db = await open();
    return result(db.transaction('entries').objectStore('entries').getAll());
  }

  async function getPhoto(id) {
    const db = await open();
    const rec = await result(db.transaction('photos').objectStore('photos').get(id));
    return rec ? rec.blob : null;
  }

  /** Save an entry. `newPhotos` = [{ id, blob }] to add; photos dropped from entry.photos are deleted. */
  async function saveEntry(entry, newPhotos = []) {
    const db = await open();
    const tx = db.transaction(['entries', 'photos'], 'readwrite');
    const photos = tx.objectStore('photos');
    const keep = new Set(entry.photos.map((p) => p.id));
    const existing = await result(photos.index('entryId').getAllKeys(entry.id));
    for (const id of existing) if (!keep.has(id)) photos.delete(id);
    for (const p of newPhotos) photos.put({ id: p.id, entryId: entry.id, blob: p.blob });
    tx.objectStore('entries').put({ ...entry, photoCount: entry.photos.length });
    await done(tx);
  }

  async function deleteEntry(id) {
    const db = await open();
    const tx = db.transaction(['entries', 'photos'], 'readwrite');
    const photos = tx.objectStore('photos');
    for (const key of await result(photos.index('entryId').getAllKeys(id))) photos.delete(key);
    tx.objectStore('entries').delete(id);
    await done(tx);
  }

  root.GroveDB = { open, listEntries, getPhoto, saveEntry, deleteEntry };
})(typeof self !== 'undefined' ? self : this);
