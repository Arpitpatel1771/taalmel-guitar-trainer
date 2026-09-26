import { describe, expect, it } from "vitest";
import { computeLayout } from "./computeLayout";
import { makeSong, addNote } from "../tempo/testSongs";
import {
  LETTER_LANE_HEIGHT,
  ROW_LEFT_PADDING,
  TAB_LANE_HEIGHT,
  TEACHER_LANE_HEIGHT,
} from "./constants";
import type { LaneId } from "../model";

const ALL_LANES_ON: Record<LaneId, boolean> = { tab: true, letter: true, teacher: true };
const TAB_AND_LETTER: Record<LaneId, boolean> = { tab: true, letter: true, teacher: false };
const NO_LANES: Record<LaneId, boolean> = { tab: false, letter: false, teacher: false };

describe("computeLayout: bars per row at various widths/zooms", () => {
  it("fits floor(availableWidth / pxPerBar) bars per row, minimum 1", () => {
    const song = makeSong([{ bpm: 120, bars: 10 }]);
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: ALL_LANES_ON });
    // availableWidth = 1000 - 32 = 968; floor(968/240) = 4
    expect(layout.rows[0].bars).toHaveLength(4);
    expect(layout.rows[1].bars).toHaveLength(4);
    expect(layout.rows[2].bars).toHaveLength(2); // remaining 2 bars
    expect(layout.rows).toHaveLength(3);
  });

  it("clamps to at least 1 bar per row when the viewport is too narrow", () => {
    const song = makeSong([{ bpm: 120, bars: 3 }]);
    const layout = computeLayout(song, { viewportWidth: 200, zoom: 240, lanes: ALL_LANES_ON });
    expect(layout.rows[0].bars).toHaveLength(1);
    expect(layout.rows).toHaveLength(3);
  });

  it("clamps zoom to the [120, 800] range", () => {
    const song = makeSong([{ bpm: 120, bars: 1 }]);
    const tooSmall = computeLayout(song, { viewportWidth: 2000, zoom: 10, lanes: ALL_LANES_ON });
    expect(tooSmall.rows[0].bars[0].width).toBe(120);
    const tooBig = computeLayout(song, { viewportWidth: 2000, zoom: 5000, lanes: ALL_LANES_ON });
    expect(tooBig.rows[0].bars[0].width).toBe(800);
  });

  it("all bars have the same pixel width regardless of slot count", () => {
    const song = makeSong([{ bpm: 120, bars: 2, slots: 16 }]);
    // Override the second bar's slot count to something different.
    song.sections[0].bars[1].slots = 3;
    const layout = computeLayout(song, { viewportWidth: 2000, zoom: 240, lanes: ALL_LANES_ON });
    expect(layout.rows[0].bars[0].width).toBe(240);
    expect(layout.rows[0].bars[1].width).toBe(240);
  });
});

describe("computeLayout: row boundaries", () => {
  it("sets each row's startTick/endTick from its first and last bar", () => {
    const song = makeSong([{ bpm: 120, bars: 6 }]); // 3840 ticks/bar
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: ALL_LANES_ON });
    // 4 bars per row (as above)
    expect(layout.rows[0].startTick).toBe(0);
    expect(layout.rows[0].endTick).toBe(4 * 3840);
    expect(layout.rows[1].startTick).toBe(4 * 3840);
    expect(layout.rows[1].endTick).toBe(6 * 3840);
  });

  it("stacks row y-offsets using row height + ROW_GAP, and totalHeight matches", () => {
    const song = makeSong([{ bpm: 120, bars: 8 }]);
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: TAB_AND_LETTER });
    expect(layout.rows[0].y).toBe(0);
    const expectedRowHeight = TAB_LANE_HEIGHT + LETTER_LANE_HEIGHT;
    expect(layout.rows[0].height).toBe(expectedRowHeight);
    expect(layout.rows[1].y).toBe(expectedRowHeight + 12); // ROW_GAP = 12
    const lastRow = layout.rows[layout.rows.length - 1];
    expect(layout.totalHeight).toBe(lastRow.y + lastRow.height);
  });
});

describe("computeLayout: lanes (no reserved envelope strip -- the mic overlay draws behind whatever lanes are enabled, spec 9.2)", () => {
  it("offsets enabled lanes in a fixed order", () => {
    const song = makeSong([{ bpm: 120, bars: 1 }]);
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: ALL_LANES_ON });
    const row = layout.rows[0];
    expect(row.laneOffsets.tab).toBe(0);
    expect(row.laneOffsets.letter).toBe(TAB_LANE_HEIGHT);
    expect(row.laneOffsets.teacher).toBe(TAB_LANE_HEIGHT + LETTER_LANE_HEIGHT);
    expect(row.height).toBe(TAB_LANE_HEIGHT + LETTER_LANE_HEIGHT + TEACHER_LANE_HEIGHT);
  });

  it("omits offsets for disabled lanes", () => {
    const song = makeSong([{ bpm: 120, bars: 1 }]);
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: TAB_AND_LETTER });
    expect(layout.rows[0].laneOffsets.teacher).toBeUndefined();
  });

  it("has zero row height when every lane is disabled (nothing to overlay)", () => {
    const song = makeSong([{ bpm: 120, bars: 1 }]);
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: NO_LANES });
    const row = layout.rows[0];
    expect(row.laneOffsets).toEqual({});
    expect(row.height).toBe(0);
  });

  it("exposes laneHeights for every lane regardless of which are enabled", () => {
    const song = makeSong([{ bpm: 120, bars: 1 }]);
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: NO_LANES });
    expect(layout.laneHeights.tab).toBe(TAB_LANE_HEIGHT);
    expect(layout.laneHeights.letter).toBe(LETTER_LANE_HEIGHT);
    expect(layout.laneHeights.teacher).toBe(TEACHER_LANE_HEIGHT);
  });
});

