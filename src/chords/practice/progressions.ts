// Pure logic for strum-along progressions: Roman-numeral resolution in a key,
// custom chord-name parsing, and the bar/strum timeline (chord practice spec 3).

import { parseChordName, type ChordTypeId, type Spelling } from "../index.js";
import { mod12, rootName } from "../theory.js";

/** Same shape as the UI's PickedChord. */
export type ProgChord = { rootPc: number; typeId: ChordTypeId; spelling: Spelling } | { slash: string };

export type KeyMode = "major" | "minor";

export interface ProgressionPreset {
  id: string;
  label: string;
  tokens: string[];
  /** Mode selected when the preset is chosen. */
  mode: KeyMode;
  /** Bars per chord is fixed (the 12-bar blues). */
  fixedBars?: number;
}

export const PROGRESSION_PRESETS: ProgressionPreset[] = [
  { id: "I-IV-V", label: "I–IV–V", tokens: ["I", "IV", "V"], mode: "major" },
  { id: "I-V-vi-IV", label: "I–V–vi–IV", tokens: ["I", "V", "vi", "IV"], mode: "major" },
  { id: "vi-IV-I-V", label: "vi–IV–I–V", tokens: ["vi", "IV", "I", "V"], mode: "major" },
  { id: "I-vi-IV-V", label: "I–vi–IV–V", tokens: ["I", "vi", "IV", "V"], mode: "major" },
  { id: "ii-V-I", label: "ii–V–I", tokens: ["ii", "V", "I"], mode: "major" },
  {
    id: "blues",
    label: "12-bar blues",
    tokens: ["I7", "I7", "I7", "I7", "IV7", "IV7", "I7", "I7", "V7", "IV7", "I7", "V7"],
    mode: "major",
    fixedBars: 1,
  },
  { id: "andalusian", label: "Andalusian i–bVII–bVI–V", tokens: ["i", "bVII", "bVI", "V"], mode: "minor" },
  { id: "I-bVII-IV", label: "I–bVII–IV", tokens: ["I", "bVII", "IV"], mode: "major" },
];

const MAJOR_SEMIS = [0, 2, 4, 5, 7, 9, 11];
const LETTERS = ["C", "D", "E", "F", "G", "A", "B"];
const LETTER_PCS = [0, 2, 4, 5, 7, 9, 11];
const ROMAN = ["I", "II", "III", "IV", "V", "VI", "VII"];

const NUMERAL_RE = /^([b♭#♯]?)(VII|VI|IV|V|III|II|I|vii|vi|iv|v|iii|ii|i)(maj7|7|dim|°)?$/;

/**
 * Resolves one numeral ("vi", "bVII", "V7") in a key. The root letter follows
 * the key's scale letters (G major vi = Em, Bb major IV = Eb). Degrees are
 * counted on the major scale of the key root; in a minor key 3, 6 and 7 are
 * already flat, so a "b" there is redundant and "#" restores the major degree.
 * Case sets the quality; a "7" suffix makes it dominant (upper) or minor 7 (lower).
 */
export function resolveNumeral(token: string, key: { rootPc: number; spelling: Spelling }, mode: KeyMode): ProgChord | null {
  const m = NUMERAL_RE.exec(token.trim());
  if (!m) return null;
  const [, acc, numeral, suffix] = m;
  const upper = numeral === numeral.toUpperCase();
  const degree = ROMAN.indexOf(numeral.toUpperCase()); // 0..6
  let shift = acc === "b" || acc === "♭" ? -1 : acc === "#" || acc === "♯" ? 1 : 0;
  if (mode === "minor" && (degree === 2 || degree === 5 || degree === 6)) shift = shift < 0 ? -1 : shift - 1;
  const pc = mod12(key.rootPc + MAJOR_SEMIS[degree] + shift);
  const keyLetter = LETTERS.indexOf(rootName(key.rootPc, key.spelling)[0]);
  const letter = (keyLetter + degree) % 7;
  let diff = mod12(pc - LETTER_PCS[letter]);
  if (diff > 6) diff -= 12;
  const spelling: Spelling = diff < 0 ? "flat" : "sharp";
  let typeId: ChordTypeId;
  if (suffix === "dim" || suffix === "°") typeId = "dim";
  else if (suffix === "maj7") {
    if (!upper) return null;
    typeId = "maj7";
  } else if (suffix === "7") typeId = upper ? "7" : "m7";
  else typeId = upper ? "maj" : "m";
  return { rootPc: pc, typeId, spelling };
}

export interface ParseResult {
  chords: ProgChord[];
  /** Tokens that could not be read. */
  errors: string[];
}

export function resolveNumerals(tokens: string[], key: { rootPc: number; spelling: Spelling }, mode: KeyMode): ParseResult {
  const chords: ProgChord[] = [];
  const errors: string[] = [];
  for (const t of tokens) {
    const c = resolveNumeral(t, key, mode);
    if (c) chords.push(c);
    else errors.push(t);
  }
  return { chords, errors };
}

/** Custom text such as "G C D Em" or "Am, F, C, G" parsed with parseChordName. */
export function parseCustomProgression(text: string): ParseResult {
  const chords: ProgChord[] = [];
  const errors: string[] = [];
  for (const t of text.split(/[\s,;|–—-]+/).filter(Boolean)) {
    const p = parseChordName(t);
    if (!p) errors.push(t);
    else if ("slash" in p) chords.push({ slash: p.slash });
    else chords.push({ rootPc: p.rootPc, typeId: p.typeId, spelling: p.spelling });
  }
  return { chords, errors };
}

export interface TimelineStrum {
  /** Offset from the start of the bar, in beats. */
  beat: number;
  direction: "up" | "down";
}

export interface TimelineBar {
  chordIndex: number;
  strums: TimelineStrum[];
}

/** One entry per bar: which chord plays and where the pattern's strums fall. */
export function buildTimeline(
  chordCount: number,
  barsPerChord: number,
  pattern: { grid: number; strums: readonly (readonly [number, "up" | "down"])[] },
  beatsPerBar = 4,
): TimelineBar[] {
  const strums = pattern.strums.map(([slot, direction]) => ({ beat: ((slot - 1) / pattern.grid) * beatsPerBar, direction }));
  const bars: TimelineBar[] = [];
  for (let c = 0; c < chordCount; c++) {
    for (let b = 0; b < barsPerChord; b++) bars.push({ chordIndex: c, strums: strums.map((s) => ({ ...s })) });
  }
  return bars;
}
