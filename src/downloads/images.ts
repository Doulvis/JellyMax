// Images des titres téléchargés, gardées dans IndexedDB pour s'afficher hors connexion.

const DB = 'jellymax-downloads';
const STORE = 'images';

let dbPromise: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => {
      dbPromise = null;
    });
  }
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return db().then(
    (d) =>
      new Promise<T>((resolve, reject) => {
        const req = fn(d.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result as T);
        req.onerror = () => reject(req.error);
      }),
  );
}

export async function saveImage(key: string, url: string) {
  try {
    const res = await fetch(url);
    if (!res.ok) return;
    const blob = await res.blob();
    await run('readwrite', (s) => s.put(blob, key));
  } catch {
    /* image facultative */
  }
}

export async function loadImage(key: string): Promise<Blob | null> {
  try {
    return (await run<Blob | undefined>('readonly', (s) => s.get(key))) || null;
  } catch {
    return null;
  }
}

export function deleteImage(key: string) {
  run('readwrite', (s) => s.delete(key)).catch(() => {});
}
