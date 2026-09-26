// Spider ("spider walk") exercise generator (spec 12.1).

import type { StringNumber, TimeSignature } from "../model/index.js";
import { buildExerciseText } from "./textBuilder.js";

export type SpiderGrid = 4 | 8 | 12 | 16;

export interface SpiderParams {
  /** 1..20. Fret of the first cell (see doc comment on `spider`). */
  startFret: number;
  /** s such that the starting string pair is (s, s+2); 1 => strings 1 & 3
   * (high E & G), 4 => strings 4 & 6 (D & low E). Default 1. */
  startStringPair: 1 | 2 | 3 | 4;
  /** The only finger-pairing implemented in v1: fingers 1&3 play the pair at
   * the base fret, then fingers 2&4 play it one fret up. Kept as a field for
   * forward compatibility with alternate pairings. */
  fingerPairs: "13/24";
  grid: SpiderGrid;
  /** 1..32. */
  bars: number;
  bpm: number;
  time?: TimeSignature;
}

export const DEFAULT_SPIDER_PARAMS: SpiderParams = {
  startFret: 1,
  startStringPair: 1,
  fingerPairs: "13/24",
  grid: 8,
  bars: 4,
  bpm: 90,
  time: { numerator: 4, denominator: 4 },
};

/**
 * Spider exercise (spec 12.1): the classic "spider walk", alternating a
 * two-string, two-fret box between finger pairs 1&3 and 2&4, then walking
 * that box across the neck.
 *
 * One "cell" is 4 notes, one per slot, for a string pair (s, s+2) at a fret F:
 *   1. string s,   fret F      (finger 1)
 *   2. string s+2, fret F      (finger 3)
 *   3. string s,   fret F+1    (finger 2)
 *   4. string s+2, fret F+1    (finger 4)
 *
 * After a cell, the exercise walks to the next string pair: s := s+1. Once
 * s+2 would exceed string 6 (i.e. s > 4), s wraps back to 1 and the fret F
 * advances by 1 - so one full pass across all four pairs, (1,3) (2,4) (3,5)
 * (4,6), climbs one fret up the neck before repeating. F is clamped so that
 * F+1 never exceeds fret 24: once F+1 reaches 24 the fret stops advancing and
 * remaining cells keep repeating at that fret.
 *
 * Cells are generated in this order and laid out one note per slot (length 1
 * unit each) across `bars` bars of `grid` slots each, stopping exactly at
 * `bars * grid` notes (the last cell is truncated if it does not fit evenly).
 */
export function spider(params: Partial<SpiderParams> = {}): string {
  const p: SpiderParams = { ...DEFAULT_SPIDER_PARAMS, ...params };
  const time = p.time ?? DEFAULT_SPIDER_PARAMS.time!;
  if (p.startFret < 1 || p.startFret > 20) {
    throw new Error(`spider: startFret must be 1..20, got ${p.startFret}`);
  }

  const totalSlots = p.bars * p.grid;
  const sequence: { string: StringNumber; fret: number }[] = [];
  let s = p.startStringPair;
  let fret = p.startFret;
  while (sequence.length < totalSlots) {
    const lo = s as StringNumber;
    const hi = (s + 2) as StringNumber;
    sequence.push({ string: lo, fret });
    sequence.push({ string: hi, fret });
    sequence.push({ string: lo, fret: fret + 1 });
    sequence.push({ string: hi, fret: fret + 1 });
    s = s + 1;
    if (s > 4) {
      s = 1;
      if (fret + 1 < 24) fret += 1;
    }
  }

  const title = `Spider ${p.fingerPairs}, fret ${p.startFret}, 1/${p.grid}`;

  return buildExerciseText({
    title,
    time,
    bpm: p.bpm,
    grid: p.grid,
    bars: p.bars,
    noteToken: (i) => {
      const n = sequence[i]!;
      return `${n.string}S${n.fret}`;
    },
  });
}
