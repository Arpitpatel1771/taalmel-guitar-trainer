// Song editor drafts (specs/5-11-piano-roll.md section 9): the song being edited in the piano roll
// (as song text, plus the editor's own JSON when the text can't be built yet) and the view state,
// kept in their own IndexedDB database until the song is saved. Like the clips store this keeps the
// main `taalmel` database and its exports untouched. Helpers reject with IndexedDB's own error.

import { reqToPromise, txDone } from "./db.js";

export const DRAFTS_DB_NAME = "taalmel-import-drafts";
const DRAFTS_DB_VERSION = 2;
const DRAFTS_STORE = "drafts";

export interface EditorViewState {
  /** Pixels per 1/16 note. */
  zoom: number;
  rowHeight: number;
  snap: string;
  view: "pitch" | "strings";
  scrollX: number;
  scrollY: number;
}

/** One song in the editor. */
export interface EditorDraft {
  id: string;
  version: 2;
  /** Where it started: a pasted tab, an empty roll, or an existing song (then `songId` is set). */
  source: "tab" | "scratch" | "song";
  songId?: string;
  title: string;
  /** Canonical song text; empty when the document can't be written as a song yet (for example while notes conflict). */
  songText: string;
  /** The editor document as JSON; preferred over `songText` when present. */
  docJson?: string;
  view: EditorViewState;
  updatedAt: number;
}

let dbPromise: Promise<IDBDatabase> | null = null;

function openDraftsDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DRAFTS_DB_NAME, DRAFTS_DB_VERSION);
    } catch (err) {
      dbPromise = null;
      reject(err);
      return;
    }
    req.onupgradeneeded = (ev) => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DRAFTS_STORE)) {
        db.createObjectStore(DRAFTS_STORE, { keyPath: "id" }).createIndex("updatedAt", "updatedAt");
      } else if (ev.oldVersion > 0 && ev.oldVersion < 2) {
        // Version-1 drafts (the old six-step import) are dropped.
        req.transaction?.objectStore(DRAFTS_STORE).clear();
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => {
      dbPromise = null;
      reject(req.error ?? new Error(`Failed to open IndexedDB database '${DRAFTS_DB_NAME}'`));
    };
  });
  return dbPromise;
}

export function newDraftId(): string {
  return `draft-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export async function saveEditorDraft(draft: EditorDraft): Promise<void> {
  const db = await openDraftsDb();
  const tx = db.transaction(DRAFTS_STORE, "readwrite");
  tx.objectStore(DRAFTS_STORE).put({ ...draft, version: 2, updatedAt: Date.now() });
  await txDone(tx);
}

/** Editor drafts, newest first. Records of any other version are ignored. */
export async function listEditorDrafts(): Promise<EditorDraft[]> {
  const db = await openDraftsDb();
  const tx = db.transaction(DRAFTS_STORE, "readonly");
  const all = (await reqToPromise(tx.objectStore(DRAFTS_STORE).getAll())) as { version?: number; updatedAt: number }[];
  return (all.filter((d) => d.version === 2) as EditorDraft[]).sort((a, b) => b.updatedAt - a.updatedAt);
}

export async function getEditorDraft(id: string): Promise<EditorDraft | undefined> {
  const db = await openDraftsDb();
  const tx = db.transaction(DRAFTS_STORE, "readonly");
  const d = (await reqToPromise(tx.objectStore(DRAFTS_STORE).get(id))) as (Partial<EditorDraft> & object) | undefined;
  return d?.version === 2 ? (d as EditorDraft) : undefined;
}

export async function deleteEditorDraft(id: string): Promise<void> {
  const db = await openDraftsDb();
  const tx = db.transaction(DRAFTS_STORE, "readwrite");
  tx.objectStore(DRAFTS_STORE).delete(id);
  await txDone(tx);
}

/** Test-only: forget the cached connection so `deleteDatabase` is not blocked. */
export async function _resetDraftsDbForTests(): Promise<void> {
  if (dbPromise) {
    try {
      (await dbPromise).close();
    } catch {
      /* ignore */
    }
  }
  dbPromise = null;
}
