import { describe, expect, it } from "vitest";
import { factorBpmLabel, practiceBpmRange } from "./tempoLabels";

describe("tempo labels", () => {
  it("ranges from a quarter to double the song tempo", () => {
    expect(practiceBpmRange(128)).toEqual({ min: 32, max: 256 });
    expect(practiceBpmRange(40)).toEqual({ min: 20, max: 80 });
  });
  it("labels a factor as bpm", () => {
    expect(factorBpmLabel(128, 0.5)).toBe("64 bpm");
    expect(factorBpmLabel(100, 0.75)).toBe("75 bpm");
  });
});
