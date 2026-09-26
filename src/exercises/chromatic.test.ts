import { describe, expect, it } from "vitest";
import { parse } from "../songFormat/index.js";
import { chromatic, DEFAULT_CHROMATIC_PARAMS } from "./chromatic.js";

describe("chromatic", () => {
  it("matches the snapshot for fixed params", () => {
    const text = chromatic({
      startFret: 5,
      strings: [6, 5, 4, 3],
      pattern: "1324",
      grid: 16,
      bars: 2,
      direction: "both",
      bpm: 100,
    });
    expect(text).toMatchSnapshot();
  });

  it("exposes documented defaults", () => {
    expect(DEFAULT_CHROMATIC_PARAMS.pattern).toBe("1234");
    expect(DEFAULT_CHROMATIC_PARAMS.grid).toBe(4);
    expect(DEFAULT_CHROMATIC_PARAMS.bars).toBe(6);
    expect(parse(chromatic()).ok).toBe(true);
  });

  it("parses for a spread of parameters", () => {
    const patterns = ["1234", "1324", "1243", "4321"];
    const grids = [4, 8, 12, 16] as const;
    const directions = ["ascending", "descending", "both"] as const;
    const stringSets: readonly (readonly number[])[] = [
      [1, 2, 3, 4, 5, 6],
      [6, 5, 4, 3, 2, 1],
      [1, 3, 5],
    ];

    for (const pattern of patterns) {
      for (const grid of grids) {
        for (const direction of directions) {
          for (const startFret of [1, 12, 20]) {
            for (const strings of stringSets) {
              const text = chromatic({
                startFret,
                strings: [...strings] as (1 | 2 | 3 | 4 | 5 | 6)[],
                pattern,
                grid,
                bars: 3,
                direction,
                bpm: 120,
              });
              const result = parse(text);
              expect(
                result.ok,
                `failed for ${JSON.stringify({ pattern, grid, direction, startFret, strings })}: ${
                  result.ok ? "" : JSON.stringify(result.errors)
                }`,
              ).toBe(true);
            }
          }
        }
      }
    }
  });

  it("rejects an invalid pattern", () => {
    expect(() => chromatic({ pattern: "1123" })).toThrow();
    expect(() => chromatic({ pattern: "12" })).toThrow();
  });

  it("rejects an out-of-range start fret", () => {
    expect(() => chromatic({ startFret: 0 })).toThrow();
    expect(() => chromatic({ startFret: 21 })).toThrow();
  });
});
