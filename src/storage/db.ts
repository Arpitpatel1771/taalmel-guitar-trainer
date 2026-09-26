// Low-level IndexedDB access (spec 11.4): database `taalmel`, version 1, with
// stores `songs` (keyPath `id`, indexed by `updatedAt`) and `settings` (a
// single record keyed by the string "settings"). Every helper here rejects
// with the original IDBRequest/IDBTransaction error - storage errors are
// never swallowed (spec 11.4, 13).

export const DB_NAME = "taalmel";
export const DB_VERSION = 1;
export const SONGS_STORE = "songs";
export const SETTINGS_STORE = "settings";
export const SETTINGS_KEY = "settings";

let dbPromise: Promise<IDBDatabase> | null = null;
let currentDb: IDBDatabase | null = null;

/** Opens (or returns the already-open) shared `taalmel` database, creating
 * its stores/indexes on first run. Safe to call repeatedly. */
export function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SONGS_STORE)) {
        const store = db.createObjectStore(SONGS_STORE, { keyPath: "id" });
        store.createIndex("updatedAt", "updatedAt");
      }
      if (!db.objectStoreNames.contains(SETTINGS_STORE)) {
        db.createObjectStore(SETTINGS_STORE);
      }
    };
    req.onsuccess = () => {
      currentDb = req.result;
      resolve(req.result);
    };
    req.onerror = () => reject(req.error ?? new Error("Failed to open IndexedDB database 'taalmel'"));
    req.onblocked = () => reject(new Error("Opening IndexedDB database 'taalmel' is blocked"));
  });
  return dbPromise;
}

/** Wraps an `IDBRequest` in a promise that rejects with the request's own
 * `error` (never a generic/replaced message), so callers see exactly what
 * IndexedDB reported. */
export function reqToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("IndexedDB request failed"));
  });
}

/** Resolves when `tx` completes, rejects with its own `error` if it fails or
 * aborts. */
export function txDone(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Test-only: closes the cached connection (if any) and drops the cache, so
 * the next `openDb()` reopens a fresh connection and a subsequent
 * `indexedDB.deleteDatabase` is not blocked by a dangling open connection.
 * Not part of the module's public API (not re-exported from index.ts). */
export function _resetDbForTests(): void {
  if (currentDb) {
    try {
      currentDb.close();
    } catch {
      // ignore
    }
  }
  currentDb = null;
  dbPromise = null;
}
