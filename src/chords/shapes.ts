// Hand-authored voicings: open chords, slash chords and movable templates
// (spec section 1). Frets and fingers run string 6 .. string 1.

import type { StringNumber } from "../model/index.js";
import { chordType, mod12, parseRoot, rootName } from "./theory.js";
import type { ChordTypeId, Fret, SlashChord, Voicing } from "./types.js";

type Six<T> = [T, T, T, T, T, T];

const MAX_FRET = 15;

/** Diagram window start: at the nut for shapes with open strings or a 1st-fret note,
 * otherwise the lowest fretted fret (so x35553 is drawn as a "3fr" barre shape). */
function baseFretOf(frets: Fret[]): number {
  const fretted = frets.filter((f): f is number => f !== null && f > 0);
  if (fretted.length === 0 || frets.includes(0)) return 1;
  return Math.min(...fretted);
}

function rootPcOf(name: string): number {
  const r = parseRoot(name);
  if (!r) throw new Error(`bad root ${name}`);
  return r.rootPc;
}

/** "x32010" -> frets; single characters, so open chords only (frets 0-9). */
function parseFrets(text: string): Six<Fret> {
  return [...text].map((c) => (c === "x" ? null : Number(c))) as Six<Fret>;
}

/** "-32-1-" -> fingers; "-" for none. */
function parseFingers(text: string): Six<number | null> {
  return [...text].map((c) => (c === "-" ? null : Number(c))) as Six<number | null>;
}

// ---------------------------------------------------------------------------
// Open chords (not transposed).

interface OpenChord {
  label: string;
  root: string;
  typeId: ChordTypeId;
  voicing: Voicing;
}

function open(
  label: string,
  root: string,
  typeId: ChordTypeId,
  frets: string,
  fingers: string,
  barre?: { fret: number; from: StringNumber; to: StringNumber },
): OpenChord {
  const f = parseFrets(frets);
  const voicing: Voicing = {
    id: `${root}:${typeId}:open-${label}`,
    frets: f,
    fingers: parseFingers(fingers),
    baseFret: baseFretOf(f),
    source: "open",
  };
  if (barre) voicing.barre = { fret: barre.fret, fromString: barre.from, toString: barre.to, finger: 1 };
  return { label, root, typeId, voicing };
}

const OPEN_CHORDS: OpenChord[] = [
  open("C", "C", "maj", "x32010", "-32-1-"),
  open("A", "A", "maj", "x02220", "--123-"),
  open("G", "G", "maj", "320003", "21---3"),
  open("G-b", "G", "maj", "320033", "21--34"),
  open("E", "E", "maj", "022100", "-231--"),
  open("D", "D", "maj", "xx0232", "---132"),
  open("Am", "A", "m", "x02210", "--231-"),
  open("Em", "E", "m", "022000", "-23---"),
  open("Dm", "D", "m", "xx0231", "---231"),
  open("A7", "A", "7", "x02020", "--1-2-"),
  open("B7", "B", "7", "x21202", "-213-4"),
  open("C7", "C", "7", "x32310", "-3241-"),
  open("D7", "D", "7", "xx0212", "---213"),
  open("E7", "E", "7", "020100", "-2-1--"),
  open("G7", "G", "7", "320001", "32---1"),
  open("Am7", "A", "m7", "x02010", "--2-1-"),
  open("Dm7", "D", "m7", "xx0211", "---211", { fret: 1, from: 2, to: 1 }),
  open("Em7", "E", "m7", "020000", "-2----"),
  open("Cmaj7", "C", "maj7", "x32000", "-32---"),
  open("Dmaj7", "D", "maj7", "xx0222", "---123"),
  open("Fmaj7", "F", "maj7", "xx3210", "--321-"),
  open("Gmaj7", "G", "maj7", "320002", "32---1"),
  open("Amaj7", "A", "maj7", "x02120", "--213-"),
  open("Emaj7", "E", "maj7", "021100", "-312--"),
  open("Dsus2", "D", "sus2", "xx0230", "---13-"),
  open("Dsus4", "D", "sus4", "xx0233", "---123"),
  open("Asus2", "A", "sus2", "x02200", "--12--"),
  open("Asus4", "A", "sus4", "x02230", "--123-"),
  open("Esus4", "E", "sus4", "022200", "-123--"),
  open("Cadd9", "C", "add9", "x32033", "-21-34"),
  open("Gadd9", "G", "add9", "320203", "32-1-4"),
  open("Gadd9-b", "G", "add9", "300203", "2--1-3"),
  open("Eadd9", "E", "add9", "024100", "-241--"),
  open("A6", "A", "6", "x02222", "--1111", { fret: 2, from: 4, to: 1 }),
  open("D6", "D", "6", "xx0202", "---1-2"),
  open("E6", "E", "6", "022120", "-2314-"),
  open("E5", "E", "5", "022xxx", "-12---"),
  open("A5", "A", "5", "x022xx", "--12--"),
  open("D5", "D", "5", "xx023x", "---13-"),
  open("Em6", "E", "m6", "022020", "-12-3-"),
  open("Am6", "A", "m6", "x02212", "--2314"),
  open("E9", "E", "9", "020102", "-2-1-3"),
  open("A9", "A", "9", "x02423", "--1423"),
];

