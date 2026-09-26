import { describe, expect, it } from "vitest";
import type { Note, StringNumber } from "../model/index.js";
import {
  TUNING_MIDI,
  isPicked,
  letterOf,
  letterOfNote,
  noteNameWithOctave,
  pitchOf,
  tabGlyph,
  teacherGlyph,
} from "./index.js";

function makeNote(partial: Partial<Note> & { string: StringNumber; fret: number }): Note {
  return {
    startTick: 0,
    durationTicks: 960,
    offsetMs: 0,
    uncertain: false,
    meta: {},
    source: { line: 1, column: 1 },
    ...partial,
  };
}

describe("pitchOf", () => {
  const strings: StringNumber[] = [1, 2, 3, 4, 5, 6];
  const frets = [0, 1, 5, 12, 24];

  for (const s of strings) {
    for (const f of frets) {
      it(`string ${s} fret ${f}`, () => {
        expect(pitchOf(s, f)).toBe(TUNING_MIDI[s] + f);
      });
    }
  }
});

describe("letterOf", () => {
  it("sharps spelling", () => {
    expect(letterOf(60, "sharps")).toBe("C");
    expect(letterOf(61, "sharps")).toBe("C#");
    expect(letterOf(64, "sharps")).toBe("E");
  });

  it("flats spelling", () => {
    expect(letterOf(61, "flats")).toBe("Db");
    expect(letterOf(63, "flats")).toBe("Eb");
  });

  it("wraps across octaves the same way", () => {
    expect(letterOf(60, "sharps")).toBe(letterOf(72, "sharps"));
  });
});

describe("noteNameWithOctave", () => {
  it("open strings", () => {
    expect(noteNameWithOctave(pitchOf(1, 0), "sharps")).toBe("E4");
    expect(noteNameWithOctave(pitchOf(2, 0), "sharps")).toBe("B3");
    expect(noteNameWithOctave(pitchOf(3, 0), "sharps")).toBe("G3");
    expect(noteNameWithOctave(pitchOf(4, 0), "sharps")).toBe("D3");
    expect(noteNameWithOctave(pitchOf(5, 0), "sharps")).toBe("A2");
    expect(noteNameWithOctave(pitchOf(6, 0), "sharps")).toBe("E2");
  });

  it("middle C is C4", () => {
    expect(noteNameWithOctave(60, "sharps")).toBe("C4");
  });
});

describe("isPicked", () => {
  it("true when no connection", () => {
    expect(isPicked(makeNote({ string: 1, fret: 0 }))).toBe(true);
  });

  it("false when connection present", () => {
    expect(
      isPicked(makeNote({ string: 1, fret: 5, meta: { connection: { kind: "hammer" } } })),
    ).toBe(false);
  });
});

describe("teacherGlyph", () => {
  it("register above for strings 1-2", () => {
    const g = teacherGlyph(makeNote({ string: 1, fret: 3 }));
    expect(g).toMatchObject({ kind: "teacher", register: "above" });
    const g2 = teacherGlyph(makeNote({ string: 2, fret: 3 }));
    expect(g2).toMatchObject({ kind: "teacher", register: "above" });
  });

  it("register none for strings 3-4", () => {
    const g = teacherGlyph(makeNote({ string: 3, fret: 3 }));
    expect(g).toMatchObject({ kind: "teacher", register: "none" });
    const g2 = teacherGlyph(makeNote({ string: 4, fret: 3 }));
    expect(g2).toMatchObject({ kind: "teacher", register: "none" });
  });

  it("register below for strings 5-6", () => {
    const g = teacherGlyph(makeNote({ string: 5, fret: 3 }));
    expect(g).toMatchObject({ kind: "teacher", register: "below" });
    const g2 = teacherGlyph(makeNote({ string: 6, fret: 3 }));
    expect(g2).toMatchObject({ kind: "teacher", register: "below" });
  });

  it("zone boundaries: fret 0 is zone 0", () => {
    expect(teacherGlyph(makeNote({ string: 1, fret: 0 }))).toMatchObject({ zone: 0 });
  });

  it("zone boundaries: frets 1 and 4 are zone 1", () => {
    expect(teacherGlyph(makeNote({ string: 1, fret: 1 }))).toMatchObject({ zone: 1 });
    expect(teacherGlyph(makeNote({ string: 1, fret: 4 }))).toMatchObject({ zone: 1 });
  });

  it("zone boundaries: frets 5 and 8 are zone 2", () => {
    expect(teacherGlyph(makeNote({ string: 1, fret: 5 }))).toMatchObject({ zone: 2 });
    expect(teacherGlyph(makeNote({ string: 1, fret: 8 }))).toMatchObject({ zone: 2 });
  });

  it("zone boundaries: frets 9 and 12 are zone 3", () => {
    expect(teacherGlyph(makeNote({ string: 1, fret: 9 }))).toMatchObject({ zone: 3 });
    expect(teacherGlyph(makeNote({ string: 1, fret: 12 }))).toMatchObject({ zone: 3 });
  });

  it("fret 13 and above falls back to tab form", () => {
    expect(teacherGlyph(makeNote({ string: 1, fret: 13 }))).toEqual({
      kind: "fallback",
      text: "1S13",
    });
    expect(teacherGlyph(makeNote({ string: 3, fret: 24 }))).toEqual({
      kind: "fallback",
      text: "3S24",
    });
  });

  it("letter is sharp by default, flat when meta.flat is set", () => {
    // 1S1 -> midi 65 -> F (natural, no sharp/flat ambiguity, sanity check)
    expect(teacherGlyph(makeNote({ string: 1, fret: 1 }))).toMatchObject({ letter: "F" });
    // 1S2 -> midi 66 -> F#/Gb; default is sharp, meta.flat picks the flat spelling
    expect(teacherGlyph(makeNote({ string: 1, fret: 2 }))).toMatchObject({ letter: "F#" });
    expect(teacherGlyph(makeNote({ string: 1, fret: 2, meta: { flat: true } }))).toMatchObject({
      letter: "Gb",
    });
  });
});

