// Snap values of the roll's Snap menu, as ticks.

import { PPQ } from "../model/index.js";

export type SnapId = "1/4" | "1/8" | "1/16" | "1/8T" | "1/16T" | "off";

export const SNAP_TICKS: Record<SnapId, number> = {
  "1/4": PPQ,
  "1/8": PPQ / 2,
  "1/16": PPQ / 4,
  "1/8T": PPQ / 3,
  "1/16T": PPQ / 6,
  off: PPQ / 16, // 1/64 note
};

/** Snaps `tick` to the nearest multiple of `snapTicks` counted from the start of its bar. */
export function snapTick(tick: number, snapTicks: number, barLengthTicks: number): number {
  const barStart = Math.floor(tick / barLengthTicks) * barLengthTicks;
  return barStart + Math.round((tick - barStart) / snapTicks) * snapTicks;
}

/** Length values of the inspector buttons. Whole note = 3840 ticks. */
export const LENGTH_VALUES = { "1/16": PPQ / 4, "1/8": PPQ / 2, "1/4": PPQ, "1/2": PPQ * 2, "1": PPQ * 4 } as const;
export type LengthId = keyof typeof LENGTH_VALUES;

export function lengthTicks(id: LengthId, dotted = false): number {
  const base = LENGTH_VALUES[id];
  return dotted ? (base * 3) / 2 : base;
}

/** Shortest note: a 1/64 resize step. */
export const MIN_NOTE_TICKS = PPQ / 16;
/** Shortest length "Cut short" goes to: 1/32. */
export const MIN_CUT_TICKS = PPQ / 8;
