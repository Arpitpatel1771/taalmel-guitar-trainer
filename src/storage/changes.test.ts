import "fake-indexeddb/auto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "../model/index.js";
import { _resetClipsDbForTests, CLIPS_DB_NAME, deleteClip, renameClip, saveClip, setClipBlob, updateClipFlags, updateClipPeaks } from "../recording/clipStore";
import { onStorageChange, type StorageChange } from "./changes.js";
import { saveSettings } from "./settings.js";
import { deleteSong, getSong, saveSong } from "./songs.js";
import { resetTaalmelDb } from "./testSetup.js";

const SONG = `title: T
time: 4/4
bpm: 100
unit: 8

[Verse]
Bar 1: {1} 1S0 {2} 1S1
`;

let events: StorageChange[];
let off: () => void;
beforeEach(() => {
  events = [];
  off = onStorageChange((e) => events.push(e));
});
afterEach(async () => {
  off();
  await resetTaalmelDb();
  await _resetClipsDbForTests();
  await new Promise<void>((res, rej) => {
    const r = indexedDB.deleteDatabase(CLIPS_DB_NAME);
    r.onsuccess = () => res();
    r.onerror = () => rej(r.error);
  });
});

const clipInput = { name: "A", createdAt: 1, mimeType: "audio/webm", hasVideo: false, durationSec: 3, blob: new Blob([new Uint8Array([1, 2, 3])]) };

describe("storage change events", () => {
  it("emits for song save/delete and settings", async () => {
    const s = await saveSong(SONG);
    await saveSettings(DEFAULT_SETTINGS);
    await deleteSong(s.id);
    expect(events).toEqual([
      { kind: "song", id: s.id, op: "upsert" },
      { kind: "settings", op: "upsert" },
      { kind: "song", id: s.id, op: "delete" },
    ]);
  });

  it("emits for every clip mutation", async () => {
    const c = await saveClip(clipInput);
    await renameClip(c.id, "B");
    await updateClipFlags(c.id, []);
    await updateClipPeaks(c.id, [0.5]);
    await setClipBlob(c.id, null);
    await deleteClip(c.id);
    expect(events.map((e) => `${e.kind}:${"op" in e ? e.op : ""}`)).toEqual(Array(5).fill("clip:upsert").concat("clip:delete"));
    expect(events.every((e) => e.kind === "clip" && e.id === c.id)).toBe(true);
  });

  it("silent writes do not emit", async () => {
    const s = await saveSong(SONG, undefined, { silent: true });
    await saveSettings(DEFAULT_SETTINGS, { silent: true });
    const c = await saveClip(clipInput, { silent: true });
    await renameClip(c.id, "B", { silent: true });
    await setClipBlob(c.id, null, { silent: true });
    await deleteClip(c.id, { silent: true });
    await deleteSong(s.id, { silent: true });
    expect(events).toEqual([]);
  });

  it("unsubscribe stops delivery", async () => {
    off();
    await saveSong(SONG);
    expect(events).toEqual([]);
  });
});

describe("saveSong with caller-chosen id", () => {
  it("creates when the id is new, then updates preserving createdAt", async () => {
    const a = await saveSong(SONG, "my-id");
    expect(a.id).toBe("my-id");
    expect(await getSong("my-id")).toEqual(a);
    const b = await saveSong(SONG.replace("title: T", "title: U"), "my-id");
    expect(b.createdAt).toBe(a.createdAt);
    expect(b.title).toBe("U");
  });
});

describe("null-blob clips", () => {
  it("round-trips a null blob and keeps size", async () => {
    const c = await saveClip({ ...clipInput, blob: null, size: 1234, driveFileId: "d1" });
    expect(c.size).toBe(1234);
    const withBlob = await setClipBlob(c.id, new Blob([new Uint8Array(10)]));
    expect(withBlob.size).toBe(10);
    const dropped = await setClipBlob(c.id, null);
    expect(dropped.blob).toBeNull();
    expect(dropped.size).toBe(10);
    expect(dropped.driveFileId).toBe("d1");
  });
  it("setClipBlob rejects unknown id", async () => {
    await expect(setClipBlob("nope", null)).rejects.toThrow();
  });
});
