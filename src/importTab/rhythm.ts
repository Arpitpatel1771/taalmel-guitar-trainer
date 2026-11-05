// Rhythm guess from column spacing (spec 5-11-song-import.md section 3.2).

import type { TimeSignature } from "../model/index.js";
import { WHOLE_NOTE_TICKS } from "../model/index.js";
import type { NoteEvent, RhythmOptions, TabBar, TimedBar } from "./types.js";

/** Length of one bar in ticks. */
export function barTicks(time: TimeSignature): number {
  return (WHOLE_NOTE_TICKS * time.numerator) / time.denominator;
}

/** True when a bar of this time signature divides into `slots` whole-tick slots. */
export function slotsDivideBar(time: TimeSignature, slots: number): boolean {
  return Number.isInteger(slots) && slots >= 1 && Number.isInteger(barTicks(time) / slots);
}

/**
 * Places strictly increasing slots (0-based) as close to `ideals` as possible.
 * Forward pass nudges collisions to the next free slot; if that overflows the bar
 * a backward pass pulls the tail back in. Returns null when `ideals.length > n`.
 */
export function assignMonotone(ideals: number[], n: number): number[] | null {
  if (ideals.length > n) return null;
  const out: number[] = [];
  for (let i = 0; i < ideals.length; i++) {
    const lo = i === 0 ? 0 : out[i - 1]! + 1;
    out.push(Math.max(lo, Math.min(ideals[i]!, n - 1)));
  }
  if (out.length > 0 && out[out.length - 1]! > n - 1) {
    out[out.length - 1] = n - 1;
  }
  for (let i = out.length - 2; i >= 0; i--) {
    if (out[i]! >= out[i + 1]!) out[i] = out[i + 1]! - 1;
  }
  return out;
}

/**
 * Assigns each tab event a slot by its proportional position inside its bar,
 * snapped to the grid. Bars use `unit` slots; when a bar has more events than
 * slots the grid is doubled (until the slot count divides the bar's ticks).
 * One TimedBar per tab bar, in order.
 */
export function guessRhythm(events: NoteEvent[], bars: TabBar[], opts: RhythmOptions): TimedBar[] {
  if (!slotsDivideBar(opts.time, opts.unit)) {
    throw new Error(`unit ${opts.unit} does not divide a ${opts.time.numerator}/${opts.time.denominator} bar`);
  }
  return bars.map((bar) => {
    const inBar = events.filter((e) => e.bar === bar.index).sort((a, b) => a.column - b.column);
    const width = Math.max(1, bar.endColumn - bar.startColumn);
    let n = opts.unit;
    for (let k = 0; k <= 6; k++, n *= 2) {
      if (!slotsDivideBar(opts.time, n)) continue;
      const ideals = inBar.map((e) => Math.round(((e.column - bar.startColumn) / width) * n));
      const slots = assignMonotone(ideals, n);
      if (slots) {
        return {
          slots: n,
          events: inBar.map((e, i) => ({ slot: slots[i]! + 1, notes: e.notes })),
        };
      }
    }
    throw new Error(`bar ${bar.index + 1} has too many note events (${inBar.length}) for any grid`);
  });
}

/**
 * Spec 3.4: events with no spacing information (fretboard entry). One event per
 * slot in order, `unit` events per bar.
 */
export function sequentialRhythm(events: NoteEvent[], opts: RhythmOptions): TimedBar[] {
  if (!slotsDivideBar(opts.time, opts.unit)) {
    throw new Error(`unit ${opts.unit} does not divide a ${opts.time.numerator}/${opts.time.denominator} bar`);
  }
  const out: TimedBar[] = [];
  for (let i = 0; i < events.length; i += opts.unit) {
    out.push({
      slots: opts.unit,
      events: events.slice(i, i + opts.unit).map((e, k) => ({ slot: k + 1, notes: e.notes })),
    });
  }
  return out;
}