// ---------------------------------------------------------------------------
// Slash chords (not transposed).

function slash(
  name: string,
  root: string,
  typeId: ChordTypeId,
  bass: string,
  frets: string,
  fingers: string,
  barre?: { fret: number; from: StringNumber; to: StringNumber },
): SlashChord {
  const f = parseFrets(frets);
  const voicing: Voicing = {
    id: `slash:${name}`,
    frets: f,
    fingers: parseFingers(fingers),
    baseFret: baseFretOf(f),
    source: "open",
  };
  if (barre) voicing.barre = { fret: barre.fret, fromString: barre.from, toString: barre.to, finger: 1 };
  return { name, key: `slash:${name}`, rootPc: rootPcOf(root), typeId, bassPc: rootPcOf(bass), voicing };
}

export const SLASH_CHORDS: SlashChord[] = [
  slash("D/F#", "D", "maj", "F#", "200232", "1--243"),
  slash("G/B", "G", "maj", "B", "x20003", "-2---3"),
  slash("C/E", "C", "maj", "E", "032010", "-32-1-"),
  slash("C/G", "C", "maj", "G", "332010", "342-1-"),
  slash("Am/G", "A", "m", "G", "302210", "4-231-"),
  slash("F/C", "F", "maj", "C", "x33211", "-34211", { fret: 1, from: 2, to: 1 }),
  slash("D/A", "D", "maj", "A", "x00232", "---132"),
  slash("E/G#", "E", "maj", "G#", "4x2100", "4-21--"),
  slash("A/C#", "A", "maj", "C#", "x42220", "-4111-", { fret: 2, from: 4, to: 2 }),
  slash("G/F#", "G", "maj", "F#", "220003", "12---3"),
];

// ---------------------------------------------------------------------------
// Movable templates: offsets from the root fret on the root string.

interface Template {
  typeId: ChordTypeId;
  source: Voicing["source"];
  /** Distinguishes templates of the same source for one type. */
  key: string;
  rootString: StringNumber;
  offsets: Six<number | null>;
  fingers: Six<number | null>;
  barre?: { offset: number; from: StringNumber; to: StringNumber };
}

const N = null;

