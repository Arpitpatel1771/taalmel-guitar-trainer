import "fake-indexeddb/auto";
import { afterEach, describe, expect, it } from "vitest";
import { createDriveSync, type DocumentCollection, type FileCollection } from "@arpitpatel/drive-sync";
import { FakeAuth, FakeDrive, createMemorySyncStore } from "@arpitpatel/drive-sync/testing";
import type { ClipRecord } from "./recording/clipStore";
import { CLIPS_DB_NAME, _resetClipsDbForTests, getClip, saveClip } from "./recording/clipStore";
import { resetTaalmelDb } from "./storage/testSetup";
import { saveSong, getSong } from "./storage/songs";
import { taalmelDriveConfig } from "./driveConfig";
import { DEFAULT_SETTINGS, type Settings } from "./model/index";
import { loadSettings, saveSettings } from "./storage/settings";

afterEach(async () => {
  await resetTaalmelDb();
  await _resetClipsDbForTests();
  await new Promise<void>((resolve) => {
    const req = indexedDB.deleteDatabase(CLIPS_DB_NAME);
    req.onsuccess = req.onerror = req.onblocked = () => resolve();
  });
});

const SONG = `title: Test Song
time: 4/4
bpm: 100
unit: 8

[Verse]
Bar 1: {1} 1S0 {2} 1S1
`;

const songCol = () => taalmelDriveConfig.collections.find((c) => c.kind === "song") as DocumentCollection;
const clipCol = () => taalmelDriveConfig.collections.find((c) => c.kind === "clip") as FileCollection<ClipRecord>;

// ---- Taalmel's literal pre-package hashing code (src/drive/engine.ts before Task 11), copied verbatim.
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
    gainDb: c.gainDb,
    boost: c.boost,
    mediaRev: c.mediaRev,
  };
}

// Taalmel's literal pre-package syncedSettings (src/drive/engine.ts before Task 11), copied verbatim.
const DEVICE_LOCAL_SETTINGS = ["calibration", "micEnabled", "persistBannerDismissed", "theme"] as const;
function syncedSettings(s: Partial<Settings>): Partial<Settings> {
  const o: Partial<Settings> = { ...s };
  for (const k of DEVICE_LOCAL_SETTINGS) delete o[k];
  return o;
}

describe("taalmelDriveConfig", () => {
  it("declares the Taalmel collections, settings and device-local fields", () => {
    expect(taalmelDriveConfig.namespace).toBe("taalmel");
    expect(taalmelDriveConfig.appName).toBe("Taalmel");
    expect(taalmelDriveConfig.hiddenFolder).toBe(".taalmel");
    expect(taalmelDriveConfig.collections.map((c) => c.kind)).toEqual(["song", "clip"]);
    expect(taalmelDriveConfig.settings?.deviceLocal).toEqual(["calibration", "micEnabled", "persistBannerDismissed", "theme"]);
    const clip = clipCol();
    expect(clip.uploadSettings.map((u) => u.value)).toEqual(["off", "audio", "all"]);
    expect(clip.defaultUploadSetting).toBe("audio");
  });

  it("toFile returns the exact stored song text", async () => {
    const rec = await saveSong(SONG, "s1", { silent: true });
    expect(songCol().toFile(rec)).toBe(rec.text);
  });

  it("keeps Taalmel's Drive tags, sidecar kind and folder ids", async () => {
    const song = await saveSong(SONG, "song-1", { silent: true });
    await saveClip({ id: "clip-1", name: "Take", createdAt: 5, mimeType: "audio/webm", hasVideo: false, durationSec: 3, blob: new Blob(["abc"], { type: "audio/webm" }) }, { silent: true });
    const fake = new FakeDrive({ namespace: "taalmel" });
    const drive = createDriveSync(taalmelDriveConfig, { api: fake, auth: new FakeAuth(), store: createMemorySyncStore() });
    await drive.connect();
    await drive.syncNow();
    drive.stop();

    const songs = fake.tagged("song");
    expect(songs).toHaveLength(1);
    expect(songs[0].appProperties).toEqual({ taalmelKind: "song", taalmelId: "song-1" });
    expect(fake.readText(songs[0].id)).toBe(song.text);

    const sidecars = fake.tagged("clipMeta", "clip-1");
    expect(sidecars).toHaveLength(1);
    expect(sidecars[0].appProperties).toEqual({ taalmelKind: "clipMeta", taalmelId: "clip-1" });
    expect(fake.tagged("clip", "clip-1")).toHaveLength(1);

    const folderIds = fake
      .tagged("folder")
      .map((f) => f.appProperties.taalmelId)
      .sort();
    expect(folderIds).toEqual(["clips", "hidden", "recordings", "root", "songs"]);
    expect(fake.tagged("settings").length).toBeLessThanOrEqual(1);
  });

  it("a song pulled from Drive is stored canonically and does not look like a local change", async () => {
    const col = songCol();
    const remote = `title: Pulled\nbpm: 90\ntime: 4/4\nunit: 8\n\n[Verse]\nBar 1: {1} 1S0 {2} 1S1\n`;
    const item = col.fromFile(remote, "p1");
    await col.store.save("p1", item);
    const stored = await getSong("p1");
    expect(stored?.text).toBe(item.text); // the engine hashes toFile(item): it must equal what is stored
    expect(col.toFile(stored)).toBe(col.toFile(item));
    expect(col.titleOf(item)).toBe("Pulled");
  });

  it("onKeepBoth retitles the Drive copy as 'Title (Drive)'", () => {
    const col = songCol();
    const copy = col.onKeepBoth!(col.fromFile(SONG, "n1"));
    expect(copy.title).toBe("Test Song (Drive)");
    expect(copy.text).toContain("title: Test Song (Drive)");
    expect(copy.id).toBe("n1");
  });
});

