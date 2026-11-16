import { describe, expect, it } from "vitest";
import type { Layout } from "../layout";
import { barAtPoint } from "./barAtPoint";

function bar(barNumber: number, x: number, width: number) {
  return { barNumber, x, width, startTick: 0, lengthTicks: 3840, capo: 0, gridXs: [x, x + width] };
}
const row = (index: number, y: number, bars: ReturnType<typeof bar>[]) =>
  ({ index, y, height: 100, startTick: 0, endTick: 0, x0: bars[0].x, bars, notes: [], laneOffsets: {} }) as Layout["rows"][number];

const layout = {
  rows: [row(0, 0, [bar(1, 20, 100), bar(2, 120, 100)]), row(1, 120, [bar(3, 20, 100)])],
  totalHeight: 220,
  width: 240,
  laneHeights: { tab: 0, letter: 0 },
} as Layout;

describe("barAtPoint", () => {
  it("finds the bar under the point", () => {
    expect(barAtPoint(layout, 30, 50)).toBe(1);
    expect(barAtPoint(layout, 150, 50)).toBe(2);
    expect(barAtPoint(layout, 50, 150)).toBe(3);
  });
  it("snaps to the nearest row and bar outside them", () => {
    expect(barAtPoint(layout, 5, 50)).toBe(1);
    expect(barAtPoint(layout, 500, 50)).toBe(2);
    expect(barAtPoint(layout, 150, 112)).toBe(3); // the gap, closer to row 1 (y 120)
    expect(barAtPoint(layout, 50, -30)).toBe(1);
    expect(barAtPoint(layout, 50, 900)).toBe(3);
  });
  it("is null without rows", () => {
    expect(barAtPoint({ ...layout, rows: [] }, 0, 0)).toBeNull();
  });
});
