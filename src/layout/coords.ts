// Coordinate mapping helpers (module contract): tickToX, xToTick,
// rowIndexForTick. Each bar keeps a uniform pixel width (`pxPerBar`), and
// ticks map linearly within a bar's own tick range -- this stays correct
// even if a hand-built test Song gives bars differing tick lengths, and is
// equivalent to a whole-row-linear mapping for the common case (all bars
// sharing one time signature, so every bar in a row has equal length).

import type { Layout, Row } from "./types";

export function tickToX(row: Row, tick: number): number {
  const bars = row.bars;
  if (bars.length === 0) return row.x0;
  let target = bars[0];
  for (const b of bars) {
    if (tick >= b.startTick) target = b;
    else break;
  }
  const fraction = (tick - target.startTick) / target.lengthTicks;
  return target.x + fraction * target.width;
}

export function xToTick(row: Row, x: number): number {
  const bars = row.bars;
  if (bars.length === 0) return row.startTick;
  let target = bars[0];
  for (const b of bars) {
    if (x >= b.x) target = b;
    else break;
  }
  const fraction = (x - target.x) / target.width;
  return target.startTick + fraction * target.lengthTicks;
}

/** Binary search over row start ticks (spec 8.4). Negative tick clamps to
 * the first row; a tick past the song's end clamps to the last row. */
export function rowIndexForTick(layout: Layout, tick: number): number {
  const rows = layout.rows;
  if (rows.length === 0) return 0;
  if (tick < rows[0].startTick) return 0;
  if (tick >= rows[rows.length - 1].endTick) return rows.length - 1;

  let lo = 0;
  let hi = rows.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (rows[mid].startTick <= tick) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}
