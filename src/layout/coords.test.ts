import { describe, expect, it } from "vitest";
import { computeLayout } from "./computeLayout";
import { rowIndexForTick, tickToX, xToTick } from "./coords";
import { makeSong } from "../tempo/testSongs";
import { ROW_LEFT_PADDING } from "./constants";
import type { LaneId } from "../model";

const ALL_LANES_ON: Record<LaneId, boolean> = { tab: true, letter: true, teacher: true };

describe("tickToX: linearity within a row", () => {
  it("is linear within a single bar", () => {
    const song = makeSong([{ bpm: 120, bars: 1 }]); // 3840 ticks, pxPerBar 240
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: ALL_LANES_ON });
    const row = layout.rows[0];
    expect(tickToX(row, 0)).toBeCloseTo(ROW_LEFT_PADDING, 10);
    expect(tickToX(row, 1920)).toBeCloseTo(ROW_LEFT_PADDING + 120, 10); // halfway
    expect(tickToX(row, 3840)).toBeCloseTo(ROW_LEFT_PADDING + 240, 10); // bar end
    expect(tickToX(row, 960)).toBeCloseTo(ROW_LEFT_PADDING + 60, 10); // quarter way
  });

  it("is linear across a bar boundary within the same row", () => {
    const song = makeSong([{ bpm: 120, bars: 2 }]);
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: ALL_LANES_ON });
    const row = layout.rows[0];
    expect(tickToX(row, 3840)).toBeCloseTo(ROW_LEFT_PADDING + 240, 10); // start of bar 2
    expect(tickToX(row, 3840 + 1920)).toBeCloseTo(ROW_LEFT_PADDING + 240 + 120, 10);
  });

  it("gives every bar equal pixel width even when slot counts differ", () => {
    const song = makeSong([{ bpm: 120, bars: 2, slots: 16 }]);
    song.sections[0].bars[1].slots = 3;
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: ALL_LANES_ON });
    const row = layout.rows[0];
    // Same fractional position (50%) into each bar should land 120px into
    // that bar's box regardless of its slot count.
    expect(tickToX(row, 1920) - tickToX(row, 0)).toBeCloseTo(120, 10);
    expect(tickToX(row, 3840 + 1920) - tickToX(row, 3840)).toBeCloseTo(120, 10);
  });
});

describe("xToTick: inverse of tickToX", () => {
  it("round-trips through tickToX for points within the row", () => {
    const song = makeSong([{ bpm: 120, bars: 3 }]);
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: ALL_LANES_ON });
    const row = layout.rows[0];
    for (const tick of [0, 500, 1920, 3839, 3840, 5760, 3 * 3840 - 1]) {
      const x = tickToX(row, tick);
      expect(xToTick(row, x)).toBeCloseTo(tick, 5);
    }
  });
});

describe("rowIndexForTick", () => {
  const song = makeSong([{ bpm: 120, bars: 6 }]); // 3840 ticks/bar, 4 bars/row @1000w/240zoom
  const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: ALL_LANES_ON });
  // row0: [0, 4*3840=15360), row1: [15360, 6*3840=23040)

  it("clamps a negative tick to row 0", () => {
    expect(rowIndexForTick(layout, -1000)).toBe(0);
  });

  it("finds the row containing a tick strictly inside it", () => {
    expect(rowIndexForTick(layout, 100)).toBe(0);
    expect(rowIndexForTick(layout, 16000)).toBe(1);
  });

  it("resolves the exact boundary tick to the next row (right-inclusive start)", () => {
    expect(rowIndexForTick(layout, 15359)).toBe(0);
    expect(rowIndexForTick(layout, 15360)).toBe(1);
  });

  it("clamps a tick past the song's end to the last row", () => {
    expect(rowIndexForTick(layout, 999999)).toBe(layout.rows.length - 1);
  });

  it("returns 0 for an empty layout", () => {
    const emptySong = makeSong([]);
    const emptyLayout = computeLayout(emptySong, {
      viewportWidth: 1000,
      zoom: 240,
      lanes: ALL_LANES_ON,
    });
    expect(emptyLayout.rows).toHaveLength(0);
    expect(rowIndexForTick(emptyLayout, 500)).toBe(0);
  });
});