describe("clip sidecar content (what existing users already have hashed)", () => {
  const full: ClipRecord = {
    id: "c1",
    name: "Riff",
    createdAt: 1700000000000,
    mimeType: "audio/webm;codecs=opus",
    hasVideo: false,
    durationSec: 12.5,
    size: 4096,
    blob: null,
    driveFileId: "legacy-media-id",
    flags: [{ id: "f1", timeSec: 1.5, label: "A" }],
    peaks: [0.1, 0.5, 1],
    gainDb: 6.5,
    boost: true,
    mediaRev: 2,
  };
  const sparse: ClipRecord = { id: "c2", name: "Old", createdAt: 5, mimeType: "video/mp4", hasVideo: true, durationSec: 0, size: 0, blob: null };

  it.each([
    ["every field set", full],
    ["fields missing", sparse],
  ])("sha256(stable(meta(clip))) equals Taalmel's old hash with %s", async (_n, clip) => {
    expect(await sha256(stable(clipCol().meta(clip)))).toBe(await sha256(stable(clipContent(clip))));
    expect(stable(clipCol().meta(clip))).toBe(stable(clipContent(clip)));
  });

  it("reads the legacy Drive media id from the record", () => {
    expect(clipCol().legacyMediaFileId?.(full)).toBe("legacy-media-id");
    expect(clipCol().legacyMediaFileId?.(sparse)).toBeUndefined();
  });

  it("fromMeta fills Taalmel's defaults and keeps the local blob, size and local-only fields", () => {
    const col = clipCol();
    const blob = new Blob(["xx"]);
    const existing: ClipRecord = { ...full, blob, size: 2, driveFileId: "mine" };
    const merged = col.fromMeta({ name: "Renamed", createdAt: 9, mimeType: "audio/mp4", hasVideo: false, durationSec: 4, size: 999, flags: [], peaks: [] }, "c1", existing);
    expect(merged).toMatchObject({ id: "c1", name: "Renamed", createdAt: 9, size: 2, driveFileId: "mine", gainDb: undefined, boost: undefined, mediaRev: undefined });
    expect(merged.blob).toBe(blob);
    const fresh = col.fromMeta({}, "c9", undefined);
    expect(fresh).toMatchObject({ id: "c9", name: "Recording", mimeType: "", hasVideo: false, durationSec: 0, size: 0, blob: null, flags: [], peaks: [] });
    expect(typeof fresh.createdAt).toBe("number");
  });

  it("uploads audio only under 'audio', everything under 'all', nothing under 'off'", () => {
    const col = clipCol();
    expect([col.uploadPolicy(full, "off"), col.uploadPolicy(full, "audio"), col.uploadPolicy(full, "all")]).toEqual([false, true, true]);
    expect([col.uploadPolicy(sparse, "off"), col.uploadPolicy(sparse, "audio"), col.uploadPolicy(sparse, "all")]).toEqual([false, false, true]);
  });

  it("names the media file after the clip", () => {
    const col = clipCol();
    expect(col.fileName(full)).toBe("Riff.webm");
    expect(col.fileName({ ...sparse, name: 'a/b:c' })).toBe("a-b-c.mp4");
  });
});

