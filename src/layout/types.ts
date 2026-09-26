// Layout data types (module contract in plans/26-9-impl-plan.md).

import type { LaneId, Note } from "../model";

export interface BarBox {
  barNumber: number;
  x: number;
  width: number;
  startTick: number;
  lengthTicks: number;
  /** x of each slot boundary, including the bar's start and end (length = slots + 1). */
  gridXs: number[];
}

export interface NoteBox {
  note: Note;
  x: number;
  width: number;
  /** 0 = string 1 (top, high E). */
  stringIndex: number;
}

export interface Row {
  index: number;
  y: number;
  height: number;
  startTick: number;
  endTick: number;
  /** Left edge of the row's bars; includes the reserved label padding. */
  x0: number;
  bars: BarBox[];
  notes: NoteBox[];
  laneOffsets: Partial<Record<LaneId, number>>;
}

export interface Layout {
  rows: Row[];
  totalHeight: number;
  width: number;
  laneHeights: Record<LaneId, number>;
}
