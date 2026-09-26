// Library/song export and import (spec 11.5). Two file kinds round-trip
// through the same functions:
//   - a single song `.txt` file (canonical song text), and
//   - a whole-library `.json` file (`formatVersion`, all songs, settings).
//
// `parseImportFile` never writes to the database - it only reads (to compute
// which imported song ids already exist, so the caller can ask the user how
// to resolve each conflict) and returns a plan. `applyImport` performs the
// actual writes for a plan the caller has decided how to resolve.

import type { Settings, SongRecord } from "../model/index.js";
import { DEFAULT_SETTINGS } from "../model/index.js";
import { parse, serialize } from "../songFormat/index.js";
import { SONGS_STORE, openDb, txDone } from "./db.js";
import { loadSettings, saveSettings } from "./settings.js";
import { listSongs } from "./songs.js";

export const LIBRARY_FORMAT_VERSION = 1;

/** One song as stored in a library export file. */
export interface LibrarySongEntry {
  id: string;
  text: string;
  createdAt: string;
  updatedAt: string;
}

/** The shape written by `exportLibrary` and read by `parseImportFile` (spec 11.5). */
export interface LibraryExportFile {
  formatVersion: 1;
  exportedAt: string;
  songs: LibrarySongEntry[];
  settings: Settings;
}

export type ConflictDecision = "replace" | "keepBoth" | "skip";
/** Either a per-id callback, or a single decision applied to every conflict
 * (the "apply to all" checkbox in the import dialog, spec 11.5). */
export type OnConflict = ConflictDecision | ((id: string) => ConflictDecision);

export type ImportPlan =
  | { kind: "song"; text: string }
  | { kind: "library"; songs: LibrarySongEntry[]; settings?: Settings; conflicts: string[] }
  | { kind: "error"; message: string };

export interface ApplyImportOptions {
  onConflict: OnConflict;
  importSettings: boolean;
}

export interface ImportSummary {
  imported: number;
  replaced: number;
  keptBoth: number;
  skipped: number;
  settingsImported: boolean;
}

/** Slugifies a title for use as a filename stem: lowercase, ASCII
 * alphanumerics separated by single hyphens, "untitled" if that leaves
 * nothing. */
export function slugify(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug === "" ? "untitled" : slug;
}

