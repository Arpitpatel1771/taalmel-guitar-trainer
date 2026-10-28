// Local sync state, in its own IndexedDB database (`taalmel-sync`) so it never
// touches the songs/settings or clips databases. Like clipStore, every helper
// rejects with IndexedDB's own error.

export const SYNC_DB_NAME = "taalmel-sync";
const SYNC_DB_VERSION = 1;
const ITEMS = "items";
const QUEUE = "queue";
const META = "meta";

export type SyncKind = "song" | "clip" | "settings";

/** Link between a local entity and its Drive file. For clips, driveFileId is the meta file. */
export interface SyncItem {
  /** `kind:id`. */
  key: string;
  kind: SyncKind;
  id: string;
  driveFileId: string;
  /** SHA-256 of the song text / settings JSON / clip-meta JSON at the last successful sync. */
  lastSyncedHash: string;
  lastRemoteVersion: string;
  /** Clips only: the media file, once uploaded. */
  mediaFileId?: string;
  deletedLocally?: boolean;
}

export type QueueOp = "upsert" | "delete" | "uploadMedia";

export interface QueueItem {
  /** `kind:id`, or `kind:id:media` for uploadMedia so a clip's meta and media ops don't collide. */
  key: string;
  op: QueueOp;
  kind: SyncKind;
  id: string;
  enqueuedAt: number;
  attempts: number;
  resumableUrl?: string;
}

export const itemKey = (kind: SyncKind, id: string) => `${kind}:${id}`;
export const queueKey = (op: QueueOp, kind: SyncKind, id: string) =>
  op === "uploadMedia" ? `${kind}:${id}:media` : `${kind}:${id}`;

let dbPromise: Promise<IDBDatabase> | null = null;

function openSyncDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(SYNC_DB_NAME, SYNC_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(ITEMS)) db.createObjectStore(ITEMS, { keyPath: "key" });
      if (!db.objectStoreNames.contains(QUEUE)) db.createObjectStore(QUEUE, { keyPath: "key" }).createIndex("enqueuedAt", "enqueuedAt");
      if (!db.objectStoreNames.contains(META)) db.createObjectStore(META);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error(`Failed to open IndexedDB database '${SYNC_DB_NAME}'`));
    };
  });
  return dbPromise;
}

function run<T>(store: string, mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openSyncDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(store, mode);
        const req = fn(tx.objectStore(store));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? req.error ?? new Error("IndexedDB transaction failed"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      })
  );
}

// items

export function getItem(kind: SyncKind, id: string): Promise<SyncItem | undefined> {
  return run(ITEMS, "readonly", (s) => s.get(itemKey(kind, id)) as IDBRequest<SyncItem | undefined>);
}

export async function putItem(item: Omit<SyncItem, "key">): Promise<SyncItem> {
  const record: SyncItem = { ...item, key: itemKey(item.kind, item.id) };
  await run(ITEMS, "readwrite", (s) => s.put(record));
  return record;
}

export async function deleteItem(kind: SyncKind, id: string): Promise<void> {
  await run(ITEMS, "readwrite", (s) => s.delete(itemKey(kind, id)));
}

export function listItems(kind?: SyncKind): Promise<SyncItem[]> {
  return run(ITEMS, "readonly", (s) => s.getAll() as IDBRequest<SyncItem[]>).then((all) =>
    kind ? all.filter((i) => i.kind === kind) : all
  );
}

// queue

/** Adds an operation, replacing any pending one for the same key (the latest op wins). */
export async function enqueue(op: QueueOp, kind: SyncKind, id: string, now: number = Date.now()): Promise<QueueItem> {
  const key = queueKey(op, kind, id);
  const db = await openSyncDb();
  return new Promise<QueueItem>((resolve, reject) => {
    const tx = db.transaction(QUEUE, "readwrite");
    const store = tx.objectStore(QUEUE);
    let record: QueueItem = { key, op, kind, id, enqueuedAt: now, attempts: 0 };
    const get = store.get(key) as IDBRequest<QueueItem | undefined>;
    get.onsuccess = () => {
      const prev = get.result;
      if (prev) {
        record = { ...record, enqueuedAt: prev.enqueuedAt };
        // A new upsert/delete supersedes the old one; a resumable session stays valid for the same media op.
        if (prev.op === op && prev.resumableUrl) record.resumableUrl = prev.resumableUrl;
      }
      store.put(record);
    };
    tx.oncomplete = () => resolve(record);
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

/** Oldest first. */
export function listQueue(): Promise<QueueItem[]> {
  return run(QUEUE, "readonly", (s) => s.getAll() as IDBRequest<QueueItem[]>).then((all) =>
    all.sort((a, b) => a.enqueuedAt - b.enqueuedAt)
  );
}

export async function updateQueueItem(key: string, patch: Partial<Pick<QueueItem, "attempts" | "resumableUrl">>): Promise<void> {
  const db = await openSyncDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(QUEUE, "readwrite");
    const store = tx.objectStore(QUEUE);
    const get = store.get(key) as IDBRequest<QueueItem | undefined>;
    get.onsuccess = () => {
      if (get.result) store.put({ ...get.result, ...patch });
    };
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("IndexedDB transaction failed"));
    tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
  });
}

export async function dequeue(key: string): Promise<void> {
  await run(QUEUE, "readwrite", (s) => s.delete(key));
}

// meta (connection info, folder ids, changesPageToken, ...)

export function getMeta<T = unknown>(key: string): Promise<T | undefined> {
  return run(META, "readonly", (s) => s.get(key) as IDBRequest<T | undefined>);
}

export async function setMeta(key: string, value: unknown): Promise<void> {
  await run(META, "readwrite", (s) => s.put(value, key));
}

export async function deleteMeta(key: string): Promise<void> {
  await run(META, "readwrite", (s) => s.delete(key));
}

/** Test-only: drops the cached connection so the database can be deleted. */
export async function _resetSyncDbForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}
