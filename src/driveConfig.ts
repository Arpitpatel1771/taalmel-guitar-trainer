// Taalmel's Google Drive sync, configured on top of @arpitpatel1771/drive-sync. The on-Drive format (folder ids, tags,
// sidecar JSON, hashes) is exactly what Taalmel wrote before the package, so existing users' data keeps working.

import {
  createDriveSync,
  documents,
  files,
  type ChangeEvent,
  type DriveSyncConfig,
  type DriveSyncDeps,
  type FileStore,
  type DocumentStore,
  type SettingsSync,
} from "@arpitpatel1771/drive-sync";
import { FakeAuth, FakeDrive, createMemorySyncStore } from "@arpitpatel1771/drive-sync/testing";
import type { Settings, SongRecord } from "./model/index";
import { computeClipPeaks } from "./recording";
import { deleteClip, getClip, listClips, saveClip, setClipBlob, type ClipRecord } from "./recording/clipStore";
import { parse, serialize } from "./songFormat/index";
import { onStorageChange } from "./storage/changes";
import { SONGS_STORE, openDb, txDone } from "./storage/db";
import { loadSettings, normalizeLanes, saveSettings } from "./storage/settings";
import { deleteSong, getSong, listSongs, saveSong } from "./storage/songs";

// ------------------------------------------------------------------------------------------ songs

function titleFromText(text: string): string | null {
  const m = /^title:[ \t]*(.*)$/m.exec(text);
  return m && m[1].trim() ? m[1].trim() : null;
}

