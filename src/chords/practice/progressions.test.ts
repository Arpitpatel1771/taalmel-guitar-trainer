import { describe, expect, it } from "vitest";
import { chordDisplayName } from "../index";
import { STRUM_PATTERNS } from "../../exercises/strumming";
import {
  PROGRESSION_PRESETS,
  buildTimeline,
  parseCustomProgression,
  resolveNumerals,
  type ProgChord,
} from "./progressions";

const names = (cs: ProgChord[]) => cs.map((c) => ("slash" in c ? c.slash : chordDisplayName(c.rootPc, c.typeId, c.spelling)));
const preset = (id: string) => PROGRESSION_PRESETS.find((p) => p.id === id)!;

describe("resolveNumerals", () => {
  it("I-V-vi-IV in G and Bb", () => {
    const t = preset("I-V-vi-IV").tokens;
    expect(names(resolveNumerals(t, { rootPc: 7, spelling: "sharp" }, "major").chords)).toEqual(["G", "D", "Em", "C"]);
    expect(names(resolveNumerals(t, { rootPc: 10, spelling: "flat" }, "major").chords)).toEqual(["Bb", "F", "Gm", "Eb"]);
  });
  it("Andalusian in A minor", () => {
    const r = resolveNumerals(preset("andalusian").tokens, { rootPc: 9, spelling: "sharp" }, "minor");
    expect(names(r.chords)).toEqual(["Am", "G", "F", "E"]);
  });
  it("bVII and bVI in a major key", () => {
    expect(names(resolveNumerals(["I", "bVII", "bVI"], { rootPc: 0, spelling: "sharp" }, "major").chords)).toEqual(["C", "Bb", "Ab"]);
  });
  it("12-bar blues uses 7 chords", () => {
    const r = resolveNumerals(preset("blues").tokens, { rootPc: 9, spelling: "sharp" }, "major");
    expect(r.chords).toHaveLength(12);
    expect(names(r.chords).slice(0, 5)).toEqual(["A7", "A7", "A7", "A7", "D7"]);
    expect(names(r.chords)[8]).toBe("E7");
  });
  it("reports bad tokens", () => {
    expect(resolveNumerals(["I", "IX"], { rootPc: 0, spelling: "sharp" }, "major").errors).toEqual(["IX"]);
  });
});

describe("parseCustomProgression", () => {
  it("parses names and reports bad tokens", () => {
    const r = parseCustomProgression("G C, D Em  Xy");
    expect(names(r.chords)).toEqual(["G", "C", "D", "Em"]);
    expect(r.errors).toEqual(["Xy"]);
  });
});

describe("buildTimeline", () => {
  it("one bar per chord with pattern offsets in beats", () => {
    const bars = buildTimeline(2, 1, STRUM_PATTERNS.folk);
    expect(bars.map((b) => b.chordIndex)).toEqual([0, 1]);
    expect(bars[0].strums.map((s) => s.beat)).toEqual([0, 1, 1.5, 2.5, 3, 3.5]);
    expect(bars[0].strums.map((s) => s.direction)).toEqual(["down", "down", "up", "up", "down", "up"]);
  });
  it("two bars per chord repeats the chord", () => {
    expect(buildTimeline(2, 2, STRUM_PATTERNS.downQuarters).map((b) => b.chordIndex)).toEqual([0, 0, 1, 1]);
  });
});
