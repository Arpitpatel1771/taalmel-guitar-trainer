import { describe, expect, it } from "vitest";
import { parseTempo } from "./parseTempo";

describe("parseTempo", () => {
  it.each([
    ["Song title\n128 bpm\ne|---|", 128],
    ["Tempo: 96", 96],
    ["tempo 110", 110],
    ["BPM: 128", 128],
    ["bpm=72", 72],
    ["♩=120", 120],
    ["q = 88", 88],
    ["Tempo: 99.6", 100],
  ])("reads %j", (text, bpm) => {
    expect(parseTempo(text)).toBe(bpm);
  });

  it("returns null when there is no tempo or it is absurd", () => {
    expect(parseTempo("e|--0--2--|")).toBeNull();
    expect(parseTempo("Tempo: 5")).toBeNull();
    expect(parseTempo("Capo 2")).toBeNull();
  });
});
