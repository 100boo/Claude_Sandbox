/*
 * IndexedDB storage, shared by the page (window.DB) and the service worker
 * (importScripts('db.js') -> self.DB).
 *
 * Stores:
 *   meta     { id, title, author, format, cover, chapterTitles[], chapterLens[],
 *              totalParas, pos: {ch, p}, addedAt, openedAt }   (small: listed often)
 *   content  { id, chapters: [{ title, paras[] }] }             (big: loaded on open)
 *   inbox    { id, name, type, data: ArrayBuffer, at }          (files shared to the app)
 */
(function (root) {
  'use strict';
  const NAME = 'narrator';
  const VERSION = 1;
  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('content')) db.createObjectStore('content', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('inbox')) db.createObjectStore('inbox', { keyPath: 'id', autoIncrement: true });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }

  function reqP(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function tx(stores, mode, fn) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode);
      let result;
      Promise.resolve(fn(t)).then((r) => { result = r; }, reject);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  const DB = {
    open,

    listBooks: () => tx(['meta'], 'readonly', (t) => reqP(t.objectStore('meta').getAll())),
    getMeta: (id) => tx(['meta'], 'readonly', (t) => reqP(t.objectStore('meta').get(id))),
    putMeta: (meta) => tx(['meta'], 'readwrite', (t) => { t.objectStore('meta').put(meta); }),
    getContent: (id) => tx(['content'], 'readonly', (t) => reqP(t.objectStore('content').get(id))),

    addBook: (meta, chapters) => tx(['meta', 'content'], 'readwrite', (t) => {
      t.objectStore('meta').put(meta);
      t.objectStore('content').put({ id: meta.id, chapters });
    }),

    deleteBook: (id) => tx(['meta', 'content'], 'readwrite', (t) => {
      t.objectStore('meta').delete(id);
      t.objectStore('content').delete(id);
    }),

    addToInbox: (file) => tx(['inbox'], 'readwrite', (t) => { t.objectStore('inbox').add(file); }),

    /** Return and remove everything waiting in the inbox. */
    drainInbox: () => tx(['inbox'], 'readwrite', (t) => new Promise((resolve, reject) => {
      const store = t.objectStore('inbox');
      const req = store.getAll();
      req.onsuccess = () => { store.clear(); resolve(req.result); };
      req.onerror = () => reject(req.error);
    })),
  };

  root.DB = DB;
})(typeof self !== 'undefined' ? self : this);
