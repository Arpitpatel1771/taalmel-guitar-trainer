import "fake-indexeddb/auto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS, type Settings, type SongRecord } from "../model/index";
import type { ClipRecord } from "../recording/clipStore";
import { _resetDbForTests } from "../storage/db";
import { DriveError } from "./api";
import { AuthRequiredError, type DriveAuth } from "./auth";
import { SyncEngine, backoffMs, defaultLocalStore, syncedSettings, type LocalStore, type SyncStore, type UploadSetting } from "./engine";
import * as syncDb from "./syncDb";
import { FakeDrive } from "./testing/fakeDrive";
import { memorySyncStore } from "./testing/memorySyncStore";

// ------------------------------------------------------------------ test kit

let clock = 1_000_000;
const now = () => (clock += 10);

function memoryLocal() {
  const songs = new Map<string, SongRecord>();
  const clips = new Map<string, ClipRecord>();
  let settings: Settings = { ...DEFAULT_SETTINGS };
  const store: LocalStore = {
    async listSongs() {
      return [...songs.values()];
    },
    async getSong(id) {
      return songs.get(id);
    },
    async putSong(id, text) {
      const title = /^title:[ \t]*(.*)$/m.exec(text)?.[1] ?? "Untitled";
      const rec: SongRecord = { id, text, title, bpm: 100, hasVideo: false, createdAt: "x", updatedAt: new Date(now()).toISOString() };
      songs.set(id, rec);
      return rec;
    },
    async deleteSong(id) {
      songs.delete(id);
    },
    async loadSettings() {
      return { ...settings };
    },
    async saveSettings(s) {
      settings = { ...s };
    },
    async listClips() {
      return [...clips.values()];
    },
    async getClip(id) {
      return clips.get(id);
    },
    async putClip(c) {
      clips.set(c.id, { ...c });
    },
    async deleteClip(id) {
      clips.delete(id);
    },
    async setClipBlob(id, blob) {
      const c = clips.get(id)!;
      clips.set(id, { ...c, blob, size: blob ? blob.size : c.size });
    },
  };
  return { store, songs, clips };
}

function fakeAuth() {
  const state = { needInteraction: false };
  const auth: DriveAuth = {
    getToken: vi.fn(async (opts: { interactive: boolean }) => {
      if (state.needInteraction && !opts.interactive) throw new AuthRequiredError();
      return "tok";
    }),
    onChange: () => () => undefined,
    email: () => "me@example.com",
    profile: () => ({ email: "me@example.com", name: "Me", picture: null }),
    signOut: vi.fn(),
  };
  return { auth, state };
}

let nextId = 1;
function device(drive: FakeDrive, opts: { store?: SyncStore; local?: LocalStore; chunkSize?: number } = {}) {
  const mem = memoryLocal();
  const { auth, state } = fakeAuth();
  const local = opts.local ?? mem.store;
  const engine = new SyncEngine({
    api: drive,
    auth,
    local,
    store: opts.store ?? memorySyncStore(),
    now,
    randomId: () => `gen-${nextId++}`,
    debounceMs: null,
    subscribe: false,
    chunkSize: opts.chunkSize,
  });
  return { engine, mem, local, auth, authState: state, drive };
}
type Dev = ReturnType<typeof device>;

const song = (title: string, body = "") => `title: ${title}\nbpm: 100\n${body}`;

async function saveSong(d: Dev, id: string, text: string) {
  await d.local.putSong(id, text);
  await d.engine.handleLocalChange({ kind: "song", id, op: "upsert" });
}
async function removeSong(d: Dev, id: string) {
  await d.local.deleteSong(id);
  await d.engine.handleLocalChange({ kind: "song", id, op: "delete" });
}
async function saveSettings(d: Dev, patch: Partial<Settings>) {
  await d.local.saveSettings({ ...(await d.local.loadSettings()), ...patch });
  await d.engine.handleLocalChange({ kind: "settings", op: "upsert" });
}
const clipOf = (id: string, over: Partial<ClipRecord> = {}): ClipRecord => ({
  id,
  name: `Clip ${id}`,
  createdAt: 5,
  mimeType: "audio/webm",
  hasVideo: false,
  durationSec: 3,
  size: 10,
  blob: new Blob(["0123456789"], { type: "audio/webm" }),
  flags: [],
  peaks: [0.1, 0.2],
  ...over,
});
async function saveClip(d: Dev, clip: ClipRecord) {
  await d.local.putClip({ ...clip, size: clip.blob ? clip.blob.size : clip.size });
  await d.engine.handleLocalChange({ kind: "clip", id: clip.id, op: "upsert" });
}
async function renameClip(d: Dev, id: string, name: string) {
  const c = (await d.local.getClip(id))!;
  await d.local.putClip({ ...c, name });
  await d.engine.handleLocalChange({ kind: "clip", id, op: "upsert" });
}

