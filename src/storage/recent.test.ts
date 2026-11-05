import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  RECENT_CHORDS_KEY,
  RECENT_SONG_KEY,
  loadRecentChords,
  loadRecentSong,
  saveRecentChords,
  saveRecentSong,
  updateRecentSong,
  type RecentSong,
} from "./recent";

function fakeStorage(): Storage {
  const m = new Map<string, string>();
  return {
    get length() {
      return m.size;
    },
    clear: () => m.clear(),
    getItem: (k) => m.get(k) ?? null,
    key: (i) => [...m.keys()][i] ?? null,
    removeItem: (k) => void m.delete(k),
    setItem: (k, v) => void m.set(k, String(v)),
  };
}

const song: RecentSong = { songId: "s1", title: "Ode", sectionIndex: 1, loop: { startBar: 1, endBar: 8 }, speed: 75, at: 1000 };

beforeEach(() => {
  vi.stubGlobal("localStorage", fakeStorage());
});
afterEach(() => vi.unstubAllGlobals());

describe("recent song", () => {
  it("is null when nothing was saved", () => {
    expect(loadRecentSong()).toBeNull();
  });
  it("round-trips", () => {
    saveRecentSong({ ...song, sample: true, lastTake: { onTime: 9, total: 12 } });
    expect(loadRecentSong()).toEqual({ ...song, sample: true, lastTake: { onTime: 9, total: 12 } });
  });
  it("ignores malformed or corrupt data", () => {
    localStorage.setItem(RECENT_SONG_KEY, "{not json");
    expect(loadRecentSong()).toBeNull();
    localStorage.setItem(RECENT_SONG_KEY, JSON.stringify({ songId: 3 }));
    expect(loadRecentSong()).toBeNull();
  });
  it("update stamps the time and keeps the take for the same song only", () => {
    saveRecentSong({ ...song, lastTake: { onTime: 3, total: 4 } });
    const same = updateRecentSong({ songId: "s1", title: "Ode", sectionIndex: 0, loop: null, speed: 50 }, 2000);
    expect(same).toMatchObject({ at: 2000, speed: 50, loop: null, lastTake: { onTime: 3, total: 4 } });
    const other = updateRecentSong({ songId: "s2", title: "Other", sectionIndex: 0, loop: null, speed: 100 }, 3000);
    expect(other.lastTake).toBeUndefined();
    const withTake = updateRecentSong({ songId: "s2", title: "Other", sectionIndex: 0, loop: null, speed: 100, lastTake: { onTime: 1, total: 5 } }, 4000);
    expect(withTake.lastTake).toEqual({ onTime: 1, total: 5 });
  });
  it("does not throw when storage is blocked", () => {
    vi.stubGlobal("localStorage", {
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(loadRecentSong()).toBeNull();
    expect(() => saveRecentSong(song)).not.toThrow();
  });
});

describe("recent chords", () => {
  it("round-trips and validates", () => {
    expect(loadRecentChords()).toBeNull();
    saveRecentChords({ pair: ["A", "D"], best: 24, at: 5 });
    expect(loadRecentChords()).toEqual({ pair: ["A", "D"], best: 24, at: 5 });
    localStorage.setItem(RECENT_CHORDS_KEY, JSON.stringify({ pair: ["A"], at: 1 }));
    expect(loadRecentChords()).toBeNull();
  });
});
