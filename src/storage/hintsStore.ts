// Pitch-hint storage (specs/5-11-piano-roll.md section 5.3): frames recorded from the video's
// audio, kept per YouTube video id in their own IndexedDB database. Local only: never synced,
// never part of exports (like the clips and drafts stores, the main `taalmel` database is
// untouched). Frames are stored in 10 s chunks (500 buckets x 49 bytes, plus a presence mask).

import { HINT_BINS } from "../audio/hints/constants";
import { HINT_CHUNK_BUCKETS, emptyHints, type VideoHints } from "../audio/hints/types";
import { computeOnsets } from "../audio/hints/query";
import { reqToPromise, txDone } from "./db.js";

export const HINTS_DB_NAME = "taalmel-hints";
const HINTS_DB_VERSION = 1;
const CHUNKS_STORE = "chunks";
const META_STORE = "meta";

interface ChunkRecord {
  key: string;
  videoId: string;
  chunk: number;
  /** 1 where the bucket has a frame. */
  mask: Uint8Array;
  data: Uint8Array;
}

interface MetaRecord {
  videoId: string;
  onsets: number[];
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openHintsDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(HINTS_DB_NAME, HINTS_DB_VERSION);
    } catch (err) {
      dbPromise = null;
      reject(err);
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(CHUNKS_STORE)) {
        db.createObjectStore(CHUNKS_STORE, { keyPath: "key" }).createIndex("videoId", "videoId");
      }
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "videoId" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error(`Failed to open IndexedDB database '${HINTS_DB_NAME}'`));
    };
  });
  return dbPromise;
}

const chunkKey = (videoId: string, chunk: number): string => `${videoId}:${chunk}`;

/** Loads a video's hints (empty when none stored). */
export async function loadHints(videoId: string): Promise<VideoHints> {
  const db = await openHintsDb();
  const tx = db.transaction([CHUNKS_STORE, META_STORE], "readonly");
  const chunks = (await reqToPromise(tx.objectStore(CHUNKS_STORE).index("videoId").getAll(videoId))) as ChunkRecord[];
  const meta = (await reqToPromise(tx.objectStore(META_STORE).get(videoId))) as MetaRecord | undefined;
  const hints = emptyHints(videoId);
  for (const rec of chunks) {
    for (let i = 0; i < HINT_CHUNK_BUCKETS; i++) {
      if (rec.mask[i]) hints.frames.set(rec.chunk * HINT_CHUNK_BUCKETS + i, rec.data.slice(i * HINT_BINS, (i + 1) * HINT_BINS));
    }
  }
  hints.onsets = meta?.onsets ?? [];
  return hints;
}

/**
 * Writes the chunks changed since the last save (all chunks when `all`), recomputes the onset
 * list from the frames and clears the dirty set.
 */
export async function saveHints(hints: VideoHints, all = false): Promise<void> {
  const chunks = all ? new Set(Array.from(hints.frames.keys(), (b) => Math.floor(b / HINT_CHUNK_BUCKETS))) : new Set(hints.dirtyChunks);
  if (chunks.size === 0 && !all) return;
  hints.onsets = computeOnsets(hints);
  const db = await openHintsDb();
  const tx = db.transaction([CHUNKS_STORE, META_STORE], "readwrite");
  const store = tx.objectStore(CHUNKS_STORE);
  for (const chunk of chunks) {
    const mask = new Uint8Array(HINT_CHUNK_BUCKETS);
    const data = new Uint8Array(HINT_CHUNK_BUCKETS * HINT_BINS);
    let any = false;
    for (let i = 0; i < HINT_CHUNK_BUCKETS; i++) {
      const frame = hints.frames.get(chunk * HINT_CHUNK_BUCKETS + i);
      if (!frame) continue;
      mask[i] = 1;
      data.set(frame, i * HINT_BINS);
      any = true;
    }
    if (any) store.put({ key: chunkKey(hints.videoId, chunk), videoId: hints.videoId, chunk, mask, data } satisfies ChunkRecord);
    else store.delete(chunkKey(hints.videoId, chunk));
  }
  tx.objectStore(META_STORE).put({ videoId: hints.videoId, onsets: hints.onsets, updatedAt: Date.now() } satisfies MetaRecord);
  await txDone(tx);
  for (const c of chunks) hints.dirtyChunks.delete(c);
}

/** Deletes everything stored for a video. */
export async function clearHints(videoId: string): Promise<void> {
  const db = await openHintsDb();
  const tx = db.transaction([CHUNKS_STORE, META_STORE], "readwrite");
  const store = tx.objectStore(CHUNKS_STORE);
  const keys = (await reqToPromise(store.index("videoId").getAllKeys(videoId))) as IDBValidKey[];
  for (const k of keys) store.delete(k);
  tx.objectStore(META_STORE).delete(videoId);
  await txDone(tx);
}

export interface HintsSaver {
  /** Asks for a save after the debounce delay (resets the timer). */
  schedule(): void;
  /** Saves now if anything is pending. */
  flush(): Promise<void>;
  /** Cancels the timer without saving. */
  dispose(): void;
}

/** Debounced saver for a live `VideoHints` (the recorder calls `schedule` per frame). */
export function createHintsSaver(hints: VideoHints, delayMs = 2000): HintsSaver {
  let timer: ReturnType<typeof setTimeout> | null = null;
  const flush = async (): Promise<void> => {
    if (timer) clearTimeout(timer);
    timer = null;
    await saveHints(hints);
  };
  return {
    schedule() {
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => void flush().catch(() => undefined), delayMs);
    },
    flush,
    dispose() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}

/** Test-only: forget the cached connection so `deleteDatabase` is not blocked. */
export async function _resetHintsDbForTests(): Promise<void> {
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      /* ignore */
    }
  }
  dbPromise = null;
}
