// IndexedDB persistence: items (tasks/notes/events/folders/tags), files (attachments), meta (settings etc).
const DB_NAME = 'jamday';
const DB_VERSION = 1;
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('items')) db.createObjectStore('items', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbp;
}

function tx(store, mode, fn) {
  return open().then((db) => new Promise((resolve, reject) => {
    const t = db.transaction(store, mode);
    const s = t.objectStore(store);
    let result;
    Promise.resolve(fn(s)).then((r) => { result = r; });
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}

const reqP = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const db = {
  open,
  allItems: () => tx('items', 'readonly', (s) => reqP(s.getAll())),
  putItems: (items) => tx('items', 'readwrite', (s) => { items.forEach((i) => s.put(i)); }),
  deleteItems: (ids) => tx('items', 'readwrite', (s) => { ids.forEach((id) => s.delete(id)); }),
  clearItems: () => tx('items', 'readwrite', (s) => s.clear()),
  getMeta: (key) => tx('meta', 'readonly', (s) => reqP(s.get(key))).then((r) => (r ? r.value : undefined)),
  setMeta: (key, value) => tx('meta', 'readwrite', (s) => { s.put({ key, value }); }),
  putFile: (rec) => tx('files', 'readwrite', (s) => { s.put(rec); }),
  getFile: (id) => tx('files', 'readonly', (s) => reqP(s.get(id))),
  deleteFile: (id) => tx('files', 'readwrite', (s) => { s.delete(id); }),
  allFileKeys: () => tx('files', 'readonly', (s) => reqP(s.getAllKeys())),
  async clearAll() {
    await tx('items', 'readwrite', (s) => s.clear());
    await tx('files', 'readwrite', (s) => s.clear());
    await tx('meta', 'readwrite', (s) => s.clear());
  },
  async estimate() {
    try { return await navigator.storage.estimate(); } catch { return null; }
  },
};