const TEMPLATES: Template[] = [
  // Major
  { typeId: "maj", source: "E", key: "E", rootString: 6, offsets: [0, 2, 2, 1, 0, 0], fingers: [1, 3, 4, 2, 1, 1], barre: { offset: 0, from: 6, to: 1 } },
  { typeId: "maj", source: "A", key: "A", rootString: 5, offsets: [N, 0, 2, 2, 2, 0], fingers: [N, 1, 3, 3, 3, 1], barre: { offset: 0, from: 5, to: 1 } },
  { typeId: "maj", source: "D", key: "D", rootString: 4, offsets: [N, N, 0, 2, 3, 2], fingers: [N, N, 1, 2, 4, 3] },
  { typeId: "maj", source: "C", key: "C", rootString: 5, offsets: [N, 0, -1, -3, -2, -3], fingers: [N, 4, 3, 1, 2, 1], barre: { offset: -3, from: 3, to: 1 } },
  { typeId: "maj", source: "G", key: "G", rootString: 6, offsets: [0, -1, -3, -3, -3, 0], fingers: [4, 3, 1, 1, 1, 4], barre: { offset: -3, from: 4, to: 2 } },
  // Minor
  { typeId: "m", source: "E", key: "E", rootString: 6, offsets: [0, 2, 2, 0, 0, 0], fingers: [1, 3, 4, 1, 1, 1], barre: { offset: 0, from: 6, to: 1 } },
  { typeId: "m", source: "A", key: "A", rootString: 5, offsets: [N, 0, 2, 2, 1, 0], fingers: [N, 1, 3, 4, 2, 1], barre: { offset: 0, from: 5, to: 1 } },
  { typeId: "m", source: "D", key: "D", rootString: 4, offsets: [N, N, 0, 2, 3, 1], fingers: [N, N, 1, 3, 4, 2] },
  // Dominant 7th
  { typeId: "7", source: "E", key: "E", rootString: 6, offsets: [0, 2, 0, 1, 0, 0], fingers: [1, 3, 1, 2, 1, 1], barre: { offset: 0, from: 6, to: 1 } },
  { typeId: "7", source: "A", key: "A", rootString: 5, offsets: [N, 0, 2, 0, 2, 0], fingers: [N, 1, 3, 1, 4, 1], barre: { offset: 0, from: 5, to: 1 } },
  { typeId: "7", source: "D", key: "D", rootString: 4, offsets: [N, N, 0, 2, 1, 2], fingers: [N, N, 1, 3, 2, 4] },
  { typeId: "7", source: "C", key: "C", rootString: 5, offsets: [N, 0, -1, 0, -2, N], fingers: [N, 3, 2, 4, 1, N] },
  // Minor 7th
  { typeId: "m7", source: "E", key: "E", rootString: 6, offsets: [0, 2, 0, 0, 0, 0], fingers: [1, 3, 1, 1, 1, 1], barre: { offset: 0, from: 6, to: 1 } },
  { typeId: "m7", source: "A", key: "A", rootString: 5, offsets: [N, 0, 2, 0, 1, 0], fingers: [N, 1, 3, 1, 2, 1], barre: { offset: 0, from: 5, to: 1 } },
  { typeId: "m7", source: "D", key: "D", rootString: 4, offsets: [N, N, 0, 2, 1, 1], fingers: [N, N, 1, 4, 2, 2] },
  // Major 7th
  { typeId: "maj7", source: "E", key: "E", rootString: 6, offsets: [0, 2, 1, 1, 0, 0], fingers: [1, 4, 2, 3, 1, 1], barre: { offset: 0, from: 6, to: 1 } },
  { typeId: "maj7", source: "A", key: "A", rootString: 5, offsets: [N, 0, 2, 1, 2, 0], fingers: [N, 1, 3, 2, 4, 1], barre: { offset: 0, from: 5, to: 1 } },
  { typeId: "maj7", source: "D", key: "D", rootString: 4, offsets: [N, N, 0, 2, 2, 2], fingers: [N, N, 1, 3, 3, 3] },
  { typeId: "maj7", source: "C", key: "C", rootString: 5, offsets: [N, 0, -1, -3, -3, -3], fingers: [N, 3, 2, 1, 1, 1], barre: { offset: -3, from: 3, to: 1 } },
  // Suspended
  { typeId: "sus2", source: "A", key: "A", rootString: 5, offsets: [N, 0, 2, 2, 0, 0], fingers: [N, 1, 3, 4, 1, 1], barre: { offset: 0, from: 5, to: 1 } },
  { typeId: "sus2", source: "D", key: "D", rootString: 4, offsets: [N, N, 0, 2, 3, 0], fingers: [N, N, 1, 3, 4, 1], barre: { offset: 0, from: 4, to: 1 } },
  { typeId: "sus4", source: "E", key: "E", rootString: 6, offsets: [0, 2, 2, 2, 0, 0], fingers: [1, 2, 3, 4, 1, 1], barre: { offset: 0, from: 6, to: 1 } },
  { typeId: "sus4", source: "A", key: "A", rootString: 5, offsets: [N, 0, 2, 2, 3, 0], fingers: [N, 1, 3, 3, 4, 1], barre: { offset: 0, from: 5, to: 1 } },
  { typeId: "sus4", source: "D", key: "D", rootString: 4, offsets: [N, N, 0, 2, 3, 3], fingers: [N, N, 1, 2, 3, 4] },
  // Diminished triad
  { typeId: "dim", source: "A", key: "A", rootString: 5, offsets: [N, 0, 1, 2, 1, N], fingers: [N, 1, 2, 4, 3, N] },
  { typeId: "dim", source: "E", key: "E", rootString: 6, offsets: [0, 1, 2, 0, N, N], fingers: [1, 2, 3, 1, N, N], barre: { offset: 0, from: 6, to: 3 } },
  { typeId: "dim", source: "D", key: "D", rootString: 4, offsets: [N, N, 0, 1, 3, 1], fingers: [N, N, 1, 2, 4, 2] },
  // Diminished 7th
  { typeId: "dim7", source: "A", key: "A", rootString: 5, offsets: [N, 0, 1, -1, 1, N], fingers: [N, 2, 3, 1, 4, N] },
  { typeId: "dim7", source: "D", key: "D", rootString: 4, offsets: [N, N, 0, 1, 0, 1], fingers: [N, N, 1, 3, 2, 4] },
  { typeId: "dim7", source: "E", key: "E", rootString: 6, offsets: [0, N, 2, 3, 2, 3], fingers: [1, N, 2, 3, 2, 4] },
  // Augmented
  { typeId: "aug", source: "E", key: "E", rootString: 6, offsets: [0, 3, 2, 1, 1, 0], fingers: [1, 4, 3, 2, 2, 1], barre: { offset: 0, from: 6, to: 1 } },
  { typeId: "aug", source: "A", key: "A", rootString: 5, offsets: [N, 0, 3, 2, 2, 1], fingers: [N, 1, 4, 3, 3, 2] },
  { typeId: "aug", source: "D", key: "D", rootString: 4, offsets: [N, N, 0, 3, 3, 2], fingers: [N, N, 1, 4, 4, 2] },
  // Add 9
  { typeId: "add9", source: "A", key: "A", rootString: 5, offsets: [N, 0, 2, 4, 2, 0], fingers: [N, 1, 2, 4, 3, 1], barre: { offset: 0, from: 5, to: 1 } },
  { typeId: "add9", source: "D", key: "D", rootString: 4, offsets: [N, N, 0, -1, -2, 0], fingers: [N, N, 3, 2, 1, 4] },
  { typeId: "add9", source: "E", key: "E", rootString: 6, offsets: [0, 2, 4, 1, 0, 0], fingers: [1, 3, 4, 2, 1, 1], barre: { offset: 0, from: 6, to: 1 } },
  // 6 and minor 6
  { typeId: "6", source: "A", key: "A", rootString: 5, offsets: [N, 0, 2, 2, 2, 2], fingers: [N, 1, 3, 3, 3, 3] },
  { typeId: "6", source: "E", key: "E", rootString: 6, offsets: [0, 2, 2, 1, 2, 0], fingers: [1, 3, 3, 2, 4, 1], barre: { offset: 0, from: 6, to: 1 } },
  { typeId: "m6", source: "A", key: "A", rootString: 5, offsets: [N, 0, 2, 2, 1, 2], fingers: [N, 1, 3, 3, 2, 4] },
  { typeId: "m6", source: "E", key: "E", rootString: 6, offsets: [0, 2, 2, 0, 2, 0], fingers: [1, 3, 3, 1, 4, 1], barre: { offset: 0, from: 6, to: 1 } },
  // Dominant 9th
  { typeId: "9", source: "E", key: "E", rootString: 6, offsets: [0, 2, 0, 1, 0, 2], fingers: [1, 3, 1, 2, 1, 4], barre: { offset: 0, from: 6, to: 2 } },
  { typeId: "9", source: "A", key: "A", rootString: 5, offsets: [N, 0, -1, 0, 0, N], fingers: [N, 2, 1, 3, 4, N] },
  { typeId: "9", source: "D", key: "D", rootString: 4, offsets: [N, N, 0, -1, 1, 0], fingers: [N, N, 2, 1, 4, 3] },
  // Power chords
  { typeId: "5", source: "E", key: "E", rootString: 6, offsets: [0, 2, 2, N, N, N], fingers: [1, 3, 4, N, N, N] },
  { typeId: "5", source: "A", key: "A", rootString: 5, offsets: [N, 0, 2, 2, N, N], fingers: [N, 1, 3, 4, N, N] },
  { typeId: "5", source: "D", key: "D", rootString: 4, offsets: [N, N, 0, 2, 3, N], fingers: [N, N, 1, 3, 4, N] },
];

