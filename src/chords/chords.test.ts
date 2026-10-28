import { describe, expect, it } from "vitest";
import {
  CHORD_TYPES,
  ROOTS,
  checkVoicing,
  chordDisplayName,
  chordKey,
  chordNotes,
  listVoicings,
  openChordList,
  parseChordName,
  slashChordsFor,
} from "./index.js";
import type { ChordTypeId, Spelling } from "./index.js";
import { SLASH_CHORDS } from "./shapes.js";

const spellings = (pc: number): Spelling[] => (ROOTS[pc].flat ? ["sharp", "flat"] : ["sharp"]);

describe("voicings", () => {
  it("pass the checker for every root and type", () => {
    for (const type of CHORD_TYPES) {
      for (let pc = 0; pc < 12; pc++) {
        for (const v of listVoicings(pc, type.id)) {
          const r = checkVoicing(v, pc, type.id);
          expect(r.errors, `${v.id} ${v.frets.join(",")}`).toEqual([]);
        }
      }
    }
  });

  it("have unique ids per chord", () => {
    for (const type of CHORD_TYPES) {
      for (let pc = 0; pc < 12; pc++) {
        const ids = listVoicings(pc, type.id).map((v) => v.id);
        expect(new Set(ids).size, `${pc}:${type.id}`).toBe(ids.length);
      }
    }
  });

  it("give every type at least 2 voicings for every root", () => {
    for (const type of CHORD_TYPES) {
      for (let pc = 0; pc < 12; pc++) {
        expect(listVoicings(pc, type.id).length, `${ROOTS[pc].sharp}${type.suffix}`).toBeGreaterThanOrEqual(2);
      }
    }
  });

  it("stay within frets 0-15 and list open shapes first, then by baseFret", () => {
    for (const type of CHORD_TYPES) {
      for (let pc = 0; pc < 12; pc++) {
        const list = listVoicings(pc, type.id);
        for (const v of list) for (const f of v.frets) if (f !== null) expect(f).toBeLessThanOrEqual(15);
        const opens = list.filter((v) => v.source === "open").length;
        expect(list.slice(0, opens).every((v) => v.source === "open")).toBe(true);
        const rest = list.slice(opens).map((v) => v.baseFret);
        expect(rest).toEqual([...rest].sort((a, b) => a - b));
      }
    }
  });

  it("pass the checker for every open and slash chord", () => {
    for (const o of openChordList()) {
      expect(checkVoicing(o.voicing, o.rootPc, o.typeId).errors, o.voicing.id).toEqual([]);
    }
    for (const s of SLASH_CHORDS) {
      expect(checkVoicing(s.voicing, s.rootPc, s.typeId, { bassPc: s.bassPc }).errors, s.name).toEqual([]);
    }
  });

  it("include the named open chords", () => {
    const have = new Set(openChordList().map((o) => o.label));
    const wanted = [
      "C", "A", "G", "E", "D", "Am", "Em", "Dm", "A7", "B7", "C7", "D7", "E7", "G7", "Am7", "Dm7", "Em7",
      "Cmaj7", "Dmaj7", "Fmaj7", "Gmaj7", "Amaj7", "Dsus2", "Dsus4", "Asus2", "Asus4", "Esus4", "Cadd9",
      "Gadd9", "Gadd9-b", "A6", "D6", "E5", "A5", "D5", "Em6", "Am6", "E9",
    ];
    for (const w of wanted) expect(have.has(w), w).toBe(true);
  });

  it("list the spec's slash chords under their root", () => {
    expect(slashChordsFor(2).map((s) => s.name).sort()).toEqual(["D/A", "D/F#"]);
    expect(SLASH_CHORDS.map((s) => s.name).sort()).toEqual(
      ["A/C#", "Am/G", "C/E", "C/G", "D/A", "D/F#", "E/G#", "F/C", "G/B", "G/F#"].sort(),
    );
    expect(slashChordsFor(1)).toEqual([]);
  });
});

