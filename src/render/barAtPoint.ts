// Which bar is under a point on the sheet (touch loop selection: hold a bar number, drag to extend).
// Points are in sheet coordinates (relative to the sheet's inner box). A point outside every row or bar
// snaps to the nearest one, so dragging a finger through the gap between rows keeps extending the range.

import type { Layout } from "../layout";

export function barAtPoint(layout: Layout, x: number, y: number): number | null {
  if (layout.rows.length === 0) return null;
  let row = layout.rows[0];
  let bestDy = Infinity;
  for (const r of layout.rows) {
    const dy = y < r.y ? r.y - y : y > r.y + r.height ? y - (r.y + r.height) : 0;
    if (dy < bestDy) {
      bestDy = dy;
      row = r;
    }
  }
  if (row.bars.length === 0) return null;
  let best = row.bars[0];
  let bestDx = Infinity;
  for (const b of row.bars) {
    const dx = x < b.x ? b.x - x : x > b.x + b.width ? x - (b.x + b.width) : 0;
    if (dx < bestDx) {
      bestDx = dx;
      best = b;
    }
  }
  return best.barNumber;
}
