// Recorded clips, kept in their own IndexedDB database (`taalmel-clips`) so
// large media blobs never touch the songs/settings database or its exports.
// Like src/storage/db.ts, every helper rejects with IndexedDB's own error.

import { emitStorageChange, type WriteOptions } from "../storage/changes";

export const CLIPS_DB_NAME = "taalmel-clips";
const CLIPS_DB_VERSION = 1;
const CLIPS_STORE = "clips";

/** A marker dropped on a clip while recording or reviewing it. */
export interface ClipFlag {
  id: string;
  timeSec: number;
  label: string;
}

export interface ClipRecord {
  id: string;
  name: string;
  createdAt: number;
  mimeType: string;
  hasVideo: boolean;
  /** Measured while recording: WebM from MediaRecorder often reports no duration. */
  durationSec: number;
  /** Media size in bytes; kept even when `blob` is null. */
  size: number;
  /** null: the media is not on this device (it lives in Drive). */
  blob: Blob | null;
  driveFileId?: string;
  /** Absent on clips saved before flags existed: treat as none. */
  flags?: ClipFlag[];
  /** Waveform peaks (0..1), computed the first time the clip is opened in the trimmer. */
  peaks?: number[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openClipsDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const req = indexedDB.open(CLIPS_DB_NAME, CLIPS_DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CLIPS_STORE)) {
        db.createObjectStore(CLIPS_STORE, { keyPath: "id" }).createIndex("createdAt", "createdAt");
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error(`Failed to open IndexedDB database '${CLIPS_DB_NAME}'`));
    };
  });
  return dbPromise;
}

function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openClipsDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const tx = db.transaction(CLIPS_STORE, mode);
        const req = fn(tx.objectStore(CLIPS_STORE));
        tx.oncomplete = () => resolve(req.result);
        tx.onerror = () => reject(tx.error ?? req.error ?? new Error("IndexedDB transaction failed"));
        tx.onabort = () => reject(tx.error ?? new Error("IndexedDB transaction aborted"));
      })
  );
}

/** Newest first. */
export async function listClips(): Promise<ClipRecord[]> {
  const all = await run("readonly", (s) => s.getAll() as IDBRequest<ClipRecord[]>);
  return all.sort((a, b) => b.createdAt - a.createdAt);
}

export async function saveClip(
  clip: Omit<ClipRecord, "id" | "size"> & { id?: string; size?: number },
  opts?: WriteOptions
): Promise<ClipRecord> {
  const record: ClipRecord = { ...clip, id: clip.id ?? crypto.randomUUID(), size: clip.blob ? clip.blob.size : (clip.size ?? 0) };
  await run("readwrite", (s) => s.put(record));
  emitStorageChange({ kind: "clip", id: record.id, op: "upsert" }, opts);
  return record;
}

export async function renameClip(id: string, name: string, opts?: WriteOptions): Promise<void> {
  const clip = await run("readonly", (s) => s.get(id) as IDBRequest<ClipRecord | undefined>);
  if (!clip) throw new Error(`Clip ${id} was not found.`);
  await run("readwrite", (s) => s.put({ ...clip, name }));
  emitStorageChange({ kind: "clip", id, op: "upsert" }, opts);
}

export async function updateClipFlags(id: string, flags: ClipFlag[], opts?: WriteOptions): Promise<void> {
  const clip = await run("readonly", (s) => s.get(id) as IDBRequest<ClipRecord | undefined>);
  if (!clip) throw new Error(`Clip ${id} was not found.`);
  await run("readwrite", (s) => s.put({ ...clip, flags: [...flags].sort((a, b) => a.timeSec - b.timeSec) }));
  emitStorageChange({ kind: "clip", id, op: "upsert" }, opts);
}

export async function updateClipPeaks(id: string, peaks: number[], opts?: WriteOptions): Promise<void> {
  const clip = await run("readonly", (s) => s.get(id) as IDBRequest<ClipRecord | undefined>);
  if (!clip) throw new Error(`Clip ${id} was not found.`);
  await run("readwrite", (s) => s.put({ ...clip, peaks }));
  emitStorageChange({ kind: "clip", id, op: "upsert" }, opts);
}

export async function deleteClip(id: string, opts?: WriteOptions): Promise<void> {
  await run("readwrite", (s) => s.delete(id));
  emitStorageChange({ kind: "clip", id, op: "delete" }, opts);
}

/** Attaches (or drops, with null) the local media; `size` is kept. */
export async function setClipBlob(id: string, blob: Blob | null, opts?: WriteOptions): Promise<ClipRecord> {
  const clip = await run("readonly", (s) => s.get(id) as IDBRequest<ClipRecord | undefined>);
  if (!clip) throw new Error(`Clip ${id} was not found.`);
  const next: ClipRecord = { ...clip, blob, size: blob ? blob.size : clip.size };
  await run("readwrite", (s) => s.put(next));
  emitStorageChange({ kind: "clip", id, op: "upsert" }, opts);
  return next;
}

/** Test-only: drops the cached connection so the database can be deleted. */
export async function _resetClipsDbForTests(): Promise<void> {
  if (dbPromise) (await dbPromise).close();
  dbPromise = null;
}
