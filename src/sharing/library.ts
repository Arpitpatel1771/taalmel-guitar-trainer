// Open library (spec 2): public/library/index.json types, parser and update check.

export type Difficulty = "beginner" | "intermediate" | "advanced";

export interface LibraryEntry {
  id: string;
  title: string;
  artist?: string;
  difficulty?: Difficulty;
  youtubeUrl?: string;
  credit?: string;
  file: string; // relative to /library/
  updatedAt: string; // ISO date; doubles as the entry's version
}

export interface LibraryIndex {
  version: number;
  songs: LibraryEntry[];
}

export const LIBRARY_BASE = "/library/";
export const LIBRARY_INDEX_URL = `${LIBRARY_BASE}index.json`;

const DIFFICULTIES: Difficulty[] = ["beginner", "intermediate", "advanced"];

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

/** Tolerant parser: skips malformed entries and duplicate ids; null if the document is unusable. */
export function parseLibraryIndex(data: unknown): LibraryIndex | null {
  if (typeof data !== "object" || data === null) return null;
  const d = data as { version?: unknown; songs?: unknown };
  if (typeof d.version !== "number" || !Array.isArray(d.songs)) return null;
  const seen = new Set<string>();
  const songs: LibraryEntry[] = [];
  for (const raw of d.songs as unknown[]) {
    if (typeof raw !== "object" || raw === null) continue;
    const r = raw as Record<string, unknown>;
    const id = str(r.id);
    const title = str(r.title);
    const file = str(r.file);
    const updatedAt = str(r.updatedAt);
    if (!id || !title || !file || !updatedAt || Number.isNaN(Date.parse(updatedAt)) || seen.has(id)) continue;
    if (file.includes("..") || file.startsWith("/") || file.includes("://")) continue;
    seen.add(id);
    const artist = str(r.artist);
    const youtubeUrl = str(r.youtubeUrl);
    const credit = str(r.credit);
    const difficulty = DIFFICULTIES.find((x) => x === r.difficulty);
    songs.push({
      id,
      title,
      file,
      updatedAt,
      ...(artist ? { artist } : {}),
      ...(difficulty ? { difficulty } : {}),
      ...(youtubeUrl ? { youtubeUrl } : {}),
      ...(credit ? { credit } : {}),
    });
  }
  return { version: d.version, songs };
}

export async function fetchLibraryIndex(fetchFn: typeof fetch = fetch): Promise<LibraryIndex> {
  const res = await fetchFn(LIBRARY_INDEX_URL);
  if (!res.ok) throw new Error(`Failed to load library index (${res.status})`);
  const index = parseLibraryIndex(await res.json());
  if (!index) throw new Error("Library index is malformed");
  return index;
}

export async function fetchLibrarySong(entry: LibraryEntry, fetchFn: typeof fetch = fetch): Promise<string> {
  const res = await fetchFn(LIBRARY_BASE + entry.file);
  if (!res.ok) throw new Error(`Failed to load ${entry.title} (${res.status})`);
  return res.text();
}

/** True when the local copy came from `entry` and the library has a newer version. */
export function libraryUpdateAvailable(
  local: { libraryId?: string; libraryVersion?: string },
  entry: Pick<LibraryEntry, "id" | "updatedAt">,
): boolean {
  if (!local.libraryId || local.libraryId !== entry.id) return false;
  const remote = Date.parse(entry.updatedAt);
  if (Number.isNaN(remote)) return false;
  if (!local.libraryVersion) return true;
  const have = Date.parse(local.libraryVersion);
  return Number.isNaN(have) || remote > have;
}
