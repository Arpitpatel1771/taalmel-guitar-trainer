import { describe, expect, it } from "vitest";
import { parse } from "../songFormat/index.js";
import { CHORDS, STRUM_PATTERNS, strumming } from "./strumming.js";
import type { ChordName, StrumPatternName } from "./strumming.js";

describe("strumming", () => {
  it("matches the snapshot for fixed params", () => {
    expect(strumming({ chords: ["G", "C"], pattern: "folk", bars: 2, bpm: 90 })).toMatchSnapshot();
  });

  it("parses for every chord and pattern", () => {
    for (const chord of Object.keys(CHORDS) as ChordName[]) {
      for (const pattern of Object.keys(STRUM_PATTERNS) as StrumPatternName[]) {
        const result = parse(strumming({ chords: [chord], pattern, bars: 2, bpm: 80 }));
        expect(result.ok, `${chord} ${pattern}`).toBe(true);
      }
    }
  });

  it("marks each strum slot with its direction and cycles chords per bar", () => {
    const result = parse(strumming({ chords: ["E", "A"], pattern: "downUpEighths", bars: 2, bpm: 80 }));
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const strums = result.song.notes.filter((n) => n.meta.strum);
    expect(strums).toHaveLength(16);
    expect(strums.slice(0, 2).map((n) => n.meta.strum)).toEqual(["down", "up"]);
    // Bar 1 is E (has string 6), bar 2 is A (no string 6).
    const bar2 = result.song.sections[0].bars[1];
    expect(bar2.notes.some((n) => n.string === 6)).toBe(false);
    expect(result.song.sections[0].bars[0].notes.some((n) => n.string === 6)).toBe(true);
  });

  it("rejects non-4/4 time and empty chord lists", () => {
    expect(() => strumming({ time: { numerator: 3, denominator: 4 } })).toThrow();
    expect(() => strumming({ chords: [] })).toThrow();
  });
});
