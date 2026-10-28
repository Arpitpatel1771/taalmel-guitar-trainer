import { describe, expect, it } from "vitest";
import { chordSchedule, strumSchedule } from "./chordPlayer";

describe("chordSchedule", () => {
  const c = [null, 3, 2, 0, 1, 0]; // C major
  it("skips muted strings and orders low to high", () => {
    const s = chordSchedule(c, "strum");
    expect(s.map((n) => n.string)).toEqual([5, 4, 3, 2, 1]);
    expect(s.map((n) => n.midi)).toEqual([48, 52, 55, 60, 64]);
  });
  it("spaces strum 15ms and arpeggio 250ms", () => {
    expect(chordSchedule(c, "strum").map((n) => n.offsetSec)[2]).toBeCloseTo(0.03);
    expect(chordSchedule(c, "arpeggio").map((n) => n.offsetSec)[4]).toBeCloseTo(1);
  });
  it("handles all open and all muted", () => {
    expect(chordSchedule([0, 0, 0, 0, 0, 0], "strum")[0]).toEqual({ string: 6, midi: 40, offsetSec: 0 });
    expect(chordSchedule([null, null, null, null, null, null], "strum")).toEqual([]);
  });
});

describe("strumSchedule", () => {
  const c = [null, 3, 2, 0, 1, 0];
  it("down goes low to high with 12ms spacing", () => {
    const s = strumSchedule(c, "down");
    expect(s.map((n) => n.string)).toEqual([5, 4, 3, 2, 1]);
    expect(s[3].offsetSec).toBeCloseTo(0.036);
  });
  it("up goes high to low", () => {
    const s = strumSchedule(c, "up");
    expect(s.map((n) => n.string)).toEqual([1, 2, 3, 4, 5]);
    expect(s[0].offsetSec).toBe(0);
    expect(s[4].offsetSec).toBeCloseTo(0.048);
  });
});