const names = (drive: FakeDrive) => drive.allFiles().filter((f) => !f.trashed).map((f) => f.name).sort();
const byKind = (drive: FakeDrive, kind: string) => drive.allFiles().filter((f) => f.appProperties.taalmelKind === kind);
const songFile = (drive: FakeDrive, id: string) => byKind(drive, "song").find((f) => f.appProperties.taalmelId === id)!;
const text = async (d: Dev, id: string) => (await d.local.getSong(id))?.text;

afterEach(async () => {
  await syncDb._resetSyncDbForTests();
  await new Promise<void>((resolve, reject) => {
    const req = indexedDB.deleteDatabase(syncDb.SYNC_DB_NAME);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
});

// -------------------------------------------------------------------- tests

describe("first connect", () => {
  it("with an empty Drive creates the folder tree and uploads local data", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    await a.local.putSong("s1", song("Wonderwall"));
    await a.local.putSong("s2", song("Wonderwall", "x"));
    await a.local.saveSettings({ ...DEFAULT_SETTINGS, zoom: 300, micEnabled: false });
    await a.local.putClip(clipOf("c1"));
    await a.engine.connect({ interactive: true });

    expect(names(drive)).toEqual(
      expect.arrayContaining([".taalmel", "Recordings", "Songs", "Taalmel", "Wonderwall (2).txt", "Wonderwall.txt", "c1.json", "settings.json", "clips"])
    );
    expect(drive.readText(songFile(drive, "s1").id)).toBe(song("Wonderwall"));
    const files = byKind(drive, "song");
    expect(files).toHaveLength(2);
    const songsFolder = drive.allFiles().find((f) => f.name === "Songs")!;
    expect(files.every((f) => f.parents.includes(songsFolder.id))).toBe(true);
    expect(a.engine.getStatus()).toMatchObject({ state: "idle", email: "me@example.com" });
    expect(a.engine.getStatus().lastSyncAt).not.toBeNull();
    // audio clip uploaded by default setting
    expect(byKind(drive, "clip")).toHaveLength(1);
    expect(byKind(drive, "clipMeta")).toHaveLength(1);
  });

  it("with existing data on both sides links, downloads, uploads and flags conflicts", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    await a.local.putSong("same", song("Same"));
    await a.local.putSong("diff", song("Diff", "a"));
    await a.local.putSong("onlyA", song("OnlyA"));
    await a.engine.connect({ interactive: true });

    const b = device(drive);
    await b.local.putSong("same", song("Same"));
    await b.local.putSong("diff", song("Diff", "b"));
    await b.local.putSong("onlyB", song("OnlyB"));
    await b.engine.connect({ interactive: true });

    expect(await text(b, "onlyA")).toBe(song("OnlyA"));
    expect(byKind(drive, "song").map((f) => f.appProperties.taalmelId).sort()).toEqual(["diff", "onlyA", "onlyB", "same"]);
    expect(b.engine.getStatus().conflicts.map((c) => c.songId)).toEqual(["diff"]);
    expect(b.engine.getStatus().conflicts[0]).toMatchObject({ localText: song("Diff", "b"), remoteText: song("Diff", "a") });
    // the conflicting file was not overwritten
    expect(drive.readText(songFile(drive, "diff").id)).toBe(song("Diff", "a"));
  });

  it("settings: newest wins, and local settings without updatedAt count as older", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    await a.local.saveSettings({ ...DEFAULT_SETTINGS, zoom: 111 });
    await saveSettings(a, { zoom: 222 });
    await a.engine.connect({ interactive: true });

    const b = device(drive);
    await b.local.saveSettings({ ...DEFAULT_SETTINGS, zoom: 999 }); // never edited while tracked: older
    await b.engine.connect({ interactive: true });
    expect((await b.local.loadSettings()).zoom).toBe(222);
  });
});

