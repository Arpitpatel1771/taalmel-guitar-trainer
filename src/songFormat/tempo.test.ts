import { describe, expect, it } from "vitest";
import { parse, serialize } from "./index.js";
import { withSongBpm } from "./tempo.js";

const TEXT = `title: T
time: 4/4
bpm: 100
unit: 8

[A]
Bar 1: {1} 1S0

[B]
bpm: 150
Bar 2: {1} 1S0
`;

describe("withSongBpm", () => {
  it("sets the header bpm and the sections that follow it", () => {
    const r = parse(TEXT);
    if (!r.ok) throw new Error("parse");
    const song = withSongBpm(r.song, 128);
    expect(song.header.bpm).toBe(128);
    expect(song.sections[0].bpm).toBe(128);
    expect(serialize(song)).toContain("bpm: 128");
  });

  it("scales a section override by the same ratio, rounded", () => {
    const r = parse(TEXT);
    if (!r.ok) throw new Error("parse");
    const song = withSongBpm(r.song, 120);
    expect(song.header.bpm).toBe(120);
    expect(song.sections.map((s) => s.bpm)).toEqual([120, 180]);
    expect(serialize(song)).toContain("bpm: 180");
  });
});
