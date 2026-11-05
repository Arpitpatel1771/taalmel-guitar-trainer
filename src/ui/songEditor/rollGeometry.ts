// Pure geometry of the piano roll: tick <-> pixel, rows and lanes, hit testing, box selection and
// the translation of a mouse drag into an editor operation. No DOM.

import { PPQ } from "../../model";
import {
  ROLL_MAX_MIDI,
  ROLL_MIN_MIDI,
  barLengthTicks,
  moveNotes,
  noteMidi,
  resizeNotes,
  shiftStrings,
  snapTick,
  type EdDoc,
  type EdNote,
  type OpResult,
} from "../../songEditor";

export type RollView = "pitch" | "strings";

export const RULER_H = 52;
export const KEY_W = 60;
export const LANE_H = 40;
export const HANDLE_W = 7;
export const MIN_ZOOM = 8;
export const MAX_ZOOM = 64;
export const DEFAULT_ZOOM = 18;
/** Width the opening zoom gives the song's short notes, so their fret numbers can be read. */
const READABLE_NOTE_PX = 30;
export const MIN_ROW = 12;
export const MAX_ROW = 22;
/** Mouse movement (px) before a press becomes a drag. */
export const DRAG_THRESHOLD = 3;

export interface Geom {
  pxPerTick: number;
  rowH: number;
  view: RollView;
}

/** `zoom` = pixels per 1/16 note. */
export function makeGeom(zoom: number, rowH: number, view: RollView): Geom {
  return { pxPerTick: zoom / (PPQ / 4), rowH, view };
}

/** Opening zoom for a song: wide enough that nearly all its notes (all but the shortest tenth) are readable. */
export function fitZoom(doc: EdDoc): number {
  const lengths = doc.notes.map((n) => n.durationTicks).sort((a, b) => a - b);
  if (lengths.length === 0) return DEFAULT_ZOOM;
  const short = lengths[Math.floor((lengths.length - 1) * 0.1)];
  const zoom = Math.ceil((READABLE_NOTE_PX * (PPQ / 4)) / Math.max(1, short));
  return Math.max(DEFAULT_ZOOM, Math.min(MAX_ZOOM, zoom));
}

export function gridHeight(g: Geom): number {
  return g.view === "pitch" ? (ROLL_MAX_MIDI - ROLL_MIN_MIDI + 1) * g.rowH : 6 * LANE_H;
}

/** Width of the scrollable grid: the song plus two spare bars to draw into. */
export function gridWidth(doc: EdDoc, g: Geom): number {
  return Math.ceil((doc.bars.length + 2) * barLengthTicks(doc) * g.pxPerTick);
}

export const tickToX = (g: Geom, tick: number): number => tick * g.pxPerTick;
export const xToTick = (g: Geom, x: number): number => x / g.pxPerTick;

export function rowTop(g: Geom, midi: number): number {
  return (ROLL_MAX_MIDI - midi) * g.rowH;
}

export function laneTop(string: number): number {
  return (string - 1) * LANE_H;
}

/** MIDI row under a grid y (clamped to the roll). */
export function midiAtY(g: Geom, y: number): number {
  return Math.max(ROLL_MIN_MIDI, Math.min(ROLL_MAX_MIDI, ROLL_MAX_MIDI - Math.floor(y / g.rowH)));
}

export function stringAtY(y: number): 1 | 2 | 3 | 4 | 5 | 6 {
  return Math.max(1, Math.min(6, 1 + Math.floor(y / LANE_H))) as 1 | 2 | 3 | 4 | 5 | 6;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Block of a note in grid pixels. */
export function noteRect(g: Geom, doc: EdDoc, n: EdNote): Rect {
  const x = tickToX(g, n.startTick) + 1;
  const w = Math.max(6, n.durationTicks * g.pxPerTick - 2);
  if (g.view === "pitch") return { x, y: rowTop(g, noteMidi(doc, n)) + 1, w, h: g.rowH - 2 };
  return { x, y: laneTop(n.string) + 7, w, h: LANE_H - 14 };
}

export type HitZone = "body" | "resize";
export interface Hit {
  id: number;
  zone: HitZone;
}

/** The topmost note under a grid point; the right edge is the resize handle. */
export function hitTest(g: Geom, doc: EdDoc, x: number, y: number): Hit | null {
  for (let i = doc.notes.length - 1; i >= 0; i--) {
    const n = doc.notes[i]!;
    const r = noteRect(g, doc, n);
    if (x < r.x || x > r.x + r.w || y < r.y || y > r.y + r.h) continue;
    return { id: n.id, zone: x >= r.x + r.w - Math.min(HANDLE_W, r.w / 2) ? "resize" : "body" };
  }
  return null;
}

/** Ids of the notes whose blocks touch a grid rectangle. */
export function notesInBox(g: Geom, doc: EdDoc, box: Rect): number[] {
  const out: number[] = [];
  for (const n of doc.notes) {
    const r = noteRect(g, doc, n);
    if (r.x + r.w >= box.x && r.x <= box.x + box.w && r.y + r.h >= box.y && r.y <= box.y + box.h) out.push(n.id);
  }
  return out;
}

export interface DragInput {
  mode: "move" | "resize";
  ids: readonly number[];
  /** The note the mouse grabbed; its edge decides the snapping. */
  anchorId: number;
  dxPx: number;
  dyPx: number;
  snapTicks: number;
  /** Alt held: no snapping. */
  free: boolean;
}

/** What a drag does, as an editor operation on the document as it was when the drag began. */
export function applyDrag(start: EdDoc, g: Geom, d: DragInput): OpResult {
  const anchor = start.notes.find((n) => n.id === d.anchorId);
  if (!anchor) return { doc: start, refused: true, message: "Nothing selected." };
  const barLen = barLengthTicks(start);
  const snap = (tick: number): number => (d.free ? Math.round(tick) : snapTick(tick, d.snapTicks, barLen));
  if (d.mode === "resize") {
    const end = anchor.startTick + anchor.durationTicks;
    return resizeNotes(start, d.ids, snap(end + d.dxPx / g.pxPerTick) - end);
  }
  const dTicks = snap(anchor.startTick + d.dxPx / g.pxPerTick) - anchor.startTick;
  if (g.view === "pitch") return moveNotes(start, d.ids, { dTicks, dSemis: -Math.round(d.dyPx / g.rowH) });
  const timed = moveNotes(start, d.ids, { dTicks });
  if (timed.refused) return timed;
  const dStrings = Math.round(d.dyPx / LANE_H);
  if (dStrings === 0) return timed;
  const strung = shiftStrings(timed.doc, d.ids, dStrings);
  if (strung.refused) return strung;
  return { ...strung, message: [timed.message, strung.message].filter(Boolean).join(" ") || undefined };
}

/** Where the Draw tool puts a note and how long it is (click = `defaultLength`, drag = the dragged span). */
export function drawSpan(
  g: Geom,
  doc: EdDoc,
  x0: number,
  x1: number,
  snapTicks: number,
  defaultLength: number,
  dragged: boolean,
): { startTick: number; durationTicks: number } {
  const barLen = barLengthTicks(doc);
  const startTick = Math.max(0, snapTick(xToTick(g, x0), snapTicks, barLen));
  if (!dragged) return { startTick, durationTicks: defaultLength };
  const endTick = snapTick(xToTick(g, x1), snapTicks, barLen);
  return { startTick, durationTicks: Math.max(snapTicks, endTick - startTick) };
}