describe("song edits", () => {
  async function pair() {
    const drive = new FakeDrive();
    const a = device(drive);
    await saveSong(a, "s1", song("One"));
    await a.engine.connect({ interactive: true });
    const b = device(drive);
    await b.engine.connect({ interactive: true });
    expect(await text(b, "s1")).toBe(song("One"));
    return { drive, a, b };
  }

  it("local-only edit pushes to Drive", async () => {
    const { drive, a } = await pair();
    await saveSong(a, "s1", song("One", "edited"));
    await a.engine.syncNow();
    expect(drive.readText(songFile(drive, "s1").id)).toBe(song("One", "edited"));
  });

  it("remote-only edit applies locally on pull", async () => {
    const { drive, b } = await pair();
    drive.simulateExternalEdit(songFile(drive, "s1").id, song("One", "from drive"));
    await b.engine.pull();
    expect(await text(b, "s1")).toBe(song("One", "from drive"));
    expect(b.engine.getStatus().conflicts).toHaveLength(0);
  });

  it("renaming the title renames the Drive file", async () => {
    const { drive, a } = await pair();
    await saveSong(a, "s1", song("Renamed"));
    await a.engine.syncNow();
    expect(songFile(drive, "s1").name).toBe("Renamed.txt");
  });

  async function conflicted() {
    const { drive, a, b } = await pair();
    await saveSong(a, "s1", song("One", "A-edit"));
    await saveSong(b, "s1", song("One", "B-edit"));
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect(b.engine.getStatus().conflicts).toHaveLength(1);
    expect(b.engine.getStatus().state).toBe("idle");
    return { drive, a, b };
  }

  it("both edited: conflict, nothing overwritten", async () => {
    const { drive, b } = await conflicted();
    expect(drive.readText(songFile(drive, "s1").id)).toBe(song("One", "A-edit"));
    expect(await text(b, "s1")).toBe(song("One", "B-edit"));
  });

  it("conflicts survive a restart", async () => {
    const drive = new FakeDrive();
    const store = syncDb;
    const a = device(drive, { store });
    await saveSong(a, "s1", song("One"));
    await a.engine.connect({ interactive: true });
    const b = device(drive);
    await b.engine.connect({ interactive: true });
    await saveSong(a, "s1", song("One", "A"));
    await a.engine.syncNow();
    await saveSong(b, "s1", song("One", "B"));
    // b uses its own memory store; check persistence on a instead: make a conflict on a
    await b.engine.syncNow();
    await b.engine.syncNow();
    drive.simulateExternalEdit(songFile(drive, "s1").id, song("One", "ext"));
    await saveSong(a, "s1", song("One", "A2"));
    await a.engine.syncNow();
    expect(a.engine.getStatus().conflicts).toHaveLength(1);
    const restarted = new SyncEngine({ api: drive, auth: a.auth, local: a.local, store, now, debounceMs: null, subscribe: false });
    await restarted.connect({ interactive: false }).catch(() => undefined);
    expect(restarted.getStatus().conflicts.map((c) => c.songId)).toEqual(["s1"]);
    expect(restarted.getStatus().conflicts[0].remoteText).toBe(song("One", "ext"));
  });

  it("keep this device's overwrites Drive", async () => {
    const { drive, b } = await conflicted();
    await b.engine.resolveConflict("s1", "local");
    expect(drive.readText(songFile(drive, "s1").id)).toBe(song("One", "B-edit"));
    expect(b.engine.getStatus().conflicts).toHaveLength(0);
  });

  it("keep Drive's overwrites local", async () => {
    const { drive, b } = await conflicted();
    await b.engine.resolveConflict("s1", "remote");
    expect(await text(b, "s1")).toBe(song("One", "A-edit"));
    expect(drive.readText(songFile(drive, "s1").id)).toBe(song("One", "A-edit"));
    // stays quiet afterwards
    await b.engine.syncNow();
    expect(b.engine.getStatus().conflicts).toHaveLength(0);
  });

  it("keep both saves the remote as '<title> (Drive)' with a new id and local overwrites Drive", async () => {
    const { drive, a, b } = await conflicted();
    await b.engine.resolveConflict("s1", "both");
    expect(drive.readText(songFile(drive, "s1").id)).toBe(song("One", "B-edit"));
    const copy = b.mem.songs.get("gen-" + (nextId - 1))!;
    expect(copy.text).toBe(song("One (Drive)", "A-edit"));
    expect(byKind(drive, "song")).toHaveLength(2);
    await a.engine.syncNow();
    expect([...a.mem.songs.values()].map((s) => s.title).sort()).toEqual(["One", "One (Drive)"]);
  });
});

