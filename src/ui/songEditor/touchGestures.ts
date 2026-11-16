// Pure maths of the roll's touch gestures (specs/8-11-mobile.md §2 stage 4): long-press, double-tap and
// two-finger pinch/pan. No DOM; RollCanvas feeds it pointer positions and times.

/** A finger that stays within this many px of where it landed is still "holding still". */
export const LONG_PRESS_SLOP = 8;
/** How long a finger holds still on a note before it counts as a long-press (what right-click does). */
export const LONG_PRESS_MS = 500;
/** Two taps this close in time and place make a double-tap (what double-click does). */
export const DOUBLE_TAP_MS = 300;
export const DOUBLE_TAP_SLOP = 24;
/** Wider resize handle and a little vertical slack for a finger (a mouse keeps the exact geometry). */
export const TOUCH_HANDLE_W = 16;
export const TOUCH_HIT_SLOP_Y = 3;

export interface Pt {
  x: number;
  y: number;
}

export interface TapStamp extends Pt {
  t: number;
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a.x - b.x, a.y - b.y);

/** True once a finger has moved further than `slop` from where it landed (so it is a drag, not a hold or tap). */
export function movedPastSlop(from: Pt, to: Pt, slop: number = LONG_PRESS_SLOP): boolean {
  return dist(from, to) > slop;
}

/** True when `cur` lands soon enough and near enough after the previous tap. */
export function isDoubleTap(prev: TapStamp | null, cur: TapStamp): boolean {
  return !!prev && cur.t - prev.t >= 0 && cur.t - prev.t < DOUBLE_TAP_MS && dist(prev, cur) <= DOUBLE_TAP_SLOP;
}

export function midpoint(a: Pt, b: Pt): Pt {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/** How much two fingers have spread (>1) or pinched (<1) since they landed. 1 when they started on one point. */
export function pinchScale(a0: Pt, b0: Pt, a1: Pt, b1: Pt): number {
  const d0 = dist(a0, b0);
  return d0 < 1 ? 1 : dist(a1, b1) / d0;
}

/** The time zoom after a pinch, kept within the roll's limits and to two decimals so it doesn't churn. */
export function pinchZoom(zoom0: number, scale: number, min: number, max: number): number {
  return Math.round(Math.max(min, Math.min(max, zoom0 * scale)) * 100) / 100;
}

/**
 * Horizontal scroll that keeps the tick the fingers grabbed under the fingers' midpoint, whatever the zoom:
 * `anchorTick` is the tick under the midpoint when the pinch began, `gridX` where the midpoint is now (px from the grid's left edge).
 */
export function pinchScrollX(anchorTick: number, pxPerTick: number, gridX: number): number {
  return Math.max(0, anchorTick * pxPerTick - gridX);
}

/** Scroll position that follows two fingers dragging by `delta` (content moves with the fingers). */
export function panScroll(scroll0: number, delta: number): number {
  return Math.max(0, scroll0 - delta);
}