describe("settings sync", () => {
  it("deviceLocal strips exactly the fields the old syncedSettings stripped", async () => {
    const dl = taalmelDriveConfig.settings!.deviceLocal as string[];
    expect([...dl].sort()).toEqual([...DEVICE_LOCAL_SETTINGS].sort());
    const s = { ...DEFAULT_SETTINGS, theme: "light", micEnabled: true, persistBannerDismissed: true, calibration: { latencyMs: 12 }, metronomeVolume: 0.3 } as unknown as Settings;
    const stripped = { ...s } as Record<string, unknown>;
    for (const k of dl) delete stripped[k];
    expect(stable(stripped)).toBe(stable(syncedSettings(s)));
    expect(await sha256(stable(stripped))).toBe(await sha256(stable(syncedSettings(s))));
    for (const k of DEVICE_LOCAL_SETTINGS) expect(k in stripped).toBe(false);
  });

  it("the adapter saves silently and normalises lanes (no teacher lane)", async () => {
    const adapter = taalmelDriveConfig.settings!;
    let echoed = 0;
    const off = adapter.onChange(() => echoed++);
    const s = await loadSettings();
    await adapter.save({ ...s, lanes: { tab: true, letter: false, teacher: true } });
    off();
    expect(echoed).toBe(0);
    expect((await loadSettings()).lanes).toEqual({ tab: true, letter: false });
    await saveSettings(s); // a user save is NOT silent
  });
});

describe("no echo after a pull", () => {
  it("a second syncNow after connect + pull makes no FakeDrive writes", async () => {
    // Seed Drive with a song, a clip (sidecar + media) and settings, written by "another device".
    const seeder = new FakeDrive({ namespace: "taalmel" });
    const seedStore = createMemorySyncStore();
    await saveSong(SONG, "seed-song", { silent: true });
    await saveClip({ id: "seed-clip", name: "Seed", createdAt: 5, mimeType: "audio/webm", hasVideo: false, durationSec: 2, blob: new Blob(["abcd"], { type: "audio/webm" }) }, { silent: true });
    const first = createDriveSync(taalmelDriveConfig, { api: seeder, auth: new FakeAuth(), store: seedStore });
    await first.connect();
    await first.syncNow();
    first.stop();

    // A fresh device: empty local storage, same Drive.
    await resetTaalmelDb();
    await _resetClipsDbForTests();
    await new Promise<void>((resolve) => {
      const req = indexedDB.deleteDatabase(CLIPS_DB_NAME);
      req.onsuccess = req.onerror = req.onblocked = () => resolve();
    });
    const second = createDriveSync(taalmelDriveConfig, { api: seeder, auth: new FakeAuth(), store: createMemorySyncStore() });
    await second.connect();
    await second.syncNow();
    expect((await getSong("seed-song"))?.title).toBe("Test Song"); // pulled through the real adapters
    expect((await getClip("seed-clip"))?.name).toBe("Seed");
    const writesBefore = seeder.writeCount;
    await second.syncNow();
    await new Promise((r) => setTimeout(r, 2500)); // longer than the 2 s flush debounce: an echo would push now
    await second.syncNow();
    second.stop();
    expect(seeder.writeCount).toBe(writesBefore);
  }, 15000);
});