describe("deletes", () => {
  async function pair() {
    const drive = new FakeDrive();
    const a = device(drive);
    await saveSong(a, "s1", song("One"));
    await a.engine.connect({ interactive: true });
    const b = device(drive);
    await b.engine.connect({ interactive: true });
    return { drive, a, b };
  }

  it("local delete trashes the Drive file", async () => {
    const { drive, a, b } = await pair();
    await removeSong(a, "s1");
    await a.engine.syncNow();
    expect(songFile(drive, "s1").trashed).toBe(true);
    await b.engine.pull();
    expect(b.engine.getStatus().pendingRemoteDeletes).toEqual([{ kind: "song", id: "s1", title: "One" }]);
    expect(await text(b, "s1")).toBeDefined(); // never applied silently
  });

  it("remote delete: accepting deletes locally", async () => {
    const { drive, b } = await pair();
    drive.simulateExternalTrash(songFile(drive, "s1").id);
    await b.engine.pull();
    expect(b.engine.getStatus().pendingRemoteDeletes).toHaveLength(1);
    await b.engine.resolveRemoteDeletes(["s1"], true);
    expect(await text(b, "s1")).toBeUndefined();
    expect(b.engine.getStatus().pendingRemoteDeletes).toHaveLength(0);
    await b.engine.syncNow();
    expect(await text(b, "s1")).toBeUndefined();
  });

  it("remote delete: declining re-uploads the local copy", async () => {
    const { drive, b } = await pair();
    drive.simulateExternalDelete(songFile(drive, "s1").id);
    await b.engine.pull();
    expect(b.engine.getStatus().pendingRemoteDeletes).toHaveLength(1);
    await b.engine.resolveRemoteDeletes(["s1"], false);
    expect(await text(b, "s1")).toBe(song("One"));
    const live = byKind(drive, "song").filter((f) => !f.trashed);
    expect(live).toHaveLength(1);
    expect(drive.readText(live[0].id)).toBe(song("One"));
  });

  it("a 404 on a known file is treated as a remote delete", async () => {
    const { drive, a } = await pair();
    drive.simulateExternalDelete(songFile(drive, "s1").id);
    await saveSong(a, "s1", song("One", "edit"));
    await a.engine.syncNow();
    expect(a.engine.getStatus().pendingRemoteDeletes.map((d) => d.id)).toEqual(["s1"]);
  });

  it("clip delete trashes media and meta; other device asks before removing", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    await a.local.putClip(clipOf("c1"));
    await a.engine.connect({ interactive: true });
    const b = device(drive);
    await b.engine.connect({ interactive: true });
    expect((await b.local.getClip("c1"))?.blob).toBeNull();
    await a.local.deleteClip("c1");
    await a.engine.handleLocalChange({ kind: "clip", id: "c1", op: "delete" });
    await a.engine.syncNow();
    expect(byKind(drive, "clip")[0].trashed).toBe(true);
    expect(byKind(drive, "clipMeta")[0].trashed).toBe(true);
    await b.engine.pull();
    expect(b.engine.getStatus().pendingRemoteDeletes[0]).toMatchObject({ kind: "clip", id: "c1" });
    await b.engine.resolveRemoteDeletes(["c1"], true);
    expect(await b.local.getClip("c1")).toBeUndefined();
  });
});

describe("renames and adoption", () => {
  it("a rename in Drive keeps the link", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    await saveSong(a, "s1", song("One"));
    await a.engine.connect({ interactive: true });
    drive.simulateExternalRename(songFile(drive, "s1").id, "My own name.txt");
    await a.engine.pull();
    expect(await text(a, "s1")).toBe(song("One"));
    await saveSong(a, "s1", song("One", "more"));
    await a.engine.syncNow();
    expect(byKind(drive, "song")).toHaveLength(1);
    expect(drive.readText(songFile(drive, "s1").id)).toBe(song("One", "more"));
    expect(a.engine.getStatus().conflicts).toHaveLength(0);
  });

  it("adopts an untagged .txt picked via import: tagged and moved into Songs", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    await a.engine.connect({ interactive: true });
    const stray = drive.simulateExternalCreate({ name: "random.txt", text: song("Imported") });
    const res = await a.engine.importFiles([stray.id]);
    expect(res.songs).toHaveLength(1);
    const id = res.songs[0];
    expect(await text(a, id)).toBe(song("Imported"));
    const songsFolder = drive.allFiles().find((f) => f.name === "Songs")!;
    const file = drive.allFiles().find((f) => f.id === stray.id)!;
    expect(file.appProperties).toEqual({ taalmelKind: "song", taalmelId: id });
    expect(file.parents).toEqual([songsFolder.id]);
    // linked: a later edit updates the same file
    await saveSong(a, id, song("Imported", "x"));
    await a.engine.syncNow();
    expect(drive.readText(stray.id)).toBe(song("Imported", "x"));
  });

  it("imports picked media as a clip with a meta file", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    await a.engine.connect({ interactive: true });
    const m = await drive.createFile({ name: "riff.webm", mimeType: "audio/webm" }, new Blob(["abcdef"]));
    const res = await a.engine.importFiles([m.id]);
    const clip = (await a.local.getClip(res.clips[0]))!;
    expect(clip).toMatchObject({ name: "riff", driveFileId: m.id, hasVideo: false });
    expect(byKind(drive, "clipMeta")).toHaveLength(1);
    expect(byKind(drive, "clip")).toHaveLength(1); // not uploaded twice
  });
});

