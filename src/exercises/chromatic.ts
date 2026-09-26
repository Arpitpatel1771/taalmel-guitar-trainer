// Chromatic exercise generator (spec 12.1).

import type { StringNumber, TimeSignature } from "../model/index.js";
import { buildExerciseText } from "./textBuilder.js";

export type ChromaticGrid = 4 | 8 | 12 | 16;
export type ChromaticDirection = "ascending" | "descending" | "both";

export interface ChromaticParams {
  /** 1..20. Frets used are `startFret + (finger - 1)` for finger 1..4, so the
   * highest fret played is `startFret + 3`, kept within 0..24. */
  startFret: number;
  /** Strings to traverse, in the order to play them (e.g. [6,5,4,3,2,1] for
   * low-to-high, [1,2,3,4,5,6] for high-to-low; any subset/order is valid). */
  strings: StringNumber[];
  /** A 4-digit permutation of "1234" (e.g. "1234", "1324", "1243", "4321").
   * Digit `d` at position `i` means finger `d` is the `i`-th note played,
   * fretted at `startFret + (d - 1)`. */
  pattern: string;
  grid: ChromaticGrid;
  /** 1..32. */
  bars: number;
  direction: ChromaticDirection;
  bpm: number;
  time?: TimeSignature;
}

export const DEFAULT_CHROMATIC_PARAMS: ChromaticParams = {
  startFret: 1,
  strings: [6, 5, 4, 3, 2, 1],
  pattern: "1234",
  grid: 4,
  bars: 6,
  direction: "ascending",
  bpm: 100,
  time: { numerator: 4, denominator: 4 },
};

function patternFrets(pattern: string, startFret: number): number[] {
  if (!/^[1-4]{4}$/.test(pattern) || new Set(pattern).size !== 4) {
    throw new Error(`chromatic: pattern must be a 4-digit permutation of 1234, got '${pattern}'`);
  }
  return pattern.split("").map((d) => startFret + (Number(d) - 1));
}

/**
 * Chromatic exercise (spec 12.1).
 *
 * For each string in `strings` (in the given order), plays the 4 frets
 * `startFret + (finger - 1)` in the order given by `pattern` (e.g. pattern
 * "1324" on startFret 5 plays frets 5, 7, 6, 8 - finger 1 then 3 then 2 then 4).
 *
 * `direction` controls the fret order within each string's run:
 *   - "ascending":  the pattern's frets as-is (4 notes per string).
 *   - "descending": the pattern's frets reversed (4 notes per string).
 *   - "both":       the ascending run immediately followed by the descending
 *                    run (8 notes per string).
 *
 * The per-string runs are concatenated in `strings` order into one sequence,
 * which is then laid out one note per slot (length 1 unit each) across `bars`
 * bars of `grid` slots each. If the sequence is shorter than the number of
 * slots to fill it repeats from the start; if longer, it is truncated.
 */
export function chromatic(params: Partial<ChromaticParams> = {}): string {
  const p: ChromaticParams = { ...DEFAULT_CHROMATIC_PARAMS, ...params };
  const time = p.time ?? DEFAULT_CHROMATIC_PARAMS.time!;
  if (p.strings.length === 0) throw new Error("chromatic: strings must not be empty");
  if (p.startFret < 1 || p.startFret > 20) {
    throw new Error(`chromatic: startFret must be 1..20, got ${p.startFret}`);
  }

  const ascendingFrets = patternFrets(p.pattern, p.startFret);
  const descendingFrets = [...ascendingFrets].reverse();
  const runFrets =
    p.direction === "ascending"
      ? ascendingFrets
      : p.direction === "descending"
        ? descendingFrets
        : [...ascendingFrets, ...descendingFrets];

  const sequence: { string: StringNumber; fret: number }[] = [];
  for (const s of p.strings) {
    for (const fret of runFrets) {
      sequence.push({ string: s, fret });
    }
  }

  const title = `Chromatic ${p.pattern}, fret ${p.startFret}, 1/${p.grid}`;

  return buildExerciseText({
    title,
    time,
    bpm: p.bpm,
    grid: p.grid,
    bars: p.bars,
    noteToken: (i) => {
      const cell = sequence[i % sequence.length]!;
      return `${cell.string}S${cell.fret}`;
    },
  });
}
