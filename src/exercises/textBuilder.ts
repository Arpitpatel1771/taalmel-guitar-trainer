// Shared song-text builder for exercise generators (spec 12.1). Each generator
// reduces to: pick a title, a time signature/bpm/grid, a bar count, and a
// function from a global (0-based) slot index to a note token or silence.
// This module turns that into valid song-format text with a single
// `[Exercise]` section and one bar per `Bar <k>:` line.

import type { TimeSignature } from "../model/index.js";
import { WHOLE_NOTE_TICKS } from "../model/index.js";

export interface BuildExerciseTextOptions {
  title: string;
  time: TimeSignature;
  bpm: number;
  /** Slots per bar. Must divide the bar's tick length evenly (spec 5.5). */
  grid: number;
  bars: number;
  /**
   * Called once per slot, 0-based across the whole song (bar 1 slot 1 = index
   * 0, bar 1 slot 2 = index 1, ..., bar 2 slot 1 = index `grid`, ...). Returns
   * the note token(s) to place at that slot (space-separated for a chord), or
   * null for silence (no slot marker is written).
   */
  noteToken: (globalSlot: number) => string | null;
}

/** Builds valid song-format text (spec 5) for an exercise. Throws a plain
 * `Error` (not a `ParseError`) for parameter combinations that could never
 * produce valid text, such as a grid that does not divide the bar evenly. */
export function buildExerciseText(opts: BuildExerciseTextOptions): string {
  if (!Number.isInteger(opts.bars) || opts.bars < 1) {
    throw new Error(`exercise: bars must be a positive integer, got ${opts.bars}`);
  }
  if (!Number.isInteger(opts.grid) || opts.grid < 1) {
    throw new Error(`exercise: grid must be a positive integer, got ${opts.grid}`);
  }
  const barTicks = opts.time.numerator * (WHOLE_NOTE_TICKS / opts.time.denominator);
  if (barTicks % opts.grid !== 0) {
    throw new Error(
      `exercise: grid ${opts.grid} does not divide a ${opts.time.numerator}/${opts.time.denominator} bar (${barTicks} ticks) evenly`,
    );
  }

  const lines: string[] = [];
  lines.push(`title: ${opts.title}`);
  lines.push(`time: ${opts.time.numerator}/${opts.time.denominator}`);
  lines.push(`bpm: ${opts.bpm}`);
  lines.push(`unit: ${opts.grid}`);
  lines.push("");
  lines.push("[Exercise]");

  let globalSlot = 0;
  for (let bar = 1; bar <= opts.bars; bar++) {
    const parts: string[] = [];
    for (let slot = 1; slot <= opts.grid; slot++) {
      const token = opts.noteToken(globalSlot);
      if (token) parts.push(`{${slot}} ${token}`);
      globalSlot++;
    }
    lines.push(`Bar ${bar}:${parts.length > 0 ? " " + parts.join(" ") : ""}`);
  }
  lines.push("");
  return lines.join("\n");
}