function todayStamp(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Builds the whole-library export file (spec 11.5): filename
 * `taalmel-library-YYYY-MM-DD.json`, formatVersion 1, every stored song's
 * canonical text, and current settings. */
export async function exportLibrary(): Promise<{ filename: string; json: string }> {
  const [records, settings] = await Promise.all([listSongs(), loadSettings()]);
  const file: LibraryExportFile = {
    formatVersion: LIBRARY_FORMAT_VERSION,
    exportedAt: new Date().toISOString(),
    songs: records.map((r) => ({ id: r.id, text: r.text, createdAt: r.createdAt, updatedAt: r.updatedAt })),
    settings,
  };
  return { filename: `taalmel-library-${todayStamp(new Date())}.json`, json: JSON.stringify(file, null, 2) };
}

/** Builds a single-song export: `<slugified-title>.txt` containing the
 * record's canonical text (spec 11.5). */
export function exportSongFile(record: SongRecord): { filename: string; text: string } {
  return { filename: `${slugify(record.title)}.txt`, text: record.text };
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * Reads an import file's content (does not write anything) and classifies
 * it, per spec 11.5:
 *   - a `.txt` file must be a valid song (`parse` succeeds); its canonical
 *     text is returned as `{ kind: "song" }`.
 *   - a `.json` file must be a library export with `formatVersion: 1`; its
 *     songs (and, if present, settings) are returned as `{ kind: "library" }`,
 *     with `conflicts` listing which song ids already exist in the database.
 *   - anything else (wrong extension, malformed JSON/song, or a future
 *     `formatVersion`) is returned as `{ kind: "error", message }` - a future
 *     formatVersion is always rejected, never guessed at (spec 11.5, 13).
 */
export async function parseImportFile(filename: string, content: string): Promise<ImportPlan> {
  const lower = filename.toLowerCase();

  if (lower.endsWith(".txt")) {
    const result = parse(content);
    if (!result.ok) {
      const first = result.errors[0];
      const detail = first ? ` (line ${first.line}: ${first.message})` : "";
      return { kind: "error", message: `'${filename}' is not a valid song${detail}.` };
    }
    return { kind: "song", text: serialize(result.song) };
  }

  if (!lower.endsWith(".json")) {
    return { kind: "error", message: `Unrecognized file type for '${filename}'. Expected .txt or .json.` };
  }

  let data: unknown;
  try {
    data = JSON.parse(content);
  } catch {
    return { kind: "error", message: `'${filename}' is not valid JSON.` };
  }
  if (!isPlainObject(data)) {
    return { kind: "error", message: "Library file must contain a JSON object." };
  }

  const version = data.formatVersion;
  if (typeof version !== "number") {
    return { kind: "error", message: "Library file is missing 'formatVersion'." };
  }
  if (version > LIBRARY_FORMAT_VERSION) {
    return {
      kind: "error",
      message: `This library file was exported by a newer version of Taalmel (formatVersion ${version}). Update the app to import it.`,
    };
  }
  if (version !== LIBRARY_FORMAT_VERSION) {
    return { kind: "error", message: `Unsupported library formatVersion ${version}.` };
  }

  if (!Array.isArray(data.songs)) {
    return { kind: "error", message: "Library file is missing a 'songs' array." };
  }

  const songs: LibrarySongEntry[] = [];
  const now = new Date().toISOString();
  for (const entry of data.songs) {
    if (!isPlainObject(entry) || typeof entry.id !== "string" || typeof entry.text !== "string") {
      return { kind: "error", message: "Library file contains a malformed song entry." };
    }
    songs.push({
      id: entry.id,
      text: entry.text,
      createdAt: typeof entry.createdAt === "string" ? entry.createdAt : now,
      updatedAt: typeof entry.updatedAt === "string" ? entry.updatedAt : now,
    });
  }

  const settings = isPlainObject(data.settings) ? (data.settings as unknown as Settings) : undefined;

  const existingIds = new Set((await listSongs()).map((r) => r.id));
  const conflicts = songs.filter((s) => existingIds.has(s.id)).map((s) => s.id);

  return { kind: "library", songs, settings, conflicts };
}

function safeDenormalize(text: string): { title: string; bpm: number; hasVideo: boolean } {
  const result = parse(text);
  if (result.ok) {
    return {
      title: result.song.header.title,
      bpm: result.song.header.bpm,
      hasVideo: result.song.header.youtube !== undefined,
    };
  }
  // A song that fails to parse is still stored as-is (spec 11.4: "A song that
  // fails to parse ... opens in the editor with its errors instead of
  // breaking the library"), with best-effort denormalized fields.
  const m = /^title:\s*(.*)$/m.exec(text);
  return { title: m?.[1]?.trim() || "Untitled", bpm: 0, hasVideo: false };
}

async function putSongEntry(entry: LibrarySongEntry): Promise<void> {
  const { title, bpm, hasVideo } = safeDenormalize(entry.text);
  const record: SongRecord = {
    id: entry.id,
    text: entry.text,
    title,
    bpm,
    hasVideo,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
  const db = await openDb();
  const tx = db.transaction(SONGS_STORE, "readwrite");
  tx.objectStore(SONGS_STORE).put(record);
  await txDone(tx);
}

function mergeSettings(base: Settings): Settings {
  return {
    ...DEFAULT_SETTINGS,
    ...base,
    lanes: { ...DEFAULT_SETTINGS.lanes, ...(base.lanes ?? {}) },
    tiers: { ...DEFAULT_SETTINGS.tiers, ...(base.tiers ?? {}) },
  };
}

/**
 * Applies a plan returned by `parseImportFile`. Throws if `plan.kind ===
 * "error"` (nothing to apply). For a `"song"` plan, always creates one new
 * record with a fresh id. For a `"library"` plan, each song whose id is in
 * `plan.conflicts` is resolved via `opts.onConflict` (a fixed decision or a
 * per-id callback): `"replace"` overwrites the existing record with the
 * imported one, `"keepBoth"` inserts it under a new id, `"skip"` leaves the
 * existing record untouched. Non-conflicting songs are always inserted.
 * Settings are only imported when `opts.importSettings` is true and the plan
 * carries settings, merged over `DEFAULT_SETTINGS` the same way `loadSettings`
 * does.
 */
export async function applyImport(plan: ImportPlan, opts: ApplyImportOptions): Promise<ImportSummary> {
  if (plan.kind === "error") {
    throw new Error(plan.message);
  }

  const summary: ImportSummary = {
    imported: 0,
    replaced: 0,
    keptBoth: 0,
    skipped: 0,
    settingsImported: false,
  };

  if (plan.kind === "song") {
    const now = new Date().toISOString();
    await putSongEntry({ id: crypto.randomUUID(), text: plan.text, createdAt: now, updatedAt: now });
    summary.imported++;
    return summary;
  }

  const conflictIds = new Set(plan.conflicts);
  for (const entry of plan.songs) {
    if (conflictIds.has(entry.id)) {
      const decision = typeof opts.onConflict === "function" ? opts.onConflict(entry.id) : opts.onConflict;
      if (decision === "skip") {
        summary.skipped++;
      } else if (decision === "replace") {
        await putSongEntry(entry);
        summary.replaced++;
      } else {
        await putSongEntry({ ...entry, id: crypto.randomUUID() });
        summary.keptBoth++;
      }
    } else {
      await putSongEntry(entry);
      summary.imported++;
    }
  }

  if (opts.importSettings && plan.settings) {
    await saveSettings(mergeSettings(plan.settings));
    summary.settingsImported = true;
  }

  return summary;
}
