import { describe, expect, it } from "vitest";
import type { ExpectedEvent, Note, Verdict } from "../model";
import { playedNoteLabel, verdictLook } from "./verdictDisplay";

function note(string: 1 | 2 | 3 | 4 | 5 | 6, fret: number, flat = false): Note {
  return { string, fret, startTick: 0, durationTicks: 960, meta: flat ? { flat: true } : {} } as unknown as Note;
}
function expected(notes: Note[]): ExpectedEvent {
  return { tick: 0, timeSec: 0, notes, capo: 0 };
}
const matched = (over: Partial<Verdict>): Verdict => ({ kind: "matched", expected: expected([note(1, 0)]), tier: "onTime", errorMs: 5, ...over });

describe("verdictLook", () => {
  it("on time: blue, no tick", () => {
    expect(verdictLook(matched({}))).toEqual({ timing: "ontime", tick: null, underline: false, playedLabel: null });
  });
  it("close: still on-time colour, tick by sign", () => {
    expect(verdictLook(matched({ tier: "close", errorMs: -60 }))).toMatchObject({ timing: "ontime", tick: "early", underline: false });
    expect(verdictLook(matched({ tier: "close", errorMs: 60 }))).toMatchObject({ timing: "ontime", tick: "late" });
  });
  it("off: pink, tick and underline", () => {
    expect(verdictLook(matched({ tier: "off", errorMs: 140 }))).toMatchObject({ timing: "off", tick: "late", underline: true });
  });
  it("missed is faded with no mark", () => {
    expect(verdictLook({ kind: "missed", expected: expected([note(1, 0)]) })).toEqual({
      timing: "missed",
      tick: null,
      underline: false,
      playedLabel: null,
    });
  });
  it("wrong pitch shows the played letter on a single note", () => {
    // string 1 open = E4 (64); F4 = 65.
    expect(verdictLook(matched({ pitch: "wrong", playedMidi: 65 }))?.playedLabel).toBe("F");
  });
  it("octave-only error shows the octave", () => {
    expect(verdictLook(matched({ pitch: "wrong", playedMidi: 52 }))?.playedLabel).toBe("E3");
  });
  it("no label for right/unknown/skipped pitch, chords, or extras", () => {
    expect(verdictLook(matched({ pitch: "right" }))?.playedLabel).toBeNull();
    expect(verdictLook(matched({ pitch: "unknown" }))?.playedLabel).toBeNull();
    expect(verdictLook(matched({ pitch: "wrong", playedMidi: 65, expected: expected([note(1, 0), note(2, 0)]) }))?.playedLabel).toBeNull();
    expect(verdictLook({ kind: "extra", onsetSec: 1 })).toBeNull();
  });
});

describe("playedNoteLabel", () => {
  it("respects flat spelling", () => {
    expect(playedNoteLabel(70, 64, true)).toBe("Bb");
    expect(playedNoteLabel(70, 64, false)).toBe("A#");
  });
});
