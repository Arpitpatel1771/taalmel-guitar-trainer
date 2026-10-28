// Chord data types (chord library spec section 1). No UI dependencies.

import type { StringNumber } from "../model/index.js";

export type Fret = number | null; // null = muted (X); 0 = open

export type ChordTypeId =
  | "maj"
  | "m"
  | "7"
  | "m7"
  | "maj7"
  | "sus2"
  | "sus4"
  | "dim"
  | "dim7"
  | "aug"
  | "add9"
  | "6"
  | "m6"
  | "9"
  | "5";

export type ChordGroup = "Triads" | "Sevenths" | "Added & extended";

/** Which family of note names to use for an accidental root. */
export type Spelling = "sharp" | "flat";

export interface ChordTone {
  /** Semitones above the root, 0-11. */
  semi: number;
  /** Interval label shown on diagrams: R, b3, 5, b7, 9, ... */
  label: string;
}

export interface ChordType {
  id: ChordTypeId;
  name: string;
  /** Appended to the root to make the chord name ("" for major). */
  suffix: string;
  group: ChordGroup;
  /** Formula tones in display order, root first. */
  tones: ChordTone[];
  /** Semitones a voicing may leave out. */
  optional: number[];
}

export interface Voicing {
  /** Stable, spelling-independent: "C:maj:open-C" or "F:maj:E-1". */
  id: string;
  /** Index 0 = string 6 (low E) .. index 5 = string 1. */
  frets: [Fret, Fret, Fret, Fret, Fret, Fret];
  /** 1-4 per fretted string, null for open or muted. Same order as `frets`. */
  fingers: [number | null, number | null, number | null, number | null, number | null, number | null];
  /** fromString is the lower-pitched end (higher string number). */
  barre?: { fret: number; fromString: StringNumber; toString: StringNumber; finger: 1 };
  /** Lowest fret of the diagram window; 1 means the nut is shown. */
  baseFret: number;
  source: "open" | "E" | "A" | "C" | "D" | "G" | "other";
}

export interface SlashChord {
  /** "D/F#" */
  name: string;
  /** Key for marks: "slash:D/F#" */
  key: string;
  /** Root of the chord before the slash. */
  rootPc: number;
  typeId: ChordTypeId;
  bassPc: number;
  voicing: Voicing;
}

export interface StringInfo {
  string: StringNumber;
  fret: number;
  midi: number;
  pc: number;
  /** Interval label relative to the chord root (R, b3, 5, ...). */
  interval: string;
  /** Note name in the chord's spelling. */
  note: string;
}

export interface CheckResult {
  ok: boolean;
  errors: string[];
  /** Index 0 = string 6. null for muted strings. */
  strings: (StringInfo | null)[];
}

export interface ParsedChord {
  rootPc: number;
  spelling: Spelling;
  typeId: ChordTypeId;
}

export interface RootInfo {
  pc: number;
  sharp: string;
  /** Only for accidental roots. */
  flat?: string;
}