describe("computeLayout: bar boxes and grid lines", () => {
  it("places bars left-to-right starting at ROW_LEFT_PADDING", () => {
    const song = makeSong([{ bpm: 120, bars: 2 }]);
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: ALL_LANES_ON });
    const [bar1, bar2] = layout.rows[0].bars;
    expect(bar1.x).toBe(ROW_LEFT_PADDING);
    expect(bar2.x).toBe(ROW_LEFT_PADDING + 240);
    expect(layout.rows[0].x0).toBe(ROW_LEFT_PADDING);
  });

  it("computes gridXs as evenly spaced slot boundaries, including start and end", () => {
    const song = makeSong([{ bpm: 120, bars: 1, slots: 8 }]);
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: ALL_LANES_ON });
    const bar = layout.rows[0].bars[0];
    expect(bar.gridXs).toHaveLength(9); // 8 slots -> 9 boundaries
    expect(bar.gridXs[0]).toBe(ROW_LEFT_PADDING);
    expect(bar.gridXs[8]).toBe(ROW_LEFT_PADDING + 240);
    expect(bar.gridXs[4]).toBeCloseTo(ROW_LEFT_PADDING + 120, 10); // halfway
  });
});

describe("computeLayout: note boxes", () => {
  it("positions a note box from its startTick and full duration when nothing cuts it off", () => {
    const song = makeSong([{ bpm: 120, bars: 1, slots: 8 }]); // 3840 ticks, slot = 480
    addNote(song, 1, { string: 1, fret: 3, startTickInBar: 480, durationTicks: 960 });
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: ALL_LANES_ON });
    const box = layout.rows[0].notes[0];
    expect(box.stringIndex).toBe(0);
    expect(box.x).toBeCloseTo(ROW_LEFT_PADDING + (480 / 3840) * 240, 6);
    expect(box.width).toBeCloseTo((960 / 3840) * 240, 6);
  });

  it("clips a note's box where the next note on the same string starts", () => {
    const song = makeSong([{ bpm: 120, bars: 1, slots: 8 }]);
    // Ringing note wants to last 4 slots (1920 ticks) but is cut off after 2
    // slots (960 ticks) by the next note on the same string.
    addNote(song, 1, { string: 1, fret: 3, startTickInBar: 0, durationTicks: 1920 });
    addNote(song, 1, { string: 1, fret: 5, startTickInBar: 960, durationTicks: 480 });
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: ALL_LANES_ON });
    const [first, second] = layout.rows[0].notes;
    expect(first.width).toBeCloseTo((960 / 3840) * 240, 6);
    expect(second.width).toBeCloseTo((480 / 3840) * 240, 6);
  });

  it("does not let a note on a different string clip an unrelated note", () => {
    const song = makeSong([{ bpm: 120, bars: 1, slots: 8 }]);
    addNote(song, 1, { string: 1, fret: 3, startTickInBar: 0, durationTicks: 1920 });
    addNote(song, 1, { string: 2, fret: 5, startTickInBar: 480, durationTicks: 480 });
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: ALL_LANES_ON });
    const stringOneBox = layout.rows[0].notes.find((n) => n.note.string === 1)!;
    expect(stringOneBox.width).toBeCloseTo((1920 / 3840) * 240, 6);
  });

  it("clips a note's box at the end of its own bar as a defensive fallback", () => {
    const song = makeSong([{ bpm: 120, bars: 1, slots: 8 }]);
    addNote(song, 1, { string: 1, fret: 3, startTickInBar: 3360, durationTicks: 4000 }); // would overrun the bar
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: ALL_LANES_ON });
    const box = layout.rows[0].notes[0];
    expect(box.x + box.width).toBeCloseTo(ROW_LEFT_PADDING + 240, 6); // clipped to bar end
  });

  it("places a chord's notes with distinct stringIndex values", () => {
    const song = makeSong([{ bpm: 120, bars: 1, slots: 8 }]);
    addNote(song, 1, { string: 1, fret: 0, startTickInBar: 0, durationTicks: 480 });
    addNote(song, 1, { string: 3, fret: 2, startTickInBar: 0, durationTicks: 480 });
    const layout = computeLayout(song, { viewportWidth: 1000, zoom: 240, lanes: ALL_LANES_ON });
    const stringIndexes = layout.rows[0].notes.map((n) => n.stringIndex).sort();
    expect(stringIndexes).toEqual([0, 2]);
  });
});
