// Song CRUD (spec 11.4). Storage keeps canonical text; the denormalized
// `title`/`bpm`/`hasVideo` fields exist only for the library list and are
// always recomputed from a fresh parse (spec 4.3: text is the source of
// truth, there is never a second representation that can drift).

import type { Song, SongRecord } from "../model/index.js";
import { parse, serialize } from "../songFormat/index.js";
import { SONGS_STORE, openDb, reqToPromise, txDone } from "./db.js";

function denormalize(song: Song): { title: string; bpm: number; hasVideo: boolean } {
  return { title: song.header.title, bpm: song.header.bpm, hasVideo: song.header.youtube !== undefined };
}

/** All songs, most recently updated first. */
export async function listSongs(): Promise<SongRecord[]> {
  const db = await openDb();
  const tx = db.transaction(SONGS_STORE, "readonly");
  const index = tx.objectStore(SONGS_STORE).index("updatedAt");
  const records: SongRecord[] = [];

  await new Promise<void>((resolve, reject) => {
    const cursorReq = index.openCursor(null, "prev");
    cursorReq.onsuccess = () => {
      const cursor = cursorReq.result;
      if (cursor) {
        records.push(cursor.value as SongRecord);
        cursor.continue();
      } else {
        resolve();
      }
    };
    cursorReq.onerror = () => reject(cursorReq.error ?? new Error("Failed to list songs"));
  });

  await txDone(tx);
  return records;
}

export async function getSong(id: string): Promise<SongRecord | undefined> {
  const db = await openDb();
  const tx = db.transaction(SONGS_STORE, "readonly");
  const result = await reqToPromise(tx.objectStore(SONGS_STORE).get(id));
  return result as SongRecord | undefined;
}

/**
 * Parses `text`, stores its canonical form (`serialize(parse(text))`), and
 * returns the resulting record. Throws (does not reject with a swallowed
 * generic error) if `text` fails to parse - nothing is ever partially saved
 * (spec 11.1). When `id` is given and already exists, the record is updated
 * in place, preserving its original `createdAt`; otherwise a new record is
 * created with a fresh `crypto.randomUUID()`.
 */
export async function saveSong(text: string, id?: string): Promise<SongRecord> {
  const result = parse(text);
  if (!result.ok) {
    const first = result.errors[0];
    const detail = first ? ` (line ${first.line}: ${first.message})` : "";
    throw new Error(`Cannot save song: invalid song text${detail}`);
  }

  const canonical = serialize(result.song);
  const { title, bpm, hasVideo } = denormalize(result.song);
  const now = new Date().toISOString();

  const db = await openDb();
  const tx = db.transaction(SONGS_STORE, "readwrite");
  const store = tx.objectStore(SONGS_STORE);

  let record: SongRecord;
  if (id) {
    const existing = (await reqToPromise(store.get(id))) as SongRecord | undefined;
    record = {
      id,
      text: canonical,
      title,
      bpm,
      hasVideo,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  } else {
    record = {
      id: crypto.randomUUID(),
      text: canonical,
      title,
      bpm,
      hasVideo,
      createdAt: now,
      updatedAt: now,
    };
  }

  store.put(record);
  await txDone(tx);
  return record;
}

export async function deleteSong(id: string): Promise<void> {
  const db = await openDb();
  const tx = db.transaction(SONGS_STORE, "readwrite");
  tx.objectStore(SONGS_STORE).delete(id);
  await txDone(tx);
}
