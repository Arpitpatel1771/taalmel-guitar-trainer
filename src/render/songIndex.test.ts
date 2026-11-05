import { describe, expect, it } from "vitest";
import { parse } from "../songFormat";
import { buildSongIndex, upcomingCapoChange } from "./songIndex";

const HEAD = "title: T\ntime: 4/4\nbpm: 100\nunit: 8\n";
function song(text: string) {
  const r = parse(text);
  if (!r.ok) throw new Error(JSON.stringify(r.errors));
  return r.song;
}
const BAR = 3840;
const WITH_CAPO = `${HEAD}capo: 2\n\n[A]\nBar 1: {1} 1S0\nBar 2: {1} 1S0\n\n[B]\ncapo: 0\nBar 3: {1} 1S0\nBar 4: {1} 1S0\n\n[C]\nBar 5: {1} 1S0\n`;

describe("capoBadgeForBar", () => {
  it("badges the first bar and each section whose capo changes", () => {
    const idx = buildSongIndex(song(WITH_CAPO));
    expect([...idx.capoBadgeForBar]).toEqual([
      [1, 2],
      [3, 0],
      [5, 2],
    ]);
  });

  it("has no badges for a song that never uses a capo", () => {
    expect(buildSongIndex(song(`${HEAD}\n[A]\nBar 1: {1} 1S0\n`)).capoBadgeForBar.size).toBe(0);
  });
});

describe("upcomingCapoChange", () => {
  const s = song(WITH_CAPO);
  it("warns in the bar before a change, not earlier", () => {
    expect(upcomingCapoChange(s, 0)).toBeNull();
    expect(upcomingCapoChange(s, BAR + 10)).toBe(0); // bar 2 -> bar 3
    expect(upcomingCapoChange(s, 2 * BAR + 10)).toBeNull();
    expect(upcomingCapoChange(s, 3 * BAR + 10)).toBe(2); // bar 4 -> bar 5
  });

  it("looks at the loop start when the loop wraps", () => {
    const loop = { startTick: 0, endTick: 4 * BAR }; // bars 1-4: capo 2 .. 0
    expect(upcomingCapoChange(s, 3 * BAR + 10, loop)).toBe(2);
    expect(upcomingCapoChange(s, 3 * BAR + 10, { startTick: 2 * BAR, endTick: 4 * BAR })).toBeNull();
  });

  it("is null during the count-in", () => {
    expect(upcomingCapoChange(s, -100)).toBeNull();
  });
});
