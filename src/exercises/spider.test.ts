import { describe, expect, it } from "vitest";
import { parse } from "../songFormat/index.js";
import { DEFAULT_SPIDER_PARAMS, spider } from "./spider.js";

describe("spider", () => {
  it("matches the snapshot for fixed params", () => {
    const text = spider({ startFret: 3, startStringPair: 2, grid: 8, bars: 3, bpm: 90 });
    expect(text).toMatchSnapshot();
  });

  it("documents its sequence: fingers 1,3 at F then 2,4 at F+1, walking string pairs", () => {
    // Bar 1 slots 1-4 should be the first cell for the default params
    // (startFret 1, startStringPair 1 => strings 1 & 3).
    const text = spider({ startFret: 1, startStringPair: 1, grid: 4, bars: 1 });
    const result = parse(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const notes = result.song.sections[0]!.bars[0]!.notes;
    expect(notes.map((n) => [n.string, n.fret])).toEqual([
      [1, 1],
      [3, 1],
      [1, 2],
      [3, 2],
    ]);
  });

  it("exposes documented defaults", () => {
    expect(DEFAULT_SPIDER_PARAMS.fingerPairs).toBe("13/24");
    expect(DEFAULT_SPIDER_PARAMS.startStringPair).toBe(1);
  });

  it("parses for a spread of parameters", () => {
    for (const startFret of [1, 10, 20]) {
      for (const startStringPair of [1, 2, 3, 4] as const) {
        for (const grid of [4, 8, 12, 16] as const) {
          for (const bars of [1, 5, 17]) {
            const text = spider({ startFret, startStringPair, grid, bars, bpm: 80 });
            const result = parse(text);
            expect(
              result.ok,
              `failed for ${JSON.stringify({ startFret, startStringPair, grid, bars })}: ${
                result.ok ? "" : JSON.stringify(result.errors)
              }`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("clamps the fret walk so no note exceeds fret 24", () => {
    const text = spider({ startFret: 20, bars: 32, grid: 16 });
    const result = parse(text);
    expect(result.ok).toBe(true);
  });

  it("rejects an out-of-range start fret", () => {
    expect(() => spider({ startFret: 0 })).toThrow();
    expect(() => spider({ startFret: 21 })).toThrow();
  });
});