/** The record for song text from Drive: canonical text when it parses, the raw text (the editor shows its errors) when not. */
function songFromText(text: string, id: string, existing?: SongRecord): SongRecord {
  const now = new Date().toISOString();
  const result = parse(text);
  if (result.ok) {
    const h = result.song.header;
    return {
      id,
      text: serialize(result.song),
      title: h.title,
      bpm: h.bpm,
      hasVideo: h.youtube !== undefined,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
  }
  const bpm = Number(/^bpm:[ \t]*(\d+)/m.exec(text)?.[1]);
  return {
    id,
    text,
    title: titleFromText(text) ?? "Untitled",
    bpm: Number.isFinite(bpm) && bpm > 0 ? bpm : 0,
    hasVideo: false,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
}

function filteredChanges(kind: "song" | "clip", cb: (change: ChangeEvent) => void): () => void {
  return onStorageChange((evt) => {
    if (evt.kind === kind) cb({ type: evt.op === "delete" ? "delete" : "save", id: evt.id });
  });
}

const songStore: DocumentStore<SongRecord> = {
  list: () => listSongs(),
  get: (id) => getSong(id),
  async save(id, item) {
    try {
      await saveSong(item.text, id, { silent: true });
    } catch (err) {
      // saveSong rejects text that fails to parse. A song from Drive must still be stored: write the raw record.
      try {
        const db = await openDb();
        const tx = db.transaction(SONGS_STORE, "readwrite");
        tx.objectStore(SONGS_STORE).put({ ...item, id, createdAt: (await getSong(id))?.createdAt ?? item.createdAt });
        await txDone(tx);
      } catch {
        throw err;
      }
    }
  },
  remove: (id) => deleteSong(id, { silent: true }),
  onChange: (cb) => filteredChanges("song", cb),
};

// ------------------------------------------------------------------------------------------ clips

const clipStore: FileStore<ClipRecord> = {
  list: () => listClips(),
  get: getClip,
  async save(_id, item) {
    await saveClip(item, { silent: true });
  },
  remove: (id) => deleteClip(id, { silent: true }),
  async getBlob(id) {
    return (await getClip(id))?.blob ?? null;
  },
  async setBlob(id, blob) {
    await setClipBlob(id, blob, { silent: true });
  },
  onChange: (cb) => filteredChanges("clip", cb),
};

/** The metadata JSON of a clip: exactly what Taalmel has always hashed and written to the Drive sidecar. */
function clipMeta(c: ClipRecord): Record<string, unknown> {
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

function clipFromMeta(j: Record<string, unknown>, id: string, existing?: ClipRecord): ClipRecord {
  return {
    id,
    name: String(j.name ?? "Recording"),
    createdAt: Number(j.createdAt ?? Date.now()),
    mimeType: String(j.mimeType ?? ""),
    hasVideo: Boolean(j.hasVideo),
    durationSec: Number(j.durationSec ?? 0),
    // Keep the real size while the media is on this device.
    size: existing?.blob ? existing.size : Number(j.size ?? 0),
    blob: existing?.blob ?? null,
    driveFileId: existing?.driveFileId,
    flags: (j.flags as ClipRecord["flags"]) ?? [],
    peaks: (j.peaks as number[] | undefined) ?? [],
    gainDb: typeof j.gainDb === "number" ? j.gainDb : undefined,
    boost: typeof j.boost === "boolean" ? j.boost : undefined,
    mediaRev: typeof j.mediaRev === "number" ? j.mediaRev : undefined,
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

/** Duration (hidden media element) and waveform peaks for media imported from Drive. */
export async function probeMedia(blob: Blob): Promise<{ durationSec: number; peaks?: number[] }> {
  const hasVideo = blob.type.startsWith("video/");
  const durationSec = await new Promise<number>((resolve) => {
    const el = document.createElement(hasVideo ? "video" : "audio");
    const url = URL.createObjectURL(blob);
    const done = (d: number) => {
      URL.revokeObjectURL(url);
      resolve(Number.isFinite(d) && d > 0 ? d : 0);
    };
    el.preload = "metadata";
    el.onerror = () => done(0);
    el.onloadedmetadata = () => {
      if (Number.isFinite(el.duration)) return done(el.duration);
      // WebM from MediaRecorder reports Infinity until seeked to the end.
      el.ontimeupdate = () => done(el.duration);
      el.currentTime = 1e101;
    };
    el.src = url;
  });
  let peaks: number[] | undefined;
  try {
    peaks = await computeClipPeaks(blob, blob.type, hasVideo);
  } catch {
    // Peaks are optional; the trimmer computes them later.
  }
  return { durationSec, peaks };
}

// -------------------------------------------------------------------------------------- settings

const settingsSync: SettingsSync<Settings> = {
  load: () => loadSettings(),
  save: (s) => saveSettings({ ...s, lanes: normalizeLanes(s.lanes) }, { silent: true }),
  onChange: (cb) =>
    onStorageChange((evt) => {
      if (evt.kind === "settings") cb();
    }),
  deviceLocal: ["calibration", "micEnabled", "persistBannerDismissed", "theme"],
};

// ----------------------------------------------------------------------------------------- config

export const taalmelDriveConfig: DriveSyncConfig = {
  google: {
    clientId: import.meta.env.VITE_GOOGLE_CLIENT_ID ?? "",
    apiKey: import.meta.env.VITE_GOOGLE_API_KEY ?? "",
    appId: import.meta.env.VITE_GOOGLE_APP_ID ?? "",
  },
  appName: "Taalmel",
  namespace: "taalmel",
  hiddenFolder: ".taalmel",
  devFake: import.meta.env.DEV,
  collections: [
    documents<SongRecord>({
      kind: "song",
      label: { one: "song", other: "songs" },
      folder: { id: "songs", name: "Songs" },
      extension: ".txt",
      mimeType: "text/plain",
      store: songStore,
      idOf: (s) => s.id,
      toFile: (s) => s.text,
      fromFile: songFromText,
      fileName: (s) => s.title,
      titleOf: (s) => s.title,
      updatedAt: (s) => Date.parse(s.updatedAt) || 0,
      conflicts: "ask",
      remoteDelete: "ask",
      onKeepBoth(remote) {
        const header = `title: ${remote.title} (Drive)`;
        const text = /^title:.*$/m.test(remote.text) ? remote.text.replace(/^title:.*$/m, header) : `${header}\n${remote.text}`;
        return songFromText(text, remote.id);
      },
      adopt: { extensions: [".txt"] },
    }),
    files<ClipRecord>({
      kind: "clip",
      label: { one: "recording", other: "recordings" },
      folder: { id: "recordings", name: "Recordings" },
      metaFolder: { id: "clips", name: "clips" },
      store: clipStore,
      idOf: (c) => c.id,
      meta: clipMeta,
      fromMeta: clipFromMeta,
      fileName: mediaName,
      mimeType: (c) => c.mimeType,
      titleOf: (c) => c.name,
      uploadSettings: [
        { value: "off", label: "Off" },
        { value: "audio", label: "Audio only" },
        { value: "all", label: "Everything" },
      ],
      defaultUploadSetting: "audio",
      uploadPolicy: (c, setting) => setting === "all" || (setting === "audio" && !c.hasVideo),
      legacyMediaFileId: (c) => c.driveFileId,
      importMedia: {
        mimeTypes: ["audio/*", "video/*"],
        async create(blob, name, id) {
          let probe: { durationSec: number; peaks?: number[] } = { durationSec: 0 };
          try {
            probe = await probeMedia(blob);
          } catch {
            // Keep going with unknown duration: the clip is still usable.
          }
          return {
            id,
            name,
            createdAt: Date.now(),
            mimeType: blob.type,
            hasVideo: blob.type.startsWith("video/"),
            durationSec: probe.durationSec,
            size: blob.size,
            blob,
            flags: [],
            peaks: probe.peaks ?? [],
          };
        },
      },
    }),
  ],
  settings: settingsSync as SettingsSync,
};

declare global {
  interface Window {
    /** Dev-only: the FakeDrive instance when localStorage "taalmel.fakeDrive" is "1". */
    __taalmelFakeDrive?: unknown;
  }
}

/** Dev only: with localStorage "taalmel.fakeDrive" = "1", hand the engine a FakeDrive we can reach from the console. */
function devDeps(): DriveSyncDeps | undefined {
  // The literal DEV check must sit right here so production builds drop the fake entirely.
  if (!import.meta.env.DEV || typeof window === "undefined") return undefined;
  try {
    if (localStorage.getItem("taalmel.fakeDrive") !== "1") return undefined;
  } catch {
    return undefined;
  }
  const api = new FakeDrive({ namespace: "taalmel" });
  window.__taalmelFakeDrive = api;
  return { api, auth: new FakeAuth(), store: createMemorySyncStore() };
}

export const taalmelDrive = createDriveSync(taalmelDriveConfig, devDeps());
