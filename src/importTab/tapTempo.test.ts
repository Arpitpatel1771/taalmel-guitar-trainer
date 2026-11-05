import { describe, expect, it } from "vitest";
import { tapTempo } from "./tapTempo.js";

describe("tapTempo", () => {
  it("finds bpm and first beat from clean taps", () => {
    const r = tapTempo(Array.from({ length: 8 }, (_, i) => 2 + i * 0.5))!;
    expect(r.bpm).toBeCloseTo(120, 5);
    expect(r.firstBeatSec).toBeCloseTo(2, 5);
  });

  it("copes with jitter", () => {
    const jitter = [0.012, -0.015, 0.02, -0.01, 0.008, -0.02, 0.015, -0.005, 0.01, -0.012];
    const r = tapTempo(jitter.map((j, i) => 1 + i * (60 / 94) + j))!;
    expect(r.bpm).toBeGreaterThan(93);
    expect(r.bpm).toBeLessThan(95);
    expect(Math.abs(r.firstBeatSec - 1)).toBeLessThan(0.03);
  });

  it("rejects a stray tap and tolerates a missed beat", () => {
    const taps = [0, 0.5, 1.0, 1.23, 1.5, 2.5, 3.0, 3.5];
    const r = tapTempo(taps)!;
    expect(r.bpm).toBeCloseTo(120, 0);
    expect(r.rejected).toBe(1);
  });

  it("needs two taps", () => {
    expect(tapTempo([1])).toBeNull();
    expect(tapTempo([])).toBeNull();
  });
});