const OPEN_STRING_PC: Record<StringNumber, number> = { 6: 4, 5: 9, 4: 2, 3: 7, 2: 11, 1: 4 };

/** One template at one root, or null when a skip rule applies. */
function transpose(t: Template, rootPc: number): Voicing | null {
  const rootFret = mod12(rootPc - OPEN_STRING_PC[t.rootString]);
  if (rootFret === 0) return null; // open positions come from the hand-written open chords
  const frets = t.offsets.map((o) => (o === null ? null : o + rootFret)) as Six<Fret>;
  // A sounding string below fret 1 would turn into an open string (or go negative).
  if (frets.some((f) => f !== null && (f < 1 || f > MAX_FRET))) return null;
  const voicing: Voicing = {
    id: `${rootName(rootPc)}:${t.typeId}:${t.key}-${rootFret}`,
    frets,
    fingers: [...t.fingers],
    baseFret: baseFretOf(frets),
    source: t.source,
  };
  if (t.barre) {
    voicing.barre = { fret: t.barre.offset + rootFret, fromString: t.barre.from, toString: t.barre.to, finger: 1 };
  }
  return voicing;
}

function sortKey(v: Voicing): [number, number, string] {
  return [v.source === "open" ? 0 : 1, v.baseFret, v.id];
}

