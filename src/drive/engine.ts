// Drive sync engine (spec 28-10-drive-sync.md §3-§5). Local storage stays the
// primary copy; this module mirrors it to Drive in the background. All I/O is
// injected (DriveApi, DriveAuth, LocalStore, SyncStore) so it runs against
// FakeDrive and in-memory stores in tests.

import type { ClipRecord } from "../recording/clipStore";
import { deleteClip, listClips, saveClip, setClipBlob } from "../recording/clipStore";
import type { Settings, SongRecord } from "../model/index";
import { onStorageChange, type StorageChange } from "../storage/changes";
import { SONGS_STORE, openDb, txDone } from "../storage/db";
import { loadSettings, saveSettings } from "../storage/settings";
import { deleteSong, getSong, listSongs, saveSong } from "../storage/songs";
import { DriveError, listAllFiles, type DriveApi, type DriveFile } from "./api";
import { AuthRequiredError, type DriveAuth } from "./auth";
import * as syncDb from "./syncDb";
import type { QueueItem, QueueOp, SyncItem, SyncKind } from "./syncDb";

// ---------------------------------------------------------------- public types

export type SyncState = "disconnected" | "idle" | "syncing" | "offline" | "authRequired" | "retrying" | "driveFull";
export type UploadSetting = "off" | "audio" | "all";

export interface SongConflict {
  songId: string;
  localTitle: string;
  remoteTitle: string;
  localText: string;
  remoteText: string;
  /** Epoch ms. */
  localUpdatedAt: number;
  remoteUpdatedAt: number;
  driveFileId: string;
  remoteVersion: string;
}

export interface PendingRemoteDelete {
  kind: "song" | "clip";
  id: string;
  title: string;
}

export interface SyncStatus {
  state: SyncState;
  email: string | null;
  lastSyncAt: number | null;
  conflicts: SongConflict[];
  pendingRemoteDeletes: PendingRemoteDelete[];
  /** Upload progress 0..1 per clip id, for clips being uploaded right now. */
  uploads: Record<string, number>;
  /** Message of the last unexpected error (for a toast), or null. */
  error: string | null;
}

/** Local data access. Every write is silent: it must not emit storage change events. */
export interface LocalStore {
  listSongs(): Promise<SongRecord[]>;
  getSong(id: string): Promise<SongRecord | undefined>;
  /** Stores `text` as song `id` (canonicalised when it parses, stored raw when it does not). */
  putSong(id: string, text: string): Promise<SongRecord>;
  deleteSong(id: string): Promise<void>;
  loadSettings(): Promise<Settings>;
  saveSettings(settings: Settings): Promise<void>;
  listClips(): Promise<ClipRecord[]>;
  getClip(id: string): Promise<ClipRecord | undefined>;
  putClip(clip: ClipRecord): Promise<void>;
  deleteClip(id: string): Promise<void>;
  setClipBlob(id: string, blob: Blob | null): Promise<void>;
}

/** Sync bookkeeping storage; `syncDb` (IndexedDB) satisfies it. */
export interface SyncStore {
  getItem(kind: SyncKind, id: string): Promise<SyncItem | undefined>;
  putItem(item: Omit<SyncItem, "key">): Promise<SyncItem>;
  deleteItem(kind: SyncKind, id: string): Promise<void>;
  listItems(kind?: SyncKind): Promise<SyncItem[]>;
  enqueue(op: QueueOp, kind: SyncKind, id: string, now?: number): Promise<QueueItem>;
  listQueue(): Promise<QueueItem[]>;
  updateQueueItem(key: string, patch: Partial<Pick<QueueItem, "attempts" | "resumableUrl">>): Promise<void>;
  dequeue(key: string): Promise<void>;
  getMeta<T = unknown>(key: string): Promise<T | undefined>;
  setMeta(key: string, value: unknown): Promise<void>;
  deleteMeta(key: string): Promise<void>;
}

export interface SyncEngineOptions {
  api: DriveApi;
  auth: DriveAuth;
  local?: LocalStore;
  store?: SyncStore;
  now?: () => number;
  randomId?: () => string;
  /** Flush debounce in ms. null disables every internal timer (tests). Default 2000. */
  debounceMs?: number | null;
  /** Subscribe to storage change events on start()/connect(). Default true. */
  subscribe?: boolean;
  /** Resumable upload chunk size. Default 8 MB. */
  chunkSize?: number;
  /** Optional probe used when importing media from Drive (duration, waveform). */
  probeMedia?: (blob: Blob) => Promise<{ durationSec: number; peaks?: number[] }>;
}

// ------------------------------------------------------------------- constants

const ROOT_NAME = "Taalmel";
const DEVICE_LOCAL_SETTINGS = ["calibration", "micEnabled", "persistBannerDismissed"] as const;
const DEFAULT_CHUNK = 8 * 1024 * 1024;
const BACKOFF_BASE_MS = 2000;
const BACKOFF_MAX_MS = 5 * 60 * 1000;
const PULL_INTERVAL_MS = 60 * 1000;

/** 2 s, 4 s, 8 s ... capped at 5 min. `failures` starts at 1. */
export function backoffMs(failures: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, failures - 1), BACKOFF_MAX_MS);
}

interface Folders {
  root: string;
  songs: string;
  recordings: string;
  hidden: string;
  clips: string;
}
interface Connection {
  email: string | null;
  folders: Folders;
}

// ---------------------------------------------------------------- default local

function titleFromText(text: string): string | null {
  const m = /^title:[ \t]*(.*)$/m.exec(text);
  return m && m[1].trim() ? m[1].trim() : null;
}

