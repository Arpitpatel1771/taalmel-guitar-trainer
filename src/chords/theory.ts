// Chord types, root names, key-signature spelling and name parsing.

import type { ChordType, ChordTypeId, ParsedChord, RootInfo, Spelling } from "./types.js";

const R = { semi: 0, label: "R" };

export const CHORD_TYPES: ChordType[] = [
  { id: "maj", name: "major", suffix: "", group: "Triads", tones: [R, { semi: 4, label: "3" }, { semi: 7, label: "5" }], optional: [] },
  { id: "m", name: "minor", suffix: "m", group: "Triads", tones: [R, { semi: 3, label: "b3" }, { semi: 7, label: "5" }], optional: [] },
  { id: "dim", name: "diminished", suffix: "dim", group: "Triads", tones: [R, { semi: 3, label: "b3" }, { semi: 6, label: "b5" }], optional: [] },
  { id: "aug", name: "augmented", suffix: "aug", group: "Triads", tones: [R, { semi: 4, label: "3" }, { semi: 8, label: "#5" }], optional: [] },
  { id: "sus2", name: "suspended 2nd", suffix: "sus2", group: "Triads", tones: [R, { semi: 2, label: "2" }, { semi: 7, label: "5" }], optional: [] },
  { id: "sus4", name: "suspended 4th", suffix: "sus4", group: "Triads", tones: [R, { semi: 5, label: "4" }, { semi: 7, label: "5" }], optional: [] },
  { id: "5", name: "power chord", suffix: "5", group: "Triads", tones: [R, { semi: 7, label: "5" }], optional: [] },
  {
    id: "7",
    name: "dominant 7th",
    suffix: "7",
    group: "Sevenths",
    tones: [R, { semi: 4, label: "3" }, { semi: 7, label: "5" }, { semi: 10, label: "b7" }],
    optional: [7],
  },
  {
    id: "m7",
    name: "minor 7th",
    suffix: "m7",
    group: "Sevenths",
    tones: [R, { semi: 3, label: "b3" }, { semi: 7, label: "5" }, { semi: 10, label: "b7" }],
    optional: [7],
  },
  {
    id: "maj7",
    name: "major 7th",
    suffix: "maj7",
    group: "Sevenths",
    tones: [R, { semi: 4, label: "3" }, { semi: 7, label: "5" }, { semi: 11, label: "7" }],
    optional: [7],
  },
  {
    id: "dim7",
    name: "diminished 7th",
    suffix: "dim7",
    group: "Sevenths",
    tones: [R, { semi: 3, label: "b3" }, { semi: 6, label: "b5" }, { semi: 9, label: "bb7" }],
    optional: [],
  },
  {
    id: "6",
    name: "major 6th",
    suffix: "6",
    group: "Added & extended",
    tones: [R, { semi: 4, label: "3" }, { semi: 7, label: "5" }, { semi: 9, label: "6" }],
    optional: [7],
  },
  {
    id: "m6",
    name: "minor 6th",
    suffix: "m6",
    group: "Added & extended",
    tones: [R, { semi: 3, label: "b3" }, { semi: 7, label: "5" }, { semi: 9, label: "6" }],
    optional: [7],
  },
  {
    id: "add9",
    name: "add 9",
    suffix: "add9",
    group: "Added & extended",
    tones: [R, { semi: 4, label: "3" }, { semi: 7, label: "5" }, { semi: 2, label: "9" }],
    optional: [7],
  },
  {
    id: "9",
    name: "dominant 9th",
    suffix: "9",
    group: "Added & extended",
    tones: [R, { semi: 4, label: "3" }, { semi: 7, label: "5" }, { semi: 10, label: "b7" }, { semi: 2, label: "9" }],
    optional: [7],
  },
];

const TYPE_BY_ID = new Map<string, ChordType>(CHORD_TYPES.map((t) => [t.id, t]));

export function chordType(id: ChordTypeId): ChordType {
  const t = TYPE_BY_ID.get(id);
  if (!t) throw new Error(`unknown chord type ${id}`);
  return t;
}

const SHARP_NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
const FLAT_NAMES = ["C", "Db", "D", "Eb", "E", "F", "Gb", "G", "Ab", "A", "Bb", "B"];
const NATURAL_PCS = new Set([0, 2, 4, 5, 7, 9, 11]);

export const ROOTS: RootInfo[] = SHARP_NAMES.map((sharp, pc) =>
  NATURAL_PCS.has(pc) ? { pc, sharp } : { pc, sharp, flat: FLAT_NAMES[pc] },
);

/**
 * Key signature (sharps positive, flats negative) of the major key on each
 * pitch class. Gb is used for pc 6 so F dim spells F Ab B.
 */
const MAJOR_KEY_SIGNATURE = [0, -5, 2, -3, 4, -1, -6, 1, -4, 3, -2, 5];

/**
 * Which major key a chord is spelled in, as semitones above its root:
 * minor-ish chords use the relative major, dominants the key a fourth up,
 * and diminished chords the key a semitone up (leading tone).
 */
