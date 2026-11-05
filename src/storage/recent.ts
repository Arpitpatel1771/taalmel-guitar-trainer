// Device-local "recent" records (specs/5-11-ui-redesign.md 4): where you left
// off in a song and the last chord-changes pair. Kept in localStorage (small,
// not synced), always wrapped in try/catch because storage can be blocked.

export interface RecentSong {
  songId: string;
  /** True when songId names a built-in sample rather than a library song. */
  sample?: boolean;
  title: string;
  sectionIndex: number;
  loop: { startBar: number; endBar: number } | null;
  /** Practice tempo in bpm. */
  practiceBpm?: number;
  /** Legacy records only: speed as a percentage of the song tempo. */
  speed?: number;
  lastTake?: { onTime: number; total: number };
  /** Epoch ms of the last update. */
  at: number;
}

export interface RecentChords {
  pair: [string, string];
  /** Best changes per minute for this pair. */
  best?: number;
  at: number;
}

export const RECENT_SONG_KEY = "taalmel.recent.song";
export const RECENT_CHORDS_KEY = "taalmel.recent.chords";

function readJson(key: string): unknown {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage blocked or full: recents are a convenience, ignore */
  }
}

const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

function validSong(v: unknown): v is RecentSong {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  const loop = r.loop as Record<string, unknown> | null | undefined;
  const take = r.lastTake as Record<string, unknown> | undefined;
  return (
    typeof r.songId === "string" &&
    typeof r.title === "string" &&
    isNum(r.sectionIndex) &&
    (r.speed === undefined || isNum(r.speed)) &&
    (r.practiceBpm === undefined || isNum(r.practiceBpm)) &&
    isNum(r.at) &&
    (loop === null || (typeof loop === "object" && isNum(loop.startBar) && isNum(loop.endBar))) &&
    (take === undefined || (typeof take === "object" && take !== null && isNum(take.onTime) && isNum(take.total)))
  );
}

function validChords(v: unknown): v is RecentChords {
  if (!v || typeof v !== "object") return false;
  const r = v as Record<string, unknown>;
  return (
    Array.isArray(r.pair) &&
    r.pair.length === 2 &&
    r.pair.every((p) => typeof p === "string") &&
    isNum(r.at) &&
    (r.best === undefined || isNum(r.best))
  );
}

/** The practice tempo of a record in bpm. Old records stored a percentage:
 * those are converted with the song tempo, or dropped (null) without it. */
export function recentPracticeBpm(r: Pick<RecentSong, "practiceBpm" | "speed">, songBpm?: number): number | null {
  if (r.practiceBpm !== undefined) return Math.round(r.practiceBpm);
  if (r.speed !== undefined && songBpm) return Math.round((songBpm * r.speed) / 100);
  return null;
}

export function loadRecentSong(): RecentSong | null {
  const v = readJson(RECENT_SONG_KEY);
  return validSong(v) ? v : null;
}

export function saveRecentSong(r: RecentSong): void {
  writeJson(RECENT_SONG_KEY, r);
}

/** Records the current practice state. The last take is kept only while the
 * same song stays the most recent one; a new song starts without one. */
export function updateRecentSong(next: Omit<RecentSong, "at" | "lastTake"> & { lastTake?: RecentSong["lastTake"] }, now = Date.now()): RecentSong {
  const prev = loadRecentSong();
  const lastTake = next.lastTake ?? (prev && prev.songId === next.songId && !!prev.sample === !!next.sample ? prev.lastTake : undefined);
  const record: RecentSong = { ...next, ...(lastTake ? { lastTake } : {}), at: now };
  saveRecentSong(record);
  return record;
}

export function loadRecentChords(): RecentChords | null {
  const v = readJson(RECENT_CHORDS_KEY);
  return validChords(v) ? v : null;
}

export function saveRecentChords(r: RecentChords): void {
  writeJson(RECENT_CHORDS_KEY, r);
}
