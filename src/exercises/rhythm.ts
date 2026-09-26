// Rhythm exercise generator (spec 12.1).

import type { StringNumber, TimeSignature } from "../model/index.js";
import { buildExerciseText } from "./textBuilder.js";

export type RhythmPresetName =
  | "quarters"
  | "eighths"
  | "triplets"
  | "sixteenths"
  | "offbeatEighths"
  | "gallop";

export interface RhythmPreset {
  /** Slots per bar this preset is defined against (assumes 4/4; the caller's
   * `time` only changes how long each slot is, not the pattern's shape). */
  grid: number;
  /** 1-based slots (within one bar of `grid` slots) that get a note. Repeats
   * identically in every bar. */
  slots: number[];
}

// "Gallop" is the classic long-short-short (eighth + two sixteenths) feel,
// repeated once per beat in 4/4 (4 sixteenth-slots per beat: slots 1,3,4).
const GALLOP_SLOTS = [1, 3, 4, 5, 7, 8, 9, 11, 12, 13, 15, 16];

export const RHYTHM_PRESETS: Record<RhythmPresetName, RhythmPreset> = {
  quarters: { grid: 4, slots: [1, 2, 3, 4] },
  eighths: { grid: 8, slots: [1, 2, 3, 4, 5, 6, 7, 8] },
  triplets: { grid: 12, slots: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12] },
  sixteenths: { grid: 16, slots: Array.from({ length: 16 }, (_, i) => i + 1) },
  offbeatEighths: { grid: 8, slots: [2, 4, 6, 8] },
  gallop: { grid: 16, slots: GALLOP_SLOTS },
};

/** A named preset, or a custom slot list against an explicit grid. */
export type RhythmPattern = RhythmPresetName | { grid: number; slots: number[] };

export interface RhythmParams {
  /** 1..6. Default 6 (low E), per the spec's "default 6S0 muted". */
  string: StringNumber;
  /** 0..24. Default 0. */
  fret: number;
  /** Default true - the classic muted-string rhythm-only exercise. */
  muted: boolean;
  pattern: RhythmPattern;
  /** 1..32. */
  bars: number;
  bpm: number;
  time?: TimeSignature;
}

export const DEFAULT_RHYTHM_PARAMS: RhythmParams = {
  string: 6,
  fret: 0,
  muted: true,
  pattern: "quarters",
  bars: 8,
  bpm: 100,
  time: { numerator: 4, denominator: 4 },
};

function resolvePattern(pattern: RhythmPattern): { grid: number; slots: number[]; label: string } {
  if (typeof pattern === "string") {
    const preset = RHYTHM_PRESETS[pattern];
    return { grid: preset.grid, slots: preset.slots, label: pattern };
  }
  return { grid: pattern.grid, slots: pattern.slots, label: "custom" };
}

/**
 * Rhythm exercise (spec 12.1): one fixed note (`string`/`fret`, muted by
 * default) repeated at every slot named in the pattern's `slots` list, once
 * per bar, for `bars` bars. `slots` is 1-based against the pattern's own
 * `grid` (e.g. "offbeatEighths" plays slots 2,4,6,8 of an 8-slot bar - the
 * "and" of each beat in 4/4). All other slots are silent. Each note is length
 * 1 unit (one slot); the rhythm is expressed purely through which slots are
 * onsets, not through note duration.
 */
export function rhythm(params: Partial<RhythmParams> = {}): string {
  const p: RhythmParams = { ...DEFAULT_RHYTHM_PARAMS, ...params };
  const time = p.time ?? DEFAULT_RHYTHM_PARAMS.time!;
  const { grid, slots, label } = resolvePattern(p.pattern);
  const slotSet = new Set(slots);
  if (p.string < 1 || p.string > 6) throw new Error(`rhythm: string must be 1..6, got ${p.string}`);
  if (p.fret < 0 || p.fret > 24) throw new Error(`rhythm: fret must be 0..24, got ${p.fret}`);

  const metaText = p.muted ? "(muted)" : "";
  const title = `Rhythm ${label}, ${p.string}S${p.fret}, 1/${grid}`;

  return buildExerciseText({
    title,
    time,
    bpm: p.bpm,
    grid,
    bars: p.bars,
    noteToken: (i) => {
      const slot = (i % grid) + 1;
      if (!slotSet.has(slot)) return null;
      return `${p.string}S${p.fret}${metaText}`;
    },
  });
}