describe("remote song that fails to parse", () => {
  it("is still stored (via the raw path of the default local store)", async () => {
    const drive = new FakeDrive();
    const a = device(drive, { local: defaultLocalStore });
    await a.engine.connect({ interactive: true });
    const songs = drive.allFiles().find((f) => f.name === "Songs")!;
    await drive.createFile(
      { name: "Broken.txt", mimeType: "text/plain", parents: [songs.id], appProperties: { taalmelKind: "song", taalmelId: "broken-1" } },
      new Blob(["title: Broken\nthis is not a song at all ###"])
    );
    await a.engine.pull();
    const rec = await defaultLocalStore.getSong("broken-1");
    expect(rec?.text).toBe("title: Broken\nthis is not a song at all ###");
    expect(rec?.title).toBe("Broken");
    await a.engine.syncNow();
    expect(a.engine.getStatus().state).toBe("idle");
    _resetDbForTests();
  });
});

describe("queue, restart and errors", () => {
  it("the queue persists across an engine restart", async () => {
    const drive = new FakeDrive();
    const a = device(drive, { store: syncDb });
    await saveSong(a, "s1", song("One"));
    await a.engine.connect({ interactive: true });
    await saveSong(a, "s1", song("One", "pending"));
    expect((await syncDb.listQueue()).map((q) => q.key)).toEqual(["song:s1"]);
    a.engine.stop();

    const fresh = new SyncEngine({ api: drive, auth: a.auth, local: a.local, store: syncDb, now, debounceMs: null, subscribe: false });
    await fresh.connect({ interactive: false }); // resumes from stored meta
    expect(fresh.getStatus().state).toBe("idle");
    expect(drive.readText(songFile(drive, "s1").id)).toBe(song("One", "pending"));
    expect(await syncDb.listQueue()).toHaveLength(0);
  });

  it("offline keeps the queue, then recovers", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    await saveSong(a, "s1", song("One"));
    await a.engine.connect({ interactive: true });
    await saveSong(a, "s1", song("One", "later"));
    drive.failNext(0, "networkError");
    await a.engine.syncNow();
    expect(a.engine.getStatus().state).toBe("offline");
    expect(drive.readText(songFile(drive, "s1").id)).toBe(song("One"));
    await a.engine.syncNow();
    expect(a.engine.getStatus().state).toBe("idle");
    expect(drive.readText(songFile(drive, "s1").id)).toBe(song("One", "later"));
  });

  it("401 refreshes silently once, then goes to authRequired and keeps the queue", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    await saveSong(a, "s1", song("One"));
    await a.engine.connect({ interactive: true });

    await saveSong(a, "s1", song("One", "v2"));
    drive.failNext(401, "authError");
    await a.engine.syncNow();
    expect(a.engine.getStatus().state).toBe("idle"); // silent refresh worked
    expect(drive.readText(songFile(drive, "s1").id)).toBe(song("One", "v2"));

    await saveSong(a, "s1", song("One", "v3"));
    a.authState.needInteraction = true;
    drive.failNext(401, "authError");
    await a.engine.syncNow();
    expect(a.engine.getStatus().state).toBe("authRequired");
    expect(drive.readText(songFile(drive, "s1").id)).toBe(song("One", "v2"));

    a.authState.needInteraction = false;
    await a.engine.connect({ interactive: true }); // the "sign in to resume" click
    expect(a.engine.getStatus().state).toBe("idle");
    expect(drive.readText(songFile(drive, "s1").id)).toBe(song("One", "v3"));
  });

  it("a silent resume that needs interaction reports authRequired", async () => {
    const drive = new FakeDrive();
    const a = device(drive, { store: syncDb });
    await a.engine.connect({ interactive: true });
    a.engine.stop();
    const fresh = device(drive, { store: syncDb });
    fresh.authState.needInteraction = true;
    await fresh.engine.connect({ interactive: false });
    expect(fresh.engine.getStatus().state).toBe("authRequired");
  });

  it("5xx, 429 and rate limits go to retrying with backoff", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    await saveSong(a, "s1", song("One"));
    await a.engine.connect({ interactive: true });
    for (const [status, reason] of [
      [503, "backendError"],
      [429, "tooManyRequests"],
      [403, "rateLimitExceeded"],
    ] as const) {
      await saveSong(a, "s1", song("One", String(status)));
      drive.failNext(status, reason);
      await a.engine.syncNow();
      expect(a.engine.getStatus().state).toBe("retrying");
      await a.engine.syncNow();
      expect(a.engine.getStatus().state).toBe("idle");
    }
    expect([1, 2, 3, 4, 8, 9, 20].map(backoffMs)).toEqual([2000, 4000, 8000, 16000, 256000, 300000, 300000]);
  });

  it("timers: a change is flushed after the debounce", async () => {
    const drive = new FakeDrive();
    const { auth } = fakeAuth();
    const mem = memoryLocal();
    const engine = new SyncEngine({
      api: drive,
      auth,
      local: mem.store,
      store: memorySyncStore(),
      now,
      debounceMs: 5,
      subscribe: false,
    });
    await engine.connect({ interactive: true });
    await mem.store.putSong("s1", song("One"));
    await engine.handleLocalChange({ kind: "song", id: "s1", op: "upsert" });
    await vi.waitFor(() => expect(byKind(drive, "song")).toHaveLength(1));
    engine.stop();
  });

  it("disconnect forgets the connection and leaves data alone", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    await saveSong(a, "s1", song("One"));
    await a.engine.connect({ interactive: true });
    await a.engine.disconnect();
    expect(a.engine.getStatus().state).toBe("disconnected");
    expect(await text(a, "s1")).toBe(song("One"));
    expect(byKind(drive, "song")).toHaveLength(1);
    expect(a.auth.signOut).toHaveBeenCalled();
  });
});

