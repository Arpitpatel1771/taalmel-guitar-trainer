import { describe, expect, it } from "vitest";
import { parse } from "../songFormat/index.js";
import { DEFAULT_RHYTHM_PARAMS, RHYTHM_PRESETS, rhythm } from "./rhythm.js";
import type { RhythmPattern } from "./rhythm.js";

describe("rhythm", () => {
  it("matches the snapshot for fixed params", () => {
    const text = rhythm({ string: 6, fret: 0, muted: true, pattern: "gallop", bars: 2, bpm: 120 });
    expect(text).toMatchSnapshot();
  });

  it("exposes RHYTHM_PRESETS and defaults", () => {
    expect(Object.keys(RHYTHM_PRESETS).sort()).toEqual(
      ["eighths", "gallop", "offbeatEighths", "quarters", "sixteenths", "triplets"].sort(),
    );
    expect(DEFAULT_RHYTHM_PARAMS.pattern).toBe("quarters");
    expect(DEFAULT_RHYTHM_PARAMS.muted).toBe(true);
  });

  it("parses for a spread of parameters, including a custom pattern", () => {
    const presetNames = Object.keys(RHYTHM_PRESETS) as (keyof typeof RHYTHM_PRESETS)[];
    const patterns: RhythmPattern[] = [
      ...presetNames,
      { grid: 8, slots: [1, 4, 6] },
    ];

    for (const pattern of patterns) {
      for (const string of [1, 3, 6] as const) {
        for (const fret of [0, 5, 24]) {
          for (const muted of [true, false]) {
            const text = rhythm({ string, fret, muted, pattern, bars: 4, bpm: 100 });
            const result = parse(text);
            expect(
              result.ok,
              `failed for ${JSON.stringify({ pattern, string, fret, muted })}: ${
                result.ok ? "" : JSON.stringify(result.errors)
              }`,
            ).toBe(true);
          }
        }
      }
    }
  });

  it("rejects an out-of-range fret or string", () => {
    expect(() => rhythm({ fret: 25 })).toThrow();
    expect(() => rhythm({ fret: -1 })).toThrow();
  });
});
