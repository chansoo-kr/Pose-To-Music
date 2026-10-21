/** 아주 얇은 IndexedDB 래퍼 */

const DB_NAME = "ptm";
const DB_VERSION = 1;

export type StoreName = "songs" | "charts";

let dbPromise: Promise<IDBDatabase> | null = null;

function open(): Promise<IDBDatabase> {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("songs")) db.createObjectStore("songs", { keyPath: "id" });
        if (!db.objectStoreNames.contains("charts")) {
          const charts = db.createObjectStore("charts", { keyPath: "id" });
          charts.createIndex("songId", "songId");
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    dbPromise.catch(() => (dbPromise = null));
  }
  return dbPromise;
}

const wrap = <T>(req: IDBRequest<T>) =>
  new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

async function store(name: StoreName, mode: IDBTransactionMode) {
  return (await open()).transaction(name, mode).objectStore(name);
}

export async function getAll<T>(name: StoreName): Promise<T[]> {
  return wrap((await store(name, "readonly")).getAll() as IDBRequest<T[]>);
}

export async function getAllBy<T>(name: StoreName, index: string, key: IDBValidKey): Promise<T[]> {
  return wrap((await store(name, "readonly")).index(index).getAll(key) as IDBRequest<T[]>);
}

export async function get<T>(name: StoreName, id: string): Promise<T | undefined> {
  return wrap((await store(name, "readonly")).get(id) as IDBRequest<T | undefined>);
}

export async function put<T>(name: StoreName, value: T): Promise<void> {
  await wrap((await store(name, "readwrite")).put(value));
}

export async function del(name: StoreName, id: string): Promise<void> {
  await wrap((await store(name, "readwrite")).delete(id));
}