describe("settings and clip meta", () => {
  it("device-local settings never leave the device or get overwritten", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    const cal = { latencyMs: 40 } as unknown as Settings["calibration"];
    await a.local.saveSettings({ ...DEFAULT_SETTINGS, calibration: cal, micEnabled: false, persistBannerDismissed: true });
    await saveSettings(a, { zoom: 321 });
    await a.engine.connect({ interactive: true });

    const file = byKind(drive, "settings")[0];
    const json = JSON.parse(drive.readText(file.id));
    expect(json.settings.zoom).toBe(321);
    for (const k of ["calibration", "micEnabled", "persistBannerDismissed"]) expect(k in json.settings).toBe(false);
    expect(Object.keys(syncedSettings(DEFAULT_SETTINGS))).not.toContain("micEnabled");

    const b = device(drive);
    await b.local.saveSettings({ ...DEFAULT_SETTINGS, micEnabled: true, calibration: null });
    await b.engine.connect({ interactive: true });
    expect(await b.local.loadSettings()).toMatchObject({ zoom: 321, micEnabled: true, calibration: null });

    await saveSettings(a, { zoom: 400 });
    await a.engine.syncNow();
    await b.engine.pull();
    expect(await b.local.loadSettings()).toMatchObject({ zoom: 400, micEnabled: true, calibration: null });
    expect((await a.local.loadSettings()).micEnabled).toBe(false);
  });

  it("a change to only device-local settings does not touch Drive", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    await a.engine.connect({ interactive: true });
    const before = byKind(drive, "settings")[0].version;
    await saveSettings(a, { micEnabled: false });
    await a.engine.syncNow();
    expect(byKind(drive, "settings")[0].version).toBe(before);
  });

  it("settings: the newest updatedAt wins when both changed", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    await a.engine.connect({ interactive: true });
    const b = device(drive);
    await b.engine.connect({ interactive: true });

    await saveSettings(a, { zoom: 500 }); // older
    await saveSettings(b, { zoom: 600 }); // newer
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect((await a.local.loadSettings()).zoom).toBe(600);

    await saveSettings(b, { zoom: 650 }); // older
    await saveSettings(a, { zoom: 700 }); // newer
    await b.engine.syncNow();
    await a.engine.syncNow();
    await b.engine.syncNow();
    expect((await a.local.loadSettings()).zoom).toBe(700);
    expect((await b.local.loadSettings()).zoom).toBe(700);
  });

  it("clip meta: newest wins; flags, peaks and renames sync", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    await a.local.putClip(clipOf("c1", { blob: null, mimeType: "video/mp4", hasVideo: true }));
    await a.engine.connect({ interactive: true });
    const b = device(drive);
    await b.engine.connect({ interactive: true });
    expect(await b.local.getClip("c1")).toMatchObject({ name: "Clip c1", blob: null, peaks: [0.1, 0.2] });

    await renameClip(a, "c1", "A name");
    await renameClip(b, "c1", "B name"); // newer
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    expect((await a.local.getClip("c1"))!.name).toBe("B name");
    expect((await b.local.getClip("c1"))!.name).toBe("B name");

    const c = (await a.local.getClip("c1"))!;
    await a.local.putClip({ ...c, flags: [{ id: "f", timeSec: 1, label: "x" }] });
    await a.engine.handleLocalChange({ kind: "clip", id: "c1", op: "upsert" });
    await a.engine.syncNow();
    await b.engine.pull();
    expect((await b.local.getClip("c1"))!.flags).toEqual([{ id: "f", timeSec: 1, label: "x" }]);
  });
});