export const defaultLocalStore: LocalStore = {
  listSongs: () => listSongs(),
  getSong: (id) => getSong(id),
  async putSong(id, text) {
    try {
      return await saveSong(text, id, { silent: true });
    } catch (err) {
      // saveSong rejects text that fails to parse. A remote song must still be stored
      // (spec §3), so write the raw record directly; the editor shows its errors.
      const existing = await getSong(id);
      const now = new Date().toISOString();
      const bpm = Number(/^bpm:[ \t]*(\d+)/m.exec(text)?.[1]);
      const record: SongRecord = {
        id,
        text,
        title: titleFromText(text) ?? "Untitled",
        bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : 0,
        hasVideo: false,
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      try {
        const db = await openDb();
        const tx = db.transaction(SONGS_STORE, "readwrite");
        tx.objectStore(SONGS_STORE).put(record);
        await txDone(tx);
      } catch {
        throw err;
      }
      return record;
    }
  },
  deleteSong: (id) => deleteSong(id, { silent: true }),
  loadSettings: () => loadSettings(),
  saveSettings: (s) => saveSettings(s, { silent: true }),
  listClips: () => listClips(),
  async getClip(id) {
    return (await listClips()).find((c) => c.id === id);
  },
  async putClip(clip) {
    await saveClip(clip, { silent: true });
  },
  deleteClip: (id) => deleteClip(id, { silent: true }),
  async setClipBlob(id, blob) {
    await setClipBlob(id, blob, { silent: true });
  },
};

// ---------------------------------------------------------------------- helpers

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function stable(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(stable).join(",")}]`;
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    return `{${Object.keys(o)
      .filter((k) => o[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${stable(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(v) ?? "null";
}

export function syncedSettings(s: Partial<Settings>): Partial<Settings> {
  const o: Partial<Settings> = { ...s };
  for (const k of DEVICE_LOCAL_SETTINGS) delete o[k];
  return o;
}

function clipContent(c: ClipRecord) {
  return {
    name: c.name,
    createdAt: c.createdAt,
    mimeType: c.mimeType,
    hasVideo: c.hasVideo,
    durationSec: c.durationSec,
    size: c.size,
    flags: c.flags ?? [],
    peaks: c.peaks ?? [],
  };
}

function sanitizeName(title: string): string {
  // eslint-disable-next-line no-control-regex
  const s = title.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim();
  return s || "Untitled";
}

const MEDIA_EXT: Record<string, string> = {
  "video/mp4": "mp4",
  "video/webm": "webm",
  "audio/mp4": "m4a",
  "audio/x-m4a": "m4a",
  "audio/mpeg": "mp3",
  "audio/mp3": "mp3",
  "audio/ogg": "ogg",
  "audio/webm": "webm",
};
function mediaName(clip: ClipRecord): string {
  const base = clip.mimeType.split(";")[0].trim().toLowerCase();
  const ext = MEDIA_EXT[base] ?? (base.split("/")[1] || "bin");
  return `${sanitizeName(clip.name)}.${ext}`;
}

type ErrorClass = "auth" | "offline" | "retry" | "full" | "notFound" | "other";
function classify(e: unknown): ErrorClass {
  if (e instanceof AuthRequiredError) return "auth";
  if (e instanceof DriveError) {
    if (e.status === 401) return "auth";
    if (e.status === 0) return "offline";
    if (e.status === 404) return "notFound";
    if (e.status === 429 || e.status >= 500) return "retry";
    if (e.status === 403) {
      if (/storageQuotaExceeded/i.test(e.reason)) return "full";
      if (/rateLimitExceeded|dailyLimitExceeded/i.test(e.reason)) return "retry";
    }
  }
  return "other";
}

interface LocalDoc {
  body: string;
  hash: string;
  updatedAt: number;
  title: string;
}
interface RemoteDoc {
  text: string;
  hash: string;
  updatedAt: number;
  /** Parsed JSON body for settings and clip meta. */
  json?: Record<string, unknown>;
}

const songKey = (id: string) => `song:${id}`;

// ----------------------------------------------------------------------- engine

export class SyncEngine {
  private readonly rawApi: DriveApi;
  private readonly api: DriveApi;
  private readonly auth: DriveAuth;
  private readonly local: LocalStore;
  private readonly store: SyncStore;
  private readonly now: () => number;
  private readonly randomId: () => string;
  private readonly debounceMs: number | null;
  private readonly subscribeEvents: boolean;
  private readonly chunkSize: number;
  private readonly probeMedia?: SyncEngineOptions["probeMedia"];

  private conn: Connection | null = null;
  private conflicts: SongConflict[] = [];
  private pendingDeletes: PendingRemoteDelete[] = [];
  private uploads: Record<string, number> = {};
  private lastSyncAt: number | null = null;
  private uploadSetting: UploadSetting = "audio";
  private flags = { authRequired: false, offline: false, retrying: false, driveFull: false };
  private error: string | null = null;
  private syncing = 0;
  private failures = 0;
  private needFlush = false;
  private listeners = new Set<(s: SyncStatus) => void>();
  private unsubscribe: (() => void) | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private chain: Promise<unknown> = Promise.resolve();
  private pendingEvents = new Set<Promise<void>>();
  private touched = new Set<string>();
  private timersCleanup: (() => void) | null = null;
  private readonly ready: Promise<void>;

  constructor(opts: SyncEngineOptions) {
    this.rawApi = opts.api;
    this.auth = opts.auth;
    this.local = opts.local ?? defaultLocalStore;
    this.store = opts.store ?? syncDb;
    this.now = opts.now ?? (() => Date.now());
    this.randomId = opts.randomId ?? (() => crypto.randomUUID());
    this.debounceMs = opts.debounceMs === undefined ? 2000 : opts.debounceMs;
    this.subscribeEvents = opts.subscribe ?? true;
    this.chunkSize = opts.chunkSize ?? DEFAULT_CHUNK;
    this.probeMedia = opts.probeMedia;
    this.api = new Proxy(this.rawApi, {
      get: (target, prop) => {
        const v = (target as unknown as Record<string | symbol, unknown>)[prop];
        if (typeof v !== "function") return v;
        return (...args: unknown[]) => this.withAuth(() => (v as (...a: unknown[]) => Promise<unknown>).apply(target, args));
      },
    });
    this.ready = this.loadPersisted();
  }

  // -------------------------------------------------------------------- status

  getStatus(): SyncStatus {
    let state: SyncState;
    if (!this.conn) state = "disconnected";
    else if (this.syncing > 0) state = "syncing";
    else if (this.flags.authRequired) state = "authRequired";
    else if (this.flags.offline) state = "offline";
    else if (this.flags.retrying) state = "retrying";
    else if (this.flags.driveFull) state = "driveFull";
    else state = "idle";
    return {
      state,
      email: this.auth.email() ?? this.conn?.email ?? null,
      lastSyncAt: this.lastSyncAt,
      conflicts: this.conflicts.map((c) => ({ ...c })),
      pendingRemoteDeletes: this.pendingDeletes.map((d) => ({ ...d })),
      uploads: { ...this.uploads },
      error: this.error,
    };
  }

  onStatus(cb: (s: SyncStatus) => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit(): void {
    const s = this.getStatus();
    for (const cb of [...this.listeners]) {
      try {
        cb(s);
      } catch (err) {
        console.error("sync status listener failed", err);
      }
    }
  }

  /** Device-local, kept in sync meta. Cached after load; default "audio". */
  getUploadSetting(): UploadSetting {
    return this.uploadSetting;
  }

  async setUploadSetting(setting: UploadSetting): Promise<void> {
    await this.ready;
    this.uploadSetting = setting;
    await this.store.setMeta("uploadSetting", setting);
    if (this.conn) {
      await this.scanLocal();
      this.scheduleFlush();
    }
  }

  private async loadPersisted(): Promise<void> {
    try {
      this.conn = (await this.store.getMeta<Connection>("conn")) ?? null;
      this.conflicts = (await this.store.getMeta<SongConflict[]>("conflicts")) ?? [];
      this.pendingDeletes = (await this.store.getMeta<PendingRemoteDelete[]>("pendingDeletes")) ?? [];
      this.lastSyncAt = (await this.store.getMeta<number>("lastSyncAt")) ?? null;
      this.uploadSetting = (await this.store.getMeta<UploadSetting>("uploadSetting")) ?? "audio";
      this.emit();
    } catch (err) {
      console.error("sync state failed to load", err);
    }
  }

  private persistLists(): Promise<void> {
    return Promise.all([
      this.store.setMeta("conflicts", this.conflicts),
      this.store.setMeta("pendingDeletes", this.pendingDeletes),
    ]).then(() => undefined);
  }

  // ----------------------------------------------------------------- lifecycle

  /**
   * First connect: links the Drive folders and merges. With stored connection
   * metadata it just resumes (a silent connect that needs interaction leaves the
   * engine in `authRequired`; the sign-in chip then calls connect({ interactive: true })).
   */
  async connect(opts: { interactive: boolean }): Promise<void> {
    await this.ready;
    if (this.conn) {
      try {
        await this.auth.getToken({ interactive: opts.interactive });
      } catch (e) {
        if (classify(e) === "auth" && !opts.interactive) {
          this.flags.authRequired = true;
          this.start();
          this.emit();
          return;
        }
        throw e;
      }
      this.flags.authRequired = false;
      this.start();
      await this.scanLocal();
      await this.syncNow();
      return;
    }
    await this.auth.getToken({ interactive: opts.interactive });
    await this.exclusive(async () => {
      this.syncing++;
      this.emit();
      try {
        const folders = await this.ensureFolders();
        const startToken = await this.api.getStartPageToken();
        this.conn = { email: this.auth.email(), folders };
        await this.store.setMeta("conn", this.conn);
        await this.mergeFirstConnect();
        await this.store.setMeta("changesPageToken", startToken);
        this.start();
        await this.scanLocal();
        await this.flush();
        this.lastSyncAt = this.now();
        await this.store.setMeta("lastSyncAt", this.lastSyncAt);
        this.clearFlags();
      } catch (e) {
        // A failed first connect leaves the engine disconnected so the user can retry.
        this.conn = null;
        await this.store.deleteMeta("conn");
        this.handleError(e);
        throw e;
      } finally {
        this.syncing--;
        this.emit();
      }
    });
  }

  /** Stops sync and forgets the connection. Local data and Drive files are untouched. */
  async disconnect(): Promise<void> {
    await this.ready;
    this.stop();
    await this.chain.catch(() => undefined);
    for (const i of await this.store.listItems()) await this.store.deleteItem(i.kind, i.id);
    for (const q of await this.store.listQueue()) await this.store.dequeue(q.key);
    for (const k of ["conn", "changesPageToken", "lastSyncAt", "conflicts", "pendingDeletes", "settingsUpdatedAt"]) {
      await this.store.deleteMeta(k);
    }
    for (const c of await this.local.listClips()) await this.store.deleteMeta(`clipUpdatedAt:${c.id}`);
    this.conn = null;
    this.conflicts = [];
    this.pendingDeletes = [];
    this.uploads = {};
    this.lastSyncAt = null;
    this.clearFlags();
    this.failures = 0;
    this.auth.signOut();
    this.emit();
  }

  /** Subscribes to local changes and schedules a first flush. No-op when not connected. */
  start(): void {
    if (!this.conn) return;
    if (this.subscribeEvents && !this.unsubscribe) {
      this.unsubscribe = onStorageChange((evt) => void this.handleLocalChange(evt));
    }
    this.scheduleFlush();
  }

  stop(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.timersCleanup?.();
    this.timersCleanup = null;
  }

  /** Wires focus / visibility / online events and a 60 s pull interval. Returns a cleanup function. */
  handleVisibilityAndTimers(): () => void {
    if (typeof window === "undefined") return () => undefined;
    const sync = () => void this.syncNow().catch(() => undefined);
    const onVisible = () => {
      if (document.visibilityState === "visible") sync();
    };
    const onOnline = () => {
      this.flags.offline = false;
      sync();
    };
    window.addEventListener("focus", sync);
    window.addEventListener("online", onOnline);
    document.addEventListener("visibilitychange", onVisible);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") sync();
    }, PULL_INTERVAL_MS);
    const cleanup = () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("online", onOnline);
      document.removeEventListener("visibilitychange", onVisible);
      clearInterval(interval);
    };
    this.timersCleanup?.();
    this.timersCleanup = cleanup;
    return cleanup;
  }

  private scheduleFlush(delay: number | null = this.debounceMs): void {
    if (delay === null || !this.conn) return;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.syncNow().catch(() => undefined);
    }, delay);
  }

  private exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.chain.then(() => fn(), () => fn());
    this.chain = run.catch(() => undefined);
    return run;
  }

  // ------------------------------------------------------------------ syncing

  /** Flushes the queue, then pulls remote changes. */
  syncNow(): Promise<void> {
    return this.exclusive(() => this.doSync(true));
  }

  /** Pulls remote changes only. */
  pull(): Promise<void> {
    return this.exclusive(() => this.doSync(false));
  }

  private clearFlags(): void {
    this.flags = { authRequired: false, offline: false, retrying: false, driveFull: this.flags.driveFull };
    this.error = null;
  }

  private async doSync(push: boolean): Promise<void> {
    await this.ready;
    if (!this.conn) return;
    await Promise.all([...this.pendingEvents]);
    this.syncing++;
    this.flags = { ...this.flags, authRequired: false, offline: false, retrying: false };
    this.error = null;
    this.emit();
    try {
      if (push) await this.flush();
      this.needFlush = false;
      await this.pullInternal();
      if (this.needFlush) {
        this.needFlush = false;
        await this.flush();
      }
      this.failures = 0;
      this.lastSyncAt = this.now();
      await this.store.setMeta("lastSyncAt", this.lastSyncAt);
    } catch (e) {
      this.handleError(e);
    } finally {
      this.syncing--;
      this.emit();
    }
  }

  private handleError(e: unknown): void {
    const c = classify(e);
    this.failures++;
    if (c === "auth") this.flags.authRequired = true;
    else if (c === "offline") this.flags.offline = true;
    else if (c === "full") this.flags.driveFull = true;
    else {
      this.flags.retrying = true;
      if (c === "other" || c === "notFound") this.error = e instanceof Error ? e.message : String(e);
    }
    if (c !== "auth") this.scheduleFlush(this.debounceMs === null ? null : backoffMs(this.failures));
  }

  private async withAuth<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (classify(e) !== "auth") throw e;
      await this.auth.getToken({ interactive: false }); // AuthRequiredError when Google needs the user
      return fn();
    }
  }

  // ------------------------------------------------------------- local changes

  /** Entry point for storage change events (the subscribed listener calls this). */
  handleLocalChange(evt: StorageChange): Promise<void> {
    const p = this.onLocalChange(evt)
      .catch((err) => console.error("sync enqueue failed", err))
      .finally(() => this.pendingEvents.delete(p));
    this.pendingEvents.add(p);
    return p;
  }

  private async enqueue(op: QueueOp, kind: SyncKind, id: string): Promise<void> {
    this.touched.add(op === "uploadMedia" ? `${kind}:${id}:media` : `${kind}:${id}`);
    await this.store.enqueue(op, kind, id, this.now());
  }

  private async onLocalChange(evt: StorageChange): Promise<void> {
    if (evt.kind === "song") {
      if (evt.op === "delete") {
        this.conflicts = this.conflicts.filter((c) => c.songId !== evt.id);
        await this.persistLists();
      }
      await this.enqueue(evt.op, "song", evt.id);
    } else if (evt.kind === "settings") {
      await this.store.setMeta("settingsUpdatedAt", this.now());
      await this.enqueue("upsert", "settings", "settings");
    } else if (evt.op === "delete") {
      await this.store.dequeue(`clip:${evt.id}:media`);
      this.touched.add(`clip:${evt.id}:media`);
      await this.enqueue("delete", "clip", evt.id);
    } else {
      await this.store.setMeta(`clipUpdatedAt:${evt.id}`, this.now());
      await this.enqueue("upsert", "clip", evt.id);
      const clip = await this.local.getClip(evt.id);
      if (clip && (await this.wantsMediaUpload(clip))) await this.enqueue("uploadMedia", "clip", evt.id);
    }
    this.scheduleFlush();
  }

  private eligible(clip: ClipRecord): boolean {
    if (!clip.blob) return false;
    if (this.uploadSetting === "all") return true;
    return this.uploadSetting === "audio" && !clip.hasVideo;
  }

  private async wantsMediaUpload(clip: ClipRecord): Promise<boolean> {
    if (!this.eligible(clip)) return false;
    const item = await this.store.getItem("clip", clip.id);
    return !(item?.mediaFileId ?? clip.driveFileId);
  }

  /** Enqueues anything local that Drive hasn't seen (after connect/resume, or a setting change). */
  private async scanLocal(): Promise<void> {
    for (const s of await this.local.listSongs()) {
      if (this.conflicts.some((c) => c.songId === s.id)) continue;
      const item = await this.store.getItem("song", s.id);
      if (!item || item.lastSyncedHash !== (await sha256(s.text))) await this.enqueue("upsert", "song", s.id);
    }
    const settings = await this.readLocal("settings", "settings");
    const sItem = await this.store.getItem("settings", "settings");
    if (settings && (!sItem || sItem.lastSyncedHash !== settings.hash)) await this.enqueue("upsert", "settings", "settings");
    for (const c of await this.local.listClips()) {
      const item = await this.store.getItem("clip", c.id);
      const doc = await this.readLocal("clip", c.id);
      if (doc && (!item || item.lastSyncedHash !== doc.hash)) await this.enqueue("upsert", "clip", c.id);
      if (await this.wantsMediaUpload(c)) await this.enqueue("uploadMedia", "clip", c.id);
    }
  }

  // ---------------------------------------------------------------- folders

  private async ensureFolders(): Promise<Folders> {
    const find = async (id: string, name: string, parent: string | null) =>
      (await this.api.findFolder({ taalmelKind: "folder", taalmelId: id })) ??
      (await this.api.createFolder(name, parent, { taalmelKind: "folder", taalmelId: id }));
    const root = await find("root", ROOT_NAME, null);
    const songs = await find("songs", "Songs", root.id);
    const recordings = await find("recordings", "Recordings", root.id);
    const hidden = await find("hidden", ".taalmel", root.id);
    const clips = await find("clips", "clips", hidden.id);
    return { root: root.id, songs: songs.id, recordings: recordings.id, hidden: hidden.id, clips: clips.id };
  }

  private folders(): Folders {
    if (!this.conn) throw new Error("Drive is not connected.");
    return this.conn.folders;
  }

  // -------------------------------------------------------- documents (local/remote)

  private async readLocal(kind: SyncKind, id: string): Promise<LocalDoc | null> {
    if (kind === "song") {
      const rec = await this.local.getSong(id);
      if (!rec) return null;
      return { body: rec.text, hash: await sha256(rec.text), updatedAt: Date.parse(rec.updatedAt) || 0, title: rec.title };
    }
    if (kind === "settings") {
      const settings = syncedSettings(await this.local.loadSettings());
      const updatedAt = (await this.store.getMeta<number>("settingsUpdatedAt")) ?? 0;
      return { body: JSON.stringify({ updatedAt, settings }), hash: await sha256(stable(settings)), updatedAt, title: "settings" };
    }
    const clip = await this.local.getClip(id);
    if (!clip) return null;
    const content = clipContent(clip);
    const updatedAt = (await this.store.getMeta<number>(`clipUpdatedAt:${id}`)) ?? 0;
    return {
      body: JSON.stringify({ updatedAt: updatedAt || clip.createdAt, ...content }),
      hash: await sha256(stable(content)),
      updatedAt,
      title: clip.name,
    };
  }

  private async readRemote(kind: SyncKind, file: DriveFile): Promise<RemoteDoc | null> {
    const text = await (await this.api.downloadMedia(file.id)).text();
    if (kind === "song") return { text, hash: await sha256(text), updatedAt: Date.parse(file.modifiedTime) || 0 };
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      return null;
    }
    const updatedAt = typeof json.updatedAt === "number" ? json.updatedAt : 0;
    if (kind === "settings") {
      const settings = syncedSettings((json.settings ?? {}) as Partial<Settings>);
      return { text, json, hash: await sha256(stable(settings)), updatedAt };
    }
    return { text, json, hash: await sha256(stable(this.remoteClipContent(json))), updatedAt };
  }

  private remoteClipContent(j: Record<string, unknown>) {
    return {
      name: j.name,
      createdAt: j.createdAt,
      mimeType: j.mimeType,
      hasVideo: j.hasVideo,
      durationSec: j.durationSec,
      size: j.size,
      flags: j.flags ?? [],
      peaks: j.peaks ?? [],
    };
  }

  /** Applies a remote document locally (silently). Returns the resulting local content hash. */
  private async applyRemote(kind: SyncKind, id: string, remote: RemoteDoc): Promise<string> {
    if (kind === "song") {
      const rec = await this.local.putSong(id, remote.text);
      return sha256(rec.text);
    }
    if (kind === "settings") {
      const current = await this.local.loadSettings();
      const incoming = syncedSettings((remote.json?.settings ?? {}) as Partial<Settings>);
      const merged = { ...current, ...incoming } as Settings;
      for (const k of DEVICE_LOCAL_SETTINGS) (merged as unknown as Record<string, unknown>)[k] = current[k];
      await this.local.saveSettings(merged);
      await this.store.setMeta("settingsUpdatedAt", remote.updatedAt);
      return sha256(stable(syncedSettings(merged)));
    }
    const j = remote.json!;
    const existing = await this.local.getClip(id);
    const record: ClipRecord = {
      id,
      name: String(j.name ?? "Recording"),
      createdAt: Number(j.createdAt ?? this.now()),
      mimeType: String(j.mimeType ?? ""),
      hasVideo: Boolean(j.hasVideo),
      durationSec: Number(j.durationSec ?? 0),
      size: existing?.blob ? existing.size : Number(j.size ?? 0),
      blob: existing?.blob ?? null,
      driveFileId: existing?.driveFileId,
      flags: (j.flags as ClipRecord["flags"]) ?? [],
      peaks: (j.peaks as number[] | undefined) ?? [],
    };
    if (!existing) record.driveFileId = (await this.findMediaFile(id))?.id;
    await this.local.putClip(record);
    await this.store.setMeta(`clipUpdatedAt:${id}`, remote.updatedAt);
    return sha256(stable(clipContent(record)));
  }

  private async findMediaFile(clipId: string): Promise<DriveFile | undefined> {
    const files = await listAllFiles(this.api, { appProperties: { taalmelKind: "clip", taalmelId: clipId } });
    return files[0];
  }

  private propsFor(kind: SyncKind, id: string): Record<string, string> {
    return { taalmelKind: kind === "clip" ? "clipMeta" : kind, taalmelId: id };
  }

  private async uniqueSongName(title: string, selfFileId: string | null): Promise<string> {
    const files = await listAllFiles(this.api, { parentId: this.folders().songs });
    const taken = new Set(files.filter((f) => f.id !== selfFileId).map((f) => f.name.toLowerCase()));
    const base = sanitizeName(title);
    let name = `${base}.txt`;
    for (let n = 2; taken.has(name.toLowerCase()); n++) name = `${base} (${n}).txt`;
    return name;
  }

  private bodyBlob(kind: SyncKind, body: string): Blob {
    return new Blob([body], { type: kind === "song" ? "text/plain" : "application/json" });
  }

  private async link(kind: SyncKind, id: string, file: DriveFile, hash: string, prev?: SyncItem): Promise<void> {
    await this.store.putItem({
      kind,
      id,
      driveFileId: file.id,
      lastSyncedHash: hash,
      lastRemoteVersion: file.version,
      mediaFileId: prev?.mediaFileId ?? (kind === "clip" ? (await this.local.getClip(id))?.driveFileId : undefined),
    });
  }

  private async pushCreate(kind: SyncKind, id: string, local: LocalDoc): Promise<void> {
    const f = this.folders();
    let name: string;
    let parent: string;
    if (kind === "song") {
      name = await this.uniqueSongName(local.title, null);
      parent = f.songs;
    } else if (kind === "settings") {
      name = "settings.json";
      parent = f.hidden;
    } else {
      name = `${id}.json`;
      parent = f.clips;
    }
    const mimeType = kind === "song" ? "text/plain" : "application/json";
    const file = await this.api.createFile(
      { name, mimeType, parents: [parent], appProperties: this.propsFor(kind, id) },
      this.bodyBlob(kind, local.body)
    );
    let mediaFileId: string | undefined;
    if (kind === "clip") mediaFileId = (await this.local.getClip(id))?.driveFileId;
    await this.store.putItem({
      kind,
      id,
      driveFileId: file.id,
      lastSyncedHash: local.hash,
      lastRemoteVersion: file.version,
      mediaFileId,
    });
  }

  private async pushUpdate(kind: SyncKind, id: string, item: SyncItem, local: LocalDoc, remoteMeta: DriveFile): Promise<void> {
    let file = await this.api.updateMedia(item.driveFileId, this.bodyBlob(kind, local.body));
    if (kind === "song") {
      const name = await this.uniqueSongName(local.title, item.driveFileId);
      if (name !== remoteMeta.name) file = await this.api.updateMetadata(item.driveFileId, { name });
    } else if (kind === "clip" && item.mediaFileId) {
      const clip = await this.local.getClip(id);
      if (clip) await this.api.updateMetadata(item.mediaFileId, { name: mediaName(clip) });
    }
    await this.store.putItem({ ...item, lastSyncedHash: local.hash, lastRemoteVersion: file.version });
  }

  // ------------------------------------------------------------------- queue

  private async flush(): Promise<void> {
    if (!this.conn) return;
    let quota = false;
    for (const q of await this.store.listQueue()) {
      this.touched.delete(q.key);
      try {
        await this.runOp(q);
        if (!this.touched.has(q.key)) await this.store.dequeue(q.key);
      } catch (e) {
        const c = classify(e);
        if (c === "notFound") {
          await this.onKnownFileMissing(q);
          if (!this.touched.has(q.key)) await this.store.dequeue(q.key);
          continue;
        }
        if (c === "full" && q.op === "uploadMedia") {
          quota = true;
          continue; // keep it queued; metadata keeps syncing
        }
        await this.store.updateQueueItem(q.key, { attempts: q.attempts + 1 }).catch(() => undefined);
        throw e;
      }
    }
    this.flags.driveFull = quota;
  }

  private async runOp(q: QueueItem): Promise<void> {
    if (q.op === "upsert") await this.pushUpsert(q.kind, q.id);
    else if (q.op === "delete") await this.pushDelete(q.kind, q.id);
    else await this.uploadMediaOp(q);
  }

  /** A 404 on a file we know about means it was deleted in Drive. */
  private async onKnownFileMissing(q: QueueItem): Promise<void> {
    const item = await this.store.getItem(q.kind, q.id);
    if (q.op === "delete") {
      await this.store.deleteItem(q.kind, q.id);
      return;
    }
    if (!item) return;
    if (q.op === "uploadMedia") {
      await this.store.putItem({ ...item, mediaFileId: undefined });
      return;
    }
    await this.remoteGone(q.kind, q.id);
  }

  private async pushDelete(kind: SyncKind, id: string): Promise<void> {
    const item = await this.store.getItem(kind, id);
    if (!item) return;
    const trash = async (fileId: string) => {
      try {
        await this.api.trash(fileId);
      } catch (e) {
        if (classify(e) !== "notFound") throw e;
      }
    };
    await trash(item.driveFileId);
    if (item.mediaFileId) await trash(item.mediaFileId);
    await this.store.deleteItem(kind, id);
    if (kind === "clip") await this.store.deleteMeta(`clipUpdatedAt:${id}`);
  }

  private async pushUpsert(kind: SyncKind, id: string): Promise<void> {
    if (kind === "song" && this.conflicts.some((c) => c.songId === id)) return;
    const local = await this.readLocal(kind, id);
    if (!local) return;
    const item = await this.store.getItem(kind, id);
    if (!item) return this.pushCreate(kind, id, local);
    if (item.lastSyncedHash === local.hash) return;
    const meta = await this.api.getMetadata(item.driveFileId);
    if (meta.trashed) return this.remoteGone(kind, id);
    if (meta.version !== item.lastRemoteVersion) {
      const remote = await this.readRemote(kind, meta);
      if (remote && remote.hash !== item.lastSyncedHash) {
        if (remote.hash === local.hash) return this.link(kind, id, meta, local.hash, item);
        const outcome = await this.bothChanged(kind, id, item, local, remote, meta);
        if (outcome === "done") return;
        // newest wins and local is newer: fall through and overwrite
        item.lastRemoteVersion = meta.version;
      } else {
        item.lastRemoteVersion = meta.version; // only metadata (name) changed remotely
      }
    }
    await this.pushUpdate(kind, id, item, local, meta);
  }

  // ---------------------------------------------------------------- reconcile

  /**
   * Both sides changed, with different content. Songs become conflicts; settings and
   * clip meta resolve by newest updatedAt. Returns "pushLocal" when local should overwrite Drive.
   */
  private async bothChanged(
    kind: SyncKind,
    id: string,
    item: SyncItem | undefined,
    local: LocalDoc,
    remote: RemoteDoc,
    file: DriveFile
  ): Promise<"done" | "pushLocal"> {
    if (kind === "song") {
      const conflict: SongConflict = {
        songId: id,
        localTitle: local.title,
        remoteTitle: titleFromText(remote.text) ?? "Untitled",
        localText: local.body,
        remoteText: remote.text,
        localUpdatedAt: local.updatedAt,
        remoteUpdatedAt: remote.updatedAt,
        driveFileId: file.id,
        remoteVersion: file.version,
      };
      // The item keeps the OLD remote version until resolved, so a later pull still sees a newer one.
      if (!item) await this.link("song", id, file, "", undefined);
      this.conflicts = [...this.conflicts.filter((c) => c.songId !== id), conflict];
      await this.persistLists();
      await this.store.dequeue(songKey(id));
      this.emit();
      return "done";
    }
    if (remote.updatedAt > local.updatedAt) {
      const hash = await this.applyRemote(kind, id, remote);
      await this.link(kind, id, file, hash, item);
      return "done";
    }
    await this.link(kind, id, file, item?.lastSyncedHash ?? "", item);
    return "pushLocal";
  }

  private async reconcileRemote(kind: SyncKind, id: string, file: DriveFile): Promise<void> {
    const item = await this.store.getItem(kind, id);
    if (item && item.driveFileId !== file.id) return; // a duplicate file for the same id
    if (item && item.lastRemoteVersion === file.version) return; // echo of our own write
    this.dropPendingDelete(kind, id);

    const remote = await this.readRemote(kind, file);
    if (!remote) return;
    const conflict = kind === "song" ? this.conflicts.find((c) => c.songId === id) : undefined;
    if (conflict) {
      conflict.remoteText = remote.text;
      conflict.remoteTitle = titleFromText(remote.text) ?? "Untitled";
      conflict.remoteUpdatedAt = remote.updatedAt;
      conflict.remoteVersion = file.version;
      await this.persistLists();
      this.emit();
      return;
    }
    const local = await this.readLocal(kind, id);
    if (!local) {
      if (item) return; // deleted locally; the queued delete will trash the file
      const hash = await this.applyRemote(kind, id, remote);
      await this.link(kind, id, file, hash);
      return;
    }
    if (!item) {
      if (local.hash === remote.hash) return this.link(kind, id, file, local.hash);
      await this.settleBoth(kind, id, undefined, local, remote, file);
      return;
    }
    if (remote.hash === item.lastSyncedHash) {
      await this.store.putItem({ ...item, lastRemoteVersion: file.version }); // rename or no-op
      return;
    }
    if (local.hash === item.lastSyncedHash) {
      const hash = await this.applyRemote(kind, id, remote);
      await this.link(kind, id, file, hash, item);
      return;
    }
    if (local.hash === remote.hash) return this.link(kind, id, file, local.hash, item);
    await this.settleBoth(kind, id, item, local, remote, file);
  }

  private async settleBoth(
    kind: SyncKind,
    id: string,
    item: SyncItem | undefined,
    local: LocalDoc,
    remote: RemoteDoc,
    file: DriveFile
  ): Promise<void> {
    const outcome = await this.bothChanged(kind, id, item, local, remote, file);
    if (outcome === "pushLocal") {
      await this.enqueue("upsert", kind, id);
      this.needFlush = true;
    }
  }

  private dropPendingDelete(kind: SyncKind, id: string): void {
    const before = this.pendingDeletes.length;
    this.pendingDeletes = this.pendingDeletes.filter((d) => !(d.kind === kind && d.id === id));
    if (this.pendingDeletes.length !== before) void this.persistLists();
  }

  /** Drive deleted or trashed this file: ask the user (songs, clips) or ignore (settings). */
  private async remoteGone(kind: SyncKind, id: string): Promise<void> {
    if (kind === "settings") {
      await this.store.deleteItem("settings", id);
      return;
    }
    await this.store.dequeue(kind === "song" ? songKey(id) : `clip:${id}`);
    const title = kind === "song" ? (await this.local.getSong(id))?.title : (await this.local.getClip(id))?.name;
    if (title === undefined) {
      await this.store.deleteItem(kind, id);
      return;
    }
    if (!this.pendingDeletes.some((d) => d.kind === kind && d.id === id)) {
      this.pendingDeletes = [...this.pendingDeletes, { kind, id, title }];
      await this.persistLists();
      this.emit();
    }
  }

  // --------------------------------------------------------------------- pull

  private async pullInternal(): Promise<void> {
    let token = await this.store.getMeta<string>("changesPageToken");
    if (!token) {
      await this.store.setMeta("changesPageToken", await this.api.getStartPageToken());
      return;
    }
    for (;;) {
      const page = await this.api.listChanges(token);
      for (const ch of page.changes) await this.handleRemoteChange(ch.fileId, ch.removed ? undefined : ch.file);
      if (page.nextPageToken) {
        token = page.nextPageToken;
        await this.store.setMeta("changesPageToken", token);
      } else {
        if (page.newStartPageToken) await this.store.setMeta("changesPageToken", page.newStartPageToken);
        return;
      }
    }
  }

  private async handleRemoteChange(fileId: string, file?: DriveFile): Promise<void> {
    if (!file || file.trashed) return this.onFileGone(fileId);
    const { taalmelKind, taalmelId } = file.appProperties;
    if (!taalmelKind || !taalmelId) return;
    if (taalmelKind === "song") return this.reconcileRemote("song", taalmelId, file);
    if (taalmelKind === "settings") return this.reconcileRemote("settings", "settings", file);
    if (taalmelKind === "clipMeta") return this.reconcileRemote("clip", taalmelId, file);
    if (taalmelKind === "clip") return this.attachMedia(taalmelId, file);
  }

  private async onFileGone(fileId: string): Promise<void> {
    for (const item of await this.store.listItems()) {
      if (item.driveFileId === fileId) {
        await this.remoteGone(item.kind, item.id);
      } else if (item.kind === "clip" && item.mediaFileId === fileId) {
        await this.store.putItem({ ...item, mediaFileId: undefined });
        const clip = await this.local.getClip(item.id);
        if (clip?.driveFileId === fileId) await this.local.putClip({ ...clip, driveFileId: undefined });
      }
    }
  }

  private async attachMedia(clipId: string, file: DriveFile): Promise<void> {
    const item = await this.store.getItem("clip", clipId);
    if (item && item.mediaFileId !== file.id) await this.store.putItem({ ...item, mediaFileId: file.id });
    const clip = await this.local.getClip(clipId);
    if (clip && clip.driveFileId !== file.id) await this.local.putClip({ ...clip, driveFileId: file.id });
  }

  private async mergeFirstConnect(): Promise<void> {
    const kinds: [string, SyncKind][] = [
      ["song", "song"],
      ["settings", "settings"],
      ["clipMeta", "clip"],
    ];
    for (const [taalmelKind, kind] of kinds) {
      const files = await listAllFiles(this.api, { appProperties: { taalmelKind } });
      const seen = new Set<string>();
      for (const f of files) {
        const id = kind === "settings" ? "settings" : f.appProperties.taalmelId;
        if (!id || seen.has(id)) continue;
        seen.add(id);
        await this.reconcileRemote(kind, id, f);
      }
    }
    for (const f of await listAllFiles(this.api, { appProperties: { taalmelKind: "clip" } })) {
      if (f.appProperties.taalmelId) await this.attachMedia(f.appProperties.taalmelId, f);
    }
    if (this.needFlush) this.needFlush = false;
  }

  // ----------------------------------------------------------- conflict/deletes

  async resolveConflict(songId: string, choice: "local" | "remote" | "both"): Promise<void> {
    await this.ready;
    return this.exclusive(async () => {
      const c = this.conflicts.find((x) => x.songId === songId);
      if (!c) return;
      const item = await this.store.getItem("song", songId);
      if (choice === "remote") {
        const rec = await this.local.putSong(songId, c.remoteText);
        await this.store.putItem({
          kind: "song",
          id: songId,
          driveFileId: c.driveFileId,
          lastSyncedHash: await sha256(rec.text),
          lastRemoteVersion: c.remoteVersion,
        });
      } else {
        if (choice === "both") {
          const newId = this.randomId();
          const copyTitle = `${c.remoteTitle} (Drive)`;
          const header = `title: ${copyTitle}`;
          const text = /^title:.*$/m.test(c.remoteText) ? c.remoteText.replace(/^title:.*$/m, header) : `${header}\n${c.remoteText}`;
          await this.local.putSong(newId, text);
          await this.enqueue("upsert", "song", newId);
        }
        // Local overwrites Drive: acknowledge the remote version, keep the local change pending.
        await this.store.putItem({
          kind: "song",
          id: songId,
          driveFileId: c.driveFileId,
          lastSyncedHash: item?.lastSyncedHash ?? "",
          lastRemoteVersion: c.remoteVersion,
        });
        await this.enqueue("upsert", "song", songId);
      }
      this.conflicts = this.conflicts.filter((x) => x.songId !== songId);
      await this.persistLists();
      this.emit();
      await this.doSync(true);
    });
  }

  /** `ids` are song or clip ids from `pendingRemoteDeletes`. */
  async resolveRemoteDeletes(ids: string[], accept: boolean): Promise<void> {
    await this.ready;
    return this.exclusive(async () => {
      const chosen = this.pendingDeletes.filter((d) => ids.includes(d.id));
      for (const d of chosen) {
        if (accept) {
          if (d.kind === "song") await this.local.deleteSong(d.id);
          else {
            await this.local.deleteClip(d.id);
            await this.store.deleteMeta(`clipUpdatedAt:${d.id}`);
          }
          await this.store.deleteItem(d.kind, d.id);
          await this.store.dequeue(d.kind === "clip" ? `clip:${d.id}:media` : songKey(d.id));
        } else {
          // Re-upload: forget the link so the next push creates the file again.
          const item = await this.store.getItem(d.kind, d.id);
          await this.store.deleteItem(d.kind, d.id);
          if (d.kind === "clip" && item?.mediaFileId) {
            const clip = await this.local.getClip(d.id);
            if (clip && !clip.driveFileId) await this.local.putClip({ ...clip, driveFileId: item.mediaFileId });
          }
          await this.enqueue("upsert", d.kind, d.id);
        }
      }
      this.pendingDeletes = this.pendingDeletes.filter((d) => !chosen.includes(d));
      await this.persistLists();
      this.emit();
      await this.doSync(true);
    });
  }

  // ------------------------------------------------------------------- media

  /** Queues a manual upload of the clip's media and runs it now. */
  async uploadClipMedia(id: string): Promise<void> {
    await this.ready;
    if (!this.conn) throw new Error("Drive is not connected.");
    await this.enqueue("upsert", "clip", id);
    await this.enqueue("uploadMedia", "clip", id);
    await this.syncNow();
  }

  /** Downloads the clip's media from Drive, stores it locally (silently) and returns it. */
  async downloadClipMedia(id: string, onProgress?: (fraction: number) => void): Promise<Blob> {
    await this.ready;
    const clip = await this.local.getClip(id);
    if (!clip) throw new Error(`Clip ${id} was not found.`);
    if (clip.blob) return clip.blob;
    if (!clip.driveFileId) throw new Error("This recording is not in Drive.");
    const blob = await this.api.downloadMedia(clip.driveFileId, onProgress, clip.size);
    await this.local.setClipBlob(id, blob);
    return blob;
  }

  /** Frees the local copy of a clip that is in Drive. */
  async removeLocalMedia(id: string): Promise<void> {
    await this.ready;
    const clip = await this.local.getClip(id);
    if (!clip) return;
    if (!clip.driveFileId) throw new Error("This recording is not in Drive; removing it would lose it.");
    await this.local.setClipBlob(id, null);
  }

  private async uploadMediaOp(q: QueueItem): Promise<void> {
    const clip = await this.local.getClip(q.id);
    if (!clip || !clip.blob) return;
    let item = await this.store.getItem("clip", q.id);
    if (!item) {
      await this.pushUpsert("clip", q.id);
      item = await this.store.getItem("clip", q.id);
      if (!item) return;
    }
    if (item.mediaFileId) return;
    if (clip.driveFileId) {
      await this.store.putItem({ ...item, mediaFileId: clip.driveFileId });
      return;
    }
    const blob = clip.blob;
    const total = blob.size;
    const meta = {
      name: mediaName(clip),
      mimeType: clip.mimeType || blob.type || "application/octet-stream",
      parents: [this.folders().recordings],
      appProperties: { taalmelKind: "clip", taalmelId: q.id },
    };
    this.uploads[q.id] = 0;
    this.emit();
    try {
      let file: DriveFile | undefined;
      if (total === 0) file = await this.api.createFile(meta, blob);
      else {
        let url = q.resumableUrl;
        for (let attempt = 0; attempt < 2 && !file; attempt++) {
          try {
            let offset = 0;
            if (url) {
              const st = await this.api.queryUploadStatus(url, total);
              if (st.done) {
                file = st.file;
                break;
              }
              offset = st.received;
            } else {
              url = await this.api.startResumableUpload(meta, total);
              await this.store.updateQueueItem(q.key, { resumableUrl: url });
            }
            while (offset < total) {
              const end = Math.min(offset + this.chunkSize, total);
              const p = await this.api.uploadChunk(url, blob.slice(offset, end), offset, total);
              if (p.done) {
                file = p.file;
                break;
              }
              offset = p.received;
              this.uploads[q.id] = offset / total;
              this.emit();
            }
          } catch (e) {
            if (e instanceof DriveError && e.status === 404 && url) {
              url = undefined; // the session expired: start over
              await this.store.updateQueueItem(q.key, { resumableUrl: undefined });
              continue;
            }
            throw e;
          }
        }
      }
      if (!file) throw new Error("Upload did not complete.");
      const cur = await this.store.getItem("clip", q.id);
      if (cur) await this.store.putItem({ ...cur, mediaFileId: file.id });
      const fresh = await this.local.getClip(q.id);
      if (fresh) await this.local.putClip({ ...fresh, driveFileId: file.id });
    } finally {
      delete this.uploads[q.id];
      this.emit();
    }
  }

  // ------------------------------------------------------------------ import

  /** Adopts files the user picked in Drive: `.txt` as songs, audio/video as clips. */
  async importFiles(fileIds: string[]): Promise<{ songs: string[]; clips: string[] }> {
    await this.ready;
    if (!this.conn) throw new Error("Drive is not connected.");
    return this.exclusive(async () => {
      const out = { songs: [] as string[], clips: [] as string[] };
      const f = this.folders();
      for (const fileId of fileIds) {
        const file = await this.api.getMetadata(fileId);
        const isText = file.mimeType === "text/plain" || /\.txt$/i.test(file.name);
        const isMedia = /^(audio|video)\//.test(file.mimeType);
        if (!isText && !isMedia) continue;
        const folder = isText ? f.songs : f.recordings;
        const tagKind = isText ? "song" : "clip";
        const existingId = file.appProperties.taalmelKind === tagKind ? file.appProperties.taalmelId : undefined;
        const id = existingId ?? this.randomId();
        const move = {
          addParents: file.parents.includes(folder) ? undefined : [folder],
          removeParents: file.parents.filter((p) => p !== folder),
        };
        if (isText) {
          if (existingId && (await this.local.getSong(id))) continue;
          const text = await (await this.api.downloadMedia(fileId)).text();
          const tagged = await this.api.updateMetadata(fileId, {
            appProperties: { taalmelKind: "song", taalmelId: id },
            ...(move.addParents ? { addParents: move.addParents, removeParents: move.removeParents } : {}),
          });
          const rec = await this.local.putSong(id, text);
          await this.store.putItem({
            kind: "song",
            id,
            driveFileId: tagged.id,
            lastSyncedHash: await sha256(rec.text),
            lastRemoteVersion: tagged.version,
          });
          out.songs.push(id);
        } else {
          if (existingId && (await this.local.getClip(id))) continue;
          const blob = await this.api.downloadMedia(fileId);
          const tagged = await this.api.updateMetadata(fileId, {
            appProperties: { taalmelKind: "clip", taalmelId: id },
            ...(move.addParents ? { addParents: move.addParents, removeParents: move.removeParents } : {}),
          });
          let probe: { durationSec: number; peaks?: number[] } = { durationSec: 0 };
          if (this.probeMedia) {
            try {
              probe = await this.probeMedia(blob);
            } catch {
              // Keep going with unknown duration: the clip is still usable.
            }
          }
          await this.local.putClip({
            id,
            name: file.name.replace(/\.[^.]+$/, ""),
            createdAt: this.now(),
            mimeType: file.mimeType,
            hasVideo: file.mimeType.startsWith("video/"),
            durationSec: probe.durationSec,
            size: blob.size,
            blob,
            driveFileId: tagged.id,
            flags: [],
            peaks: probe.peaks ?? [],
          });
          await this.store.setMeta(`clipUpdatedAt:${id}`, this.now());
          await this.enqueue("upsert", "clip", id);
          out.clips.push(id);
        }
      }
      await this.doSync(true);
      return out;
    });
  }
}