describe("exact shapes", () => {
  const fretsOf = (pc: number, type: ChordTypeId) => listVoicings(pc, type).map((v) => v.frets.map((f) => (f === null ? "x" : f)).join(""));

  it("C is x32010", () => {
    expect(listVoicings(0, "maj")[0].id).toBe("C:maj:open-C");
    expect(fretsOf(0, "maj")[0]).toBe("x32010");
  });

  it("F is 133211 with a barre (E shape, fret 1)", () => {
    const v = listVoicings(5, "maj").find((x) => x.id === "F:maj:E-1");
    expect(v?.frets).toEqual([1, 3, 3, 2, 1, 1]);
    expect(v?.barre).toEqual({ fret: 1, fromString: 6, toString: 1, finger: 1 });
    expect(v?.baseFret).toBe(1);
  });

  it("Bm (A shape) is x24432", () => {
    expect(listVoicings(11, "m").find((x) => x.source === "A")?.frets).toEqual([null, 2, 4, 4, 3, 2]);
  });

  it("D/F# is 200232", () => {
    expect(slashChordsFor(2).find((s) => s.name === "D/F#")?.voicing.frets).toEqual([2, 0, 0, 2, 3, 2]);
  });

  it("G is 320003 or 320033", () => {
    const g = fretsOf(7, "maj");
    expect(g.includes("320003") || g.includes("320033")).toBe(true);
  });

  it("starts the window at the lowest fret for movable shapes without open strings", () => {
    expect(listVoicings(0, "maj").find((x) => x.frets.join() === [null, 3, 5, 5, 5, 3].join())?.baseFret).toBe(3);
    expect(listVoicings(6, "m7").find((x) => x.source === "E")?.baseFret).toBe(2);
    expect(listVoicings(2, "sus4").find((x) => x.source === "open")?.baseFret).toBe(1);
  });

  it("uses the 5fr style window for high shapes", () => {
    const v = listVoicings(0, "maj").find((x) => x.id === "C:maj:E-8");
    expect(v?.frets).toEqual([8, 10, 10, 9, 8, 8]);
    expect(v?.baseFret).toBe(8);
  });

  it("skips a template when the root fret is 0 or a fret would be non-positive", () => {
    expect(listVoicings(4, "maj").some((v) => v.source === "E")).toBe(false);
    expect(listVoicings(9, "maj").some((v) => v.source === "A")).toBe(false);
    expect(listVoicings(10, "dim7").some((v) => v.id.includes(":A-"))).toBe(false);
  });
});

describe("notes and spelling", () => {
  it("spells Bbmaj7 as Bb D F A", () => {
    expect(chordNotes(10, "maj7", "flat")).toEqual(["Bb", "D", "F", "A"]);
  });

  it("spells Fm as F Ab C and Cm as C Eb G", () => {
    expect(chordNotes(5, "m", "sharp")).toEqual(["F", "Ab", "C"]);
    expect(chordNotes(0, "m", "sharp")).toEqual(["C", "Eb", "G"]);
  });

  it("spells conventional keys", () => {
    expect(chordNotes(0, "7", "sharp")).toEqual(["C", "E", "G", "Bb"]);
    expect(chordNotes(11, "7", "sharp")).toEqual(["B", "D#", "F#", "A"]);
    expect(chordNotes(9, "m", "sharp")).toEqual(["A", "C", "E"]);
    expect(chordNotes(4, "dim", "sharp")).toEqual(["E", "G", "Bb"]);
  });

  it("uses sharps for a sharp root and flats for a flat root", () => {
    expect(chordNotes(6, "m7", "sharp")).toEqual(["F#", "A", "C#", "E"]);
    expect(chordNotes(1, "maj", "flat")).toEqual(["Db", "F", "Ab"]);
    expect(chordNotes(1, "maj", "sharp")).toEqual(["C#", "E#", "G#"]);
    // Interval-based spelling: no mixed families.
    expect(chordNotes(1, "m7", "flat")).toEqual(["Db", "Fb", "Ab", "Cb"]);
    expect(chordNotes(1, "m7", "sharp")).toEqual(["C#", "E", "G#", "B"]);
    expect(chordNotes(0, "dim7", "sharp")).toEqual(["C", "Eb", "Gb", "Bbb"]);
    expect(chordNotes(0, "aug", "sharp")).toEqual(["C", "E", "G#"]);
    expect(chordNotes(4, "9", "sharp")).toEqual(["E", "G#", "B", "D", "F#"]);
  });

  it("reports interval labels and note names per string", () => {
    const c = checkVoicing(listVoicings(0, "maj")[0], 0, "maj");
    expect(c.strings.map((s) => s && s.interval)).toEqual([null, "R", "3", "5", "R", "3"]);
    expect(c.strings.map((s) => s && s.note)).toEqual([null, "C", "E", "G", "C", "E"]);
  });
});

