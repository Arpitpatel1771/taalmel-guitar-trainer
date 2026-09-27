// Strumming exercise generator (spec section 12.1). Output is plain song text:
// every strum is a chord slot whose first note carries `strum: up|down`
// (spec 5.6), and each strum rings until the next one in its bar. The mic can
// check timing only for these (chord slots skip pitch, spec 9.5; direction is
// not detectable).

import type { StringNumber, TimeSignature } from "../model/index.js";
import { buildExerciseText } from "./textBuilder.js";

export type ChordName = "E" | "Em" | "A" | "Am" | "D" | "Dm" | "G" | "C";

/** Open-position voicings: string -> fret. Unplayed strings are omitted. */
export const CHORDS: Record<ChordName, Partial<Record<StringNumber, number>>> = {
  E: { 6: 0, 5: 2, 4: 2, 3: 1, 2: 0, 1: 0 },
  Em: { 6: 0, 5: 2, 4: 2, 3: 0, 2: 0, 1: 0 },
  A: { 5: 0, 4: 2, 3: 2, 2: 2, 1: 0 },
  Am: { 5: 0, 4: 2, 3: 2, 2: 1, 1: 0 },
  D: { 4: 0, 3: 2, 2: 3, 1: 2 },
  Dm: { 4: 0, 3: 2, 2: 3, 1: 1 },
  G: { 6: 3, 5: 2, 4: 0, 3: 0, 2: 0, 1: 3 },
  C: { 5: 3, 4: 2, 3: 0, 2: 1, 1: 0 },
};

export type StrumPatternName = "downQuarters" | "downEighths" | "downUpEighths" | "folk" | "offbeat" | "sixteenthDownUp";

export interface StrumPattern {
  label: string;
  grid: number;
  /** Strums in the bar: [slot (1-based), direction]. Slots ascending. */
  strums: [number, "up" | "down"][];
}

export const STRUM_PATTERNS: Record<StrumPatternName, StrumPattern> = {
  downQuarters: { label: "down quarters", grid: 4, strums: [[1, "down"], [2, "down"], [3, "down"], [4, "down"]] },
  downEighths: {
    label: "down eighths",
    grid: 8,
    strums: [1, 2, 3, 4, 5, 6, 7, 8].map((s) => [s, "down"] as [number, "down"]),
  },
  downUpEighths: {
    label: "down-up eighths",
    grid: 8,
    strums: [1, 2, 3, 4, 5, 6, 7, 8].map((s) => [s, s % 2 === 1 ? "down" : "up"] as [number, "up" | "down"]),
  },
  // D  DU  UDU: 1 . 2 & . & 4 &
  folk: { label: "folk D DU UDU", grid: 8, strums: [[1, "down"], [3, "down"], [4, "up"], [6, "up"], [7, "down"], [8, "up"]] },
  offbeat: { label: "offbeat ups", grid: 8, strums: [[2, "up"], [4, "up"], [6, "up"], [8, "up"]] },
  sixteenthDownUp: {
    label: "sixteenth down-up",
    grid: 16,
    strums: Array.from({ length: 16 }, (_, i) => [i + 1, i % 2 === 0 ? "down" : "up"] as [number, "up" | "down"]),
  },
};

export interface StrummingParams {
  /** Chords in order; one chord per bar, cycling. */
  chords: ChordName[];
  pattern: StrumPatternName;
  bars: number;
  bpm: number;
  /** Patterns are written for 4/4. */
  time?: TimeSignature;
}

export const DEFAULT_STRUMMING_PARAMS: StrummingParams = {
  chords: ["G", "C", "D"],
  pattern: "folk",
  bars: 6,
  bpm: 80,
  time: { numerator: 4, denominator: 4 },
};

/** Song text for one strum: every chord note, strum flag on the first
 * (highest-string, i.e. lowest string number) note, all with `length` units. */
function strumToken(chord: ChordName, dir: "up" | "down", length: number): string {
  const lengthBlock = length > 1 ? `[${length}]` : "";
  return Object.keys(CHORDS[chord])
    .map((s) => Number(s) as StringNumber)
    .sort((a, b) => a - b)
    .map((s, i) => `${s}S${CHORDS[chord][s]}${lengthBlock}${i === 0 ? `(strum: ${dir})` : ""}`)
    .join(" ");
}

export function strumming(params: Partial<StrummingParams> = {}): string {
  const p: StrummingParams = { ...DEFAULT_STRUMMING_PARAMS, ...params };
  const time = p.time ?? DEFAULT_STRUMMING_PARAMS.time!;
  if (p.chords.length === 0) throw new Error("strumming: pick at least one chord");
  for (const c of p.chords) if (!CHORDS[c]) throw new Error(`strumming: unknown chord ${c}`);
  if (time.numerator !== 4 || time.denominator !== 4) throw new Error("strumming: patterns are written for 4/4");
  const pattern = STRUM_PATTERNS[p.pattern];
  if (!pattern) throw new Error(`strumming: unknown pattern ${p.pattern}`);

  const { grid, strums } = pattern;
  const bySlot = new Map<number, { dir: "up" | "down"; length: number }>();
  strums.forEach(([slot, dir], i) => {
    const next = i + 1 < strums.length ? strums[i + 1][0] : grid + 1;
    bySlot.set(slot, { dir, length: next - slot });
  });

  return buildExerciseText({
    title: `Strumming ${p.chords.join("-")}, ${pattern.label}`,
    time,
    bpm: p.bpm,
    grid,
    bars: p.bars,
    noteToken: (i) => {
      const strum = bySlot.get((i % grid) + 1);
      if (!strum) return null;
      const chord = p.chords[Math.floor(i / grid) % p.chords.length];
      return strumToken(chord, strum.dir, strum.length);
    },
  });
}