/** All voicings for a chord, open first, then low to high by baseFret. */
export function listVoicings(rootPc: number, typeId: ChordTypeId): Voicing[] {
  chordType(typeId);
  const root = mod12(rootPc);
  const out: Voicing[] = [];
  for (const o of OPEN_CHORDS) {
    if (o.typeId === typeId && rootPcOf(o.root) === root) out.push(o.voicing);
  }
  for (const t of TEMPLATES) {
    if (t.typeId !== typeId) continue;
    const v = transpose(t, root);
    if (v) out.push(v);
  }
  return out.sort((a, b) => {
    const ka = sortKey(a);
    const kb = sortKey(b);
    return ka[0] - kb[0] || ka[1] - kb[1] || (ka[2] < kb[2] ? -1 : ka[2] > kb[2] ? 1 : 0);
  });
}

/** Slash chords shown under this root (the chord before the slash). */
export function slashChordsFor(rootPc: number): SlashChord[] {
  return SLASH_CHORDS.filter((s) => s.rootPc === mod12(rootPc));
}

/** The hand-written open chords, for tests and tooling. */
export function openChordList(): { label: string; rootPc: number; typeId: ChordTypeId; voicing: Voicing }[] {
  return OPEN_CHORDS.map((o) => ({ label: o.label, rootPc: rootPcOf(o.root), typeId: o.typeId, voicing: o.voicing }));
}