const KEY_OFFSET: Record<ChordTypeId, number> = {
  maj: 0,
  m: 3,
  "7": 5,
  m7: 3,
  maj7: 0,
  sus2: 0,
  sus4: 0,
  dim: 1,
  dim7: 1,
  aug: 0,
  add9: 0,
  "6": 0,
  m6: 3,
  "9": 5,
  "5": 0,
};

export function mod12(n: number): number {
  return ((n % 12) + 12) % 12;
}

/** Name family for a chord: accidental roots follow the pick, natural roots follow the key signature. */
export function spellingFamily(rootPc: number, typeId: ChordTypeId, spelling: Spelling): Spelling {
  if (!NATURAL_PCS.has(mod12(rootPc))) return spelling;
  const key = mod12(rootPc + KEY_OFFSET[typeId]);
  return MAJOR_KEY_SIGNATURE[key] < 0 ? "flat" : "sharp";
}

export function pcName(pc: number, family: Spelling): string {
  return (family === "flat" ? FLAT_NAMES : SHARP_NAMES)[mod12(pc)];
}

/** Root name as picked: natural roots ignore the spelling. */
export function rootName(rootPc: number, spelling: Spelling = "sharp"): string {
  return pcName(rootPc, spelling);
}

export function chordDisplayName(rootPc: number, typeId: ChordTypeId, spelling: Spelling = "sharp"): string {
  return rootName(rootPc, spelling) + chordType(typeId).suffix;
}

const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PCS = [0, 2, 4, 5, 7, 9, 11];
const ACCIDENTALS: Record<number, string> = { [-2]: "bb", [-1]: "b", 0: "", 1: "#", 2: "##" };

/** Scale degree of an interval label: "R" -> 1, "b3" -> 3, "#5" -> 5, "9" -> 9. */
function degreeOf(label: string): number {
  return label === "R" ? 1 : Number(label.replace(/[^0-9]/g, ""));
}

/**
 * Spells one chord tone by interval: the letter is (degree - 1) steps above the
 * root's letter and the accidental makes up the pitch, so Dbm7 = Db Fb Ab Cb
 * and C#maj = C# E# G#. Falls back to the key-family name if a spelling would
 * need more than a double accidental.
 */
function spellTone(rootPc: number, spelling: Spelling, typeId: ChordTypeId, semi: number, label: string): string {
  const rootLetter = LETTERS.indexOf(rootName(rootPc, spelling)[0]);
  const letter = (rootLetter + degreeOf(label) - 1) % 7;
  let diff = mod12(rootPc + semi - LETTER_PCS[letter]);
  if (diff > 6) diff -= 12;
  const acc = ACCIDENTALS[diff];
  return acc === undefined ? pcName(rootPc + semi, spellingFamily(rootPc, typeId, spelling)) : LETTERS[letter] + acc;
}

/** Pitch class -> spelled name for every tone of the chord. */
export function chordToneNames(rootPc: number, typeId: ChordTypeId, spelling: Spelling = "sharp"): Map<number, string> {
  return new Map(chordType(typeId).tones.map((t) => [mod12(rootPc + t.semi), spellTone(rootPc, spelling, typeId, t.semi, t.label)]));
}

/** Note names of the chord in formula order, root first. */
export function chordNotes(rootPc: number, typeId: ChordTypeId, spelling: Spelling = "sharp"): string[] {
  return chordType(typeId).tones.map((t) => spellTone(rootPc, spelling, typeId, t.semi, t.label));
}

/** Spelling-independent key for marks and lookups, e.g. "6:m7". */
export function chordKey(rootPc: number, typeId: ChordTypeId): string {
  return `${mod12(rootPc)}:${typeId}`;
}

const ROOT_RE = /^([A-G])([#♯b♭]?)(.*)$/;
const LETTER_PC: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Root text ("C", "F#", "Bb", "C♯") to a pitch class and spelling; null if not one of the 12 roots. */
export function parseRoot(text: string): { rootPc: number; spelling: Spelling; rest: string } | null {
  const m = ROOT_RE.exec(text);
  if (!m) return null;
  const accidental = m[2];
  const sharp = accidental === "#" || accidental === "♯";
  const flat = accidental === "b" || accidental === "♭";
  const rootPc = mod12(LETTER_PC[m[1]] + (sharp ? 1 : flat ? -1 : 0));
  if (accidental && NATURAL_PCS.has(rootPc)) return null; // Cb, E#, ...
  return { rootPc, spelling: flat ? "flat" : "sharp", rest: m[3] };
}

/** "D/F#" style text with Unicode accidentals normalised. */
export function normalizeSlashName(text: string): string {
  return text.replace(/♯/g, "#").replace(/♭/g, "b");
}

/** Parses a chord name that is not a slash chord. */
export function parseChordText(text: string): ParsedChord | null {
  const root = parseRoot(text);
  if (!root) return null;
  const type = CHORD_TYPES.find((t) => t.suffix === root.rest);
  if (!type) return null;
  return { rootPc: root.rootPc, spelling: root.spelling, typeId: type.id };
}