describe("clip media", () => {
  async function setup(setting?: UploadSetting) {
    const drive = new FakeDrive();
    const a = device(drive);
    await a.engine.connect({ interactive: true });
    if (setting) await a.engine.setUploadSetting(setting);
    return { drive, a };
  }
  const mediaFiles = (drive: FakeDrive) => byKind(drive, "clip");

  it("defaults to audio only and uploads meta for every clip", async () => {
    const { drive, a } = await setup();
    expect(a.engine.getUploadSetting()).toBe("audio");
    await saveClip(a, clipOf("aud"));
    await saveClip(a, clipOf("vid", { hasVideo: true, mimeType: "video/mp4" }));
    await a.engine.syncNow();
    expect(mediaFiles(drive).map((f) => f.appProperties.taalmelId)).toEqual(["aud"]);
    expect(byKind(drive, "clipMeta")).toHaveLength(2);
    const rec = drive.allFiles().find((f) => f.name === "Clip aud.webm");
    expect(rec).toBeDefined();
    expect((await a.local.getClip("aud"))!.driveFileId).toBe(rec!.id);
  });

  it("off uploads nothing automatically; manual upload works", async () => {
    const { drive, a } = await setup("off");
    await saveClip(a, clipOf("aud"));
    await a.engine.syncNow();
    expect(mediaFiles(drive)).toHaveLength(0);
    await a.engine.uploadClipMedia("aud");
    expect(mediaFiles(drive)).toHaveLength(1);
  });

  it("everything uploads video too, and changing the setting backfills", async () => {
    const { drive, a } = await setup("audio");
    await saveClip(a, clipOf("vid", { hasVideo: true, mimeType: "video/mp4" }));
    await a.engine.syncNow();
    expect(mediaFiles(drive)).toHaveLength(0);
    await a.engine.setUploadSetting("all");
    await a.engine.syncNow();
    expect(mediaFiles(drive)).toHaveLength(1);
    expect(drive.allFiles().some((f) => f.name === "Clip vid.mp4")).toBe(true);
  });

  it("uploads in chunks, reports progress, and a failure mid-upload resumes", async () => {
    const drive = new FakeDrive();
    const a = device(drive, { chunkSize: 4 });
    await a.engine.connect({ interactive: true });
    const chunks: number[] = [];
    const orig = drive.uploadChunk.bind(drive);
    let failOnce = true;
    drive.uploadChunk = async (url, chunk, offset, total) => {
      if (offset === 4 && failOnce) {
        failOnce = false;
        throw new DriveError(503, "backendError");
      }
      chunks.push(offset);
      return orig(url, chunk, offset, total);
    };
    const progress: number[] = [];
    a.engine.onStatus((s) => {
      if (s.uploads.c1 !== undefined) progress.push(s.uploads.c1);
    });
    await saveClip(a, clipOf("c1"));
    await a.engine.syncNow();
    expect(a.engine.getStatus().state).toBe("retrying");
    const q = (await a.engine["store"].listQueue()).find((x) => x.op === "uploadMedia")!;
    expect(q.resumableUrl).toBeDefined();
    expect(chunks).toEqual([0]);

    await a.engine.syncNow(); // resumes via queryUploadStatus from byte 4
    expect(chunks).toEqual([0, 4, 8]);
    expect(a.engine.getStatus().state).toBe("idle");
    expect(Math.max(...progress)).toBeGreaterThan(0);
    const file = mediaFiles(drive)[0];
    expect(drive.readText(file.id)).toBe("0123456789");
    expect(a.engine.getStatus().uploads).toEqual({});
  });

  it("an expired upload session (404) restarts the upload", async () => {
    const drive = new FakeDrive();
    const a = device(drive, { chunkSize: 4 });
    await a.engine.connect({ interactive: true });
    const origUpload = drive.uploadChunk.bind(drive);
    let broke = false;
    drive.uploadChunk = async (url, chunk, offset, total) => {
      if (offset === 4 && !broke) {
        broke = true;
        throw new DriveError(503, "backendError");
      }
      return origUpload(url, chunk, offset, total);
    };
    await saveClip(a, clipOf("c1"));
    await a.engine.syncNow();
    drive.queryUploadStatus = async () => {
      throw new DriveError(404, "notFound");
    };
    await a.engine.syncNow();
    expect(a.engine.getStatus().state).toBe("idle");
    expect(drive.readText(mediaFiles(drive)[0].id)).toBe("0123456789");
    expect(mediaFiles(drive)).toHaveLength(1);
  });

  it("quota errors pause media uploads (driveFull) while metadata keeps syncing", async () => {
    const { drive, a } = await setup();
    drive.startResumableUpload = async () => {
      throw new DriveError(403, "storageQuotaExceeded");
    };
    await saveClip(a, clipOf("c1"));
    await saveSong(a, "s1", song("One"));
    await a.engine.syncNow();
    expect(a.engine.getStatus().state).toBe("driveFull");
    expect(byKind(drive, "clipMeta")).toHaveLength(1);
    expect(byKind(drive, "song")).toHaveLength(1);
    expect(mediaFiles(drive)).toHaveLength(0);
    expect((await a.engine["store"].listQueue()).some((q) => q.op === "uploadMedia")).toBe(true);
  });

  it("clips from another device arrive without media; download and remove-local work", async () => {
    const { drive, a } = await setup();
    await saveClip(a, clipOf("c1"));
    await saveClip(a, clipOf("c2", { hasVideo: true, mimeType: "video/mp4" })); // meta only
    await a.engine.syncNow();
    const b = device(drive);
    await b.engine.connect({ interactive: true });
    const c1 = (await b.local.getClip("c1"))!;
    const c2 = (await b.local.getClip("c2"))!;
    expect(c1.blob).toBeNull();
    expect(c1.driveFileId).toBeDefined();
    expect(c2.blob).toBeNull();
    expect(c2.driveFileId).toBeUndefined();
    await expect(b.engine.downloadClipMedia("c2")).rejects.toThrow();

    const seen: number[] = [];
    const blob = await b.engine.downloadClipMedia("c1", (f) => seen.push(f));
    expect(await blob.text()).toBe("0123456789");
    expect(seen.some((f) => f > 0 && f < 1)).toBe(true);
    expect(seen[seen.length - 1]).toBe(1);
    expect((await b.local.getClip("c1"))!.blob).not.toBeNull();
    await b.engine.removeLocalMedia("c1");
    expect((await b.local.getClip("c1"))!.blob).toBeNull();
    await expect(b.engine.removeLocalMedia("c2")).rejects.toThrow();
  });

  it("a clip that arrives before its media gets its driveFileId when the media shows up", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    await a.engine.connect({ interactive: true });
    await a.engine.setUploadSetting("off");
    await saveClip(a, clipOf("c1"));
    await a.engine.syncNow();
    const b = device(drive);
    await b.engine.connect({ interactive: true });
    expect((await b.local.getClip("c1"))!.driveFileId).toBeUndefined();
    await a.engine.uploadClipMedia("c1");
    await b.engine.pull();
    expect((await b.local.getClip("c1"))!.driveFileId).toBeDefined();
  });
});

