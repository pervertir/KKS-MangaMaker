/** A tiny promise wrapper over one IndexedDB database with a few key-value stores. */
const DB = "mangamaker", VERSION = 1, STORES = ["blobs", "autosave"] as const;
export type StoreName = (typeof STORES)[number];

let opening: Promise<IDBDatabase> | null = null;
function db(): Promise<IDBDatabase> {
  return opening ||= new Promise((ok, bad) => {
    const r = indexedDB.open(DB, VERSION);
    r.onupgradeneeded = () => { for (const s of STORES) if (!r.result.objectStoreNames.contains(s)) r.result.createObjectStore(s); };
    r.onsuccess = () => ok(r.result);
    r.onerror = () => { opening = null; bad(r.error); };
  });
}
async function run<T>(store: StoreName, mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const d = await db();
  return new Promise((ok, bad) => {
    const t = d.transaction(store, mode), r = fn(t.objectStore(store));
    t.oncomplete = () => ok(r.result); t.onerror = t.onabort = () => bad(t.error);
  });
}
export const idbGet = <T>(store: StoreName, key: string) => run<T | undefined>(store, "readonly", s => s.get(key));
export const idbPut = (store: StoreName, key: string, value: unknown) => run(store, "readwrite", s => s.put(value, key)).then(() => undefined);
export const idbDel = (store: StoreName, key: string) => run(store, "readwrite", s => s.delete(key)).then(() => undefined);
export const idbKeys = (store: StoreName) => run<IDBValidKey[]>(store, "readonly", s => s.getAllKeys()).then(k => k.map(String));
export const idbAvailable = (): boolean => typeof indexedDB !== "undefined";
