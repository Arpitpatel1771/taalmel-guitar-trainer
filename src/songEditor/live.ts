// Live record helpers (spec 4): the N key while the song plays.

import { snapTick } from "./snap.js";
import { barLengthTicks } from "./doc.js";
import { addNote, moveNotes } from "./ops.js";
import type { EdDoc, OpResult } from "./types.js";

/**
 * Moves the next note (and any chord partners sharing its start) at or after the playhead to the
 * tap time, snapped. `lookbackTicks` also accepts a note that starts a
 * little before the playhead (a late tap). Refused when no note follows.
 */
export function placeNextAt(doc: EdDoc, playheadTick: number, snapTicks: number, lookbackTicks = 0): OpResult {
  const from = playheadTick - lookbackTicks;
  let start: number | undefined;
  for (const n of doc.notes) if (n.startTick >= from && (start === undefined || n.startTick < start)) start = n.startTick;
  if (start === undefined) return { doc, refused: true, message: "No note after the playhead." };
  const group = doc.notes.filter((n) => n.startTick === start).map((n) => n.id);
  const target = snapTick(Math.max(0, playheadTick), snapTicks, barLengthTicks(doc));
  if (target === start) return { doc, ids: group };
  return moveNotes(doc, group, { dTicks: target - start });
}

/** Adds a note at the playhead (snapped when `snapTicks` is given). */
export function addAtPlayhead(doc: EdDoc, playheadTick: number, midi: number, lengthTicks: number, snapTicks?: number): OpResult {
  const tick = snapTicks ? snapTick(Math.max(0, playheadTick), snapTicks, barLengthTicks(doc)) : Math.max(0, Math.round(playheadTick));
  return addNote(doc, { startTick: tick, midi, durationTicks: lengthTicks });
}
