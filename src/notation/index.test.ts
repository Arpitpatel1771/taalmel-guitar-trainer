import { describe, expect, it } from "vitest";
import type { Note, StringNumber } from "../model/index.js";
import {
  isPicked,
  letterOf,
  letterOfNote,
  noteNameWithOctave,
  soundingMidi,
  tabGlyph,
} from "./index.js";

function makeNote(partial: Partial<Note> & { string: StringNumber; fret: number }): Note {
  return {
    startTick: 0,
    durationTicks: 960,
    offsetMs: 0,
    meta: {},
    source: { line: 1, column: 1 },
    ...partial,
  };
}

describe("soundingMidi", () => {
  const open: Record<StringNumber, number> = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };
  const strings: StringNumber[] = [1, 2, 3, 4, 5, 6];
  const frets = [0, 1, 5, 12, 24];

  for (const capo of [0, 3]) {
    for (const s of strings) {
      for (const f of frets) {
        it(`string ${s} fret ${f} capo ${capo}`, () => {
          expect(soundingMidi(s, f, capo)).toBe(open[s] + capo + f);
        });
      }
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
    expect(noteNameWithOctave(soundingMidi(1, 0, 0), "sharps")).toBe("E4");
    expect(noteNameWithOctave(soundingMidi(2, 0, 0), "sharps")).toBe("B3");
    expect(noteNameWithOctave(soundingMidi(3, 0, 0), "sharps")).toBe("G3");
    expect(noteNameWithOctave(soundingMidi(4, 0, 0), "sharps")).toBe("D3");
    expect(noteNameWithOctave(soundingMidi(5, 0, 0), "sharps")).toBe("A2");
    expect(noteNameWithOctave(soundingMidi(6, 0, 0), "sharps")).toBe("E2");
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

describe("letterOfNote", () => {
  it("shows the sounding note with octave, sharps by default", () => {
    expect(letterOfNote(makeNote({ string: 1, fret: 0 }), 0)).toBe("E4");
    expect(letterOfNote(makeNote({ string: 1, fret: 9 }), 0)).toBe("C#5");
  });

  it("uses flat spelling when meta.flat is set", () => {
    expect(letterOfNote(makeNote({ string: 1, fret: 9, meta: { flat: true } }), 0)).toBe("Db5");
  });

  it("naturals are spelled the same regardless of meta.flat", () => {
    expect(letterOfNote(makeNote({ string: 1, fret: 0, meta: { flat: true } }), 0)).toBe("E4");
  });

  it("sounds the capo: open high E under capo 2 is F#4", () => {
    expect(letterOfNote(makeNote({ string: 1, fret: 0 }), 2)).toBe("F#4");
    expect(letterOfNote(makeNote({ string: 1, fret: 0, meta: { flat: true } }), 2)).toBe("Gb4");
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
