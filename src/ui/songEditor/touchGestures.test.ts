import { describe, expect, it } from "vitest";
import {
  DOUBLE_TAP_MS,
  DOUBLE_TAP_SLOP,
  LONG_PRESS_SLOP,
  isDoubleTap,
  midpoint,
  movedPastSlop,
  panScroll,
  pinchScale,
  pinchScrollX,
  pinchZoom,
} from "./touchGestures";

describe("long-press movement tolerance", () => {
  it("holds still within 8px", () => {
    expect(movedPastSlop({ x: 100, y: 100 }, { x: 105, y: 106 })).toBe(false);
    expect(movedPastSlop({ x: 0, y: 0 }, { x: LONG_PRESS_SLOP, y: 0 })).toBe(false);
  });
  it("is a drag beyond it", () => {
    expect(movedPastSlop({ x: 0, y: 0 }, { x: 9, y: 0 })).toBe(true);
    expect(movedPastSlop({ x: 0, y: 0 }, { x: 6, y: 6 })).toBe(true);
  });
});

describe("isDoubleTap", () => {
  const a = { t: 1000, x: 50, y: 50 };
  it("needs a previous tap", () => expect(isDoubleTap(null, a)).toBe(false));
  it("accepts a quick tap nearby", () => expect(isDoubleTap(a, { t: 1250, x: 60, y: 58 })).toBe(true));
  it("rejects a slow second tap", () => expect(isDoubleTap(a, { t: 1000 + DOUBLE_TAP_MS, x: 50, y: 50 })).toBe(false));
  it("rejects a second tap far away", () => expect(isDoubleTap(a, { t: 1100, x: 50 + DOUBLE_TAP_SLOP + 1, y: 50 })).toBe(false));
  it("rejects a tap that is earlier than the first", () => expect(isDoubleTap(a, { t: 900, x: 50, y: 50 })).toBe(false));
});

describe("pinch", () => {
  const a0 = { x: 100, y: 100 };
  const b0 = { x: 200, y: 100 };
  it("scale > 1 when the fingers spread", () => expect(pinchScale(a0, b0, { x: 50, y: 100 }, { x: 250, y: 100 })).toBe(2));
  it("scale < 1 when they pinch together", () => expect(pinchScale(a0, b0, { x: 125, y: 100 }, { x: 175, y: 100 })).toBe(0.5));
  it("works diagonally", () => expect(pinchScale(a0, b0, { x: 100, y: 100 }, { x: 100, y: 200 })).toBe(1));
  it("is 1 when the fingers started on the same point", () => expect(pinchScale(a0, a0, a0, b0)).toBe(1));
  it("midpoint", () => expect(midpoint(a0, b0)).toEqual({ x: 150, y: 100 }));
  it("zoom follows the scale within limits", () => {
    expect(pinchZoom(18, 2, 8, 64)).toBe(36);
    expect(pinchZoom(18, 10, 8, 64)).toBe(64);
    expect(pinchZoom(18, 0.1, 8, 64)).toBe(8);
    expect(pinchZoom(18, 1.2345, 8, 64)).toBe(22.22);
  });
  it("keeps the grabbed tick under the fingers", () => {
    // the grabbed tick 480 sits 60px into the grid at 0.2 px/tick: scroll so it stays there
    expect(pinchScrollX(480, 0.2, 60)).toBeCloseTo(36);
    expect(pinchScrollX(10, 0.2, 60)).toBe(0);
  });
});

describe("panScroll", () => {
  it("content follows the fingers", () => expect(panScroll(500, 40)).toBe(460));
  it("never goes negative", () => expect(panScroll(10, 40)).toBe(0));
});