describe("two devices", () => {
  it("converge on the same library", async () => {
    const drive = new FakeDrive();
    const a = device(drive);
    const b = device(drive);
    await saveSong(a, "a1", song("Alpha"));
    await saveSong(a, "a2", song("Beta"));
    await saveClip(a, clipOf("c1"));
    await saveSettings(a, { zoom: 280 });
    await a.engine.connect({ interactive: true });
    await saveSong(b, "b1", song("Gamma"));
    await b.engine.connect({ interactive: true });
    await a.engine.syncNow();

    await saveSong(a, "a1", song("Alpha", "a-edit"));
    await saveSong(b, "b1", song("Gamma", "b-edit"));
    await removeSong(b, "a2");
    await renameClip(b, "c1", "Renamed on B");
    await a.engine.syncNow();
    await b.engine.syncNow();
    await a.engine.syncNow();
    await b.engine.syncNow();
    // a's pending-delete for a2 is confirmed
    await a.engine.resolveRemoteDeletes(["a2"], true);
    await b.engine.syncNow();

    const lib = async (d: Dev) => ({
      songs: Object.fromEntries((await d.local.listSongs()).map((s) => [s.id, s.text])),
      clips: Object.fromEntries((await d.local.listClips()).map((c) => [c.id, c.name])),
      zoom: (await d.local.loadSettings()).zoom,
    });
    const la = await lib(a);
    const lb = await lib(b);
    expect(la).toEqual(lb);
    expect(la.songs).toEqual({ a1: song("Alpha", "a-edit"), b1: song("Gamma", "b-edit") });
    expect(la.clips).toEqual({ c1: "Renamed on B" });
    expect(la.zoom).toBe(280);
    expect(a.engine.getStatus().conflicts).toHaveLength(0);
    expect(b.engine.getStatus().conflicts).toHaveLength(0);
  });
});