describe("letterOfNote", () => {
  it("defaults to sharp spelling", () => {
    expect(letterOfNote(makeNote({ string: 1, fret: 2 }))).toBe("F#");
  });

  it("uses flat spelling when meta.flat is set", () => {
    expect(letterOfNote(makeNote({ string: 1, fret: 2, meta: { flat: true } }))).toBe("Gb");
  });

  it("naturals are spelled the same regardless of meta.flat", () => {
    expect(letterOfNote(makeNote({ string: 1, fret: 0 }))).toBe("E");
    expect(letterOfNote(makeNote({ string: 1, fret: 0, meta: { flat: true } }))).toBe("E");
  });
});

describe("tabGlyph", () => {
  it("plain fretted note has no technique label", () => {
    expect(tabGlyph(makeNote({ string: 1, fret: 5 }), undefined)).toEqual({ text: "5" });
  });

  it("hammer-on gets label h", () => {
    const prev = makeNote({ string: 1, fret: 3 });
    const note = makeNote({ string: 1, fret: 5, meta: { connection: { kind: "hammer" } } });
    expect(tabGlyph(note, prev)).toEqual({ text: "5", techniqueLabel: "h" });
  });

  it("pull-off gets label p", () => {
    const prev = makeNote({ string: 1, fret: 5 });
    const note = makeNote({ string: 1, fret: 3, meta: { connection: { kind: "pull" } } });
    expect(tabGlyph(note, prev)).toEqual({ text: "3", techniqueLabel: "p" });
  });

  it("slide up gets label /", () => {
    const prev = makeNote({ string: 1, fret: 3 });
    const note = makeNote({ string: 1, fret: 5, meta: { connection: { kind: "slide" } } });
    expect(tabGlyph(note, prev)).toEqual({ text: "5", techniqueLabel: "/" });
  });

  it("slide down gets label backslash", () => {
    const prev = makeNote({ string: 1, fret: 5 });
    const note = makeNote({ string: 1, fret: 2, meta: { connection: { kind: "slide" } } });
    expect(tabGlyph(note, prev)).toEqual({ text: "2", techniqueLabel: "\\" });
  });

  it("bend gets label b<n>", () => {
    const prev = makeNote({ string: 2, fret: 7 });
    const note = makeNote({
      string: 2,
      fret: 7,
      meta: { connection: { kind: "bend", semitones: 2 } },
    });
    expect(tabGlyph(note, prev)).toEqual({ text: "7", techniqueLabel: "b2" });
  });

  it("bend release to 0 gets label r", () => {
    const prev = makeNote({ string: 2, fret: 7 });
    const note = makeNote({
      string: 2,
      fret: 7,
      meta: { connection: { kind: "bend", semitones: 0 } },
    });
    expect(tabGlyph(note, prev)).toEqual({ text: "7", techniqueLabel: "r" });
  });

  it("vibrato appends ~", () => {
    expect(tabGlyph(makeNote({ string: 1, fret: 5, meta: { vibrato: true } }), undefined)).toEqual(
      { text: "5~" },
    );
  });

  it("muted appends x", () => {
    expect(tabGlyph(makeNote({ string: 1, fret: 5, meta: { muted: true } }), undefined)).toEqual({
      text: "5x",
    });
  });

  it("slide_in prefixes ~/", () => {
    expect(
      tabGlyph(makeNote({ string: 1, fret: 5, meta: { slideIn: true } }), undefined),
    ).toEqual({ text: "~/5" });
  });

  it("slide_out suffixes \\~", () => {
    expect(
      tabGlyph(makeNote({ string: 1, fret: 5, meta: { slideOut: true } }), undefined),
    ).toEqual({ text: "5\\~" });
  });
});