describe("checker rejections", () => {
  const base = listVoicings(0, "maj")[0];

  it("rejects a wrong bass, a foreign note and a missing tone", () => {
    expect(checkVoicing({ ...base, frets: [null, null, 2, 0, 1, 0] }, 0, "maj").ok).toBe(false); // bass E
    expect(checkVoicing({ ...base, frets: [null, 3, 2, 0, 1, 2] }, 0, "maj").ok).toBe(false); // F# on string 1
    expect(checkVoicing({ ...base, frets: [null, 3, null, 0, null, null], fingers: [null, 3, null, null, null, null] }, 0, "maj").ok).toBe(false); // no 3rd
  });

  it("rejects bad playability", () => {
    expect(checkVoicing({ ...base, fingers: [null, null, 2, null, 1, null] }, 0, "maj").ok).toBe(false); // fretted without finger
    expect(checkVoicing({ ...base, fingers: [null, 3, 2, 1, 1, null] }, 0, "maj").ok).toBe(false); // finger on open string
    const f = listVoicings(5, "maj").find((v) => v.id === "F:maj:E-1")!;
    expect(checkVoicing({ ...f, barre: { ...f.barre!, fret: 2 } }, 5, "maj").ok).toBe(false);
  });
});

describe("parseChordName", () => {
  it("round-trips with chordDisplayName for every root and type", () => {
    for (const type of CHORD_TYPES) {
      for (let pc = 0; pc < 12; pc++) {
        for (const sp of spellings(pc)) {
          const name = chordDisplayName(pc, type.id, sp);
          const p = parseChordName(name);
          expect(p, name).toEqual({ rootPc: pc, spelling: sp, typeId: type.id });
        }
      }
    }
  });

  it("accepts the sharp and flat symbols", () => {
    expect(parseChordName("C♯m7")).toEqual({ rootPc: 1, spelling: "sharp", typeId: "m7" });
    expect(parseChordName("D♭maj7")).toEqual({ rootPc: 1, spelling: "flat", typeId: "maj7" });
    expect(parseChordName("D/F♯")).toEqual({ slash: "D/F#" });
  });

  it("parses the spec examples", () => {
    expect(parseChordName("C")).toEqual({ rootPc: 0, spelling: "sharp", typeId: "maj" });
    expect(parseChordName("Bb5")).toEqual({ rootPc: 10, spelling: "flat", typeId: "5" });
    expect(parseChordName("Gsus4")).toEqual({ rootPc: 7, spelling: "sharp", typeId: "sus4" });
    expect(parseChordName("Aadd9")).toEqual({ rootPc: 9, spelling: "sharp", typeId: "add9" });
    expect(parseChordName("D/F#")).toEqual({ slash: "D/F#" });
  });

  it("rejects bad input", () => {
    for (const bad of ["H7", "Cm#", "", "c", "Cb", "E#", "D/G", "Cmaj", "C7sus"]) expect(parseChordName(bad), bad).toBeNull();
  });

  it("gives C# and Db the same chordKey", () => {
    const a = parseChordName("C#") as { rootPc: number; typeId: ChordTypeId };
    const b = parseChordName("Db") as { rootPc: number; typeId: ChordTypeId };
    expect(chordKey(a.rootPc, a.typeId)).toBe(chordKey(b.rootPc, b.typeId));
    expect(chordKey(6, "m7")).toBe("6:m7");
  });
});
