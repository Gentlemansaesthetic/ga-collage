// Storage on the phone (IndexedDB): looks, settings, custom backgrounds.
const NAME = 'ga-collage';
let dbp = null;

function open() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const r = indexedDB.open(NAME, 1);
    r.onupgradeneeded = () => {
      const db = r.result;
      if (!db.objectStoreNames.contains('looks')) db.createObjectStore('looks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('kv')) db.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
  return dbp;
}

async function tx(store, mode, fn) {
  const db = await open();
  return new Promise((res, rej) => {
    const t = db.transaction(store, mode);
    const out = fn(t.objectStore(store));
    t.oncomplete = () => res(out && 'result' in out ? out.result : undefined);
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

export const getLook = (id) => tx('looks', 'readonly', (s) => s.get(id));
export const putLook = (look) => tx('looks', 'readwrite', (s) => s.put(look));
export const deleteLook = (id) => tx('looks', 'readwrite', (s) => s.delete(id));
export const allLooks = async () => {
  const list = (await tx('looks', 'readonly', (s) => s.getAll())) || [];
  return list.sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
};
export const kvGet = (k) => tx('kv', 'readonly', (s) => s.get(k));
export const kvSet = (k, v) => tx('kv', 'readwrite', (s) => s.put(v, k));
export const kvDel = (k) => tx('kv', 'readwrite', (s) => s.delete(k));

// Ask the phone to keep our data even when storage runs low.
export function persist() {
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
}
