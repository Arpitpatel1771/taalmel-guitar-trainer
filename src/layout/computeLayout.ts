// Pure layout function (spec 8.1, 8.2): (Song, viewportWidth, zoom,
// enabledLanes) -> Layout. No DOM access, runs fine in Node for tests.

import type { Bar, LaneId, Song, StringNumber } from "../model";
import {
  LANE_HEIGHTS,
  LANE_ORDER,
  MAX_ZOOM,
  MIN_ZOOM,
  ROW_GAP,
  ROW_LEFT_PADDING,
} from "./constants";
import type { BarBox, Layout, NoteBox, Row } from "./types";

export interface ComputeLayoutOptions {
  viewportWidth: number;
  zoom: number;
  lanes: Record<LaneId, boolean>;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** For each string, the sorted list of note start ticks across the whole
 * song -- used to clip a ringing note's box where the next note on the
 * same string cuts it off (spec 5.6 / plan's NoteBox width rule). */
function buildNextStartIndex(song: Song): Map<StringNumber, number[]> {
  const byString = new Map<StringNumber, number[]>();
  for (const note of song.notes) {
    const arr = byString.get(note.string);
    if (arr) arr.push(note.startTick);
    else byString.set(note.string, [note.startTick]);
  }
  for (const arr of byString.values()) arr.sort((a, b) => a - b);
  return byString;
}

/** First tick strictly greater than `afterTick` in a sorted array, or null. */
function nextStrictlyAfter(sorted: number[] | undefined, afterTick: number): number | null {
  if (!sorted || sorted.length === 0) return null;
  let lo = 0;
  let hi = sorted.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (sorted[mid] <= afterTick) lo = mid + 1;
    else hi = mid;
  }
  return lo < sorted.length ? sorted[lo] : null;
}

export function computeLayout(song: Song, opts: ComputeLayoutOptions): Layout {
  const pxPerBar = clamp(opts.zoom, MIN_ZOOM, MAX_ZOOM);
  const availableWidth = Math.max(0, opts.viewportWidth - ROW_LEFT_PADDING);
  const barsPerRow = Math.max(1, Math.floor(availableWidth / pxPerBar));

  const allBars: Bar[] = song.sections.flatMap((s) => s.bars);
  const nextStartByString = buildNextStartIndex(song);

  const enabledLaneOrder: LaneId[] = LANE_ORDER.filter((l) => opts.lanes[l]);
  // The mic waveform/verdict overlay is drawn behind the lanes, spanning
  // whatever lane area is enabled (spec 9.2) -- it is no longer a separate
  // strip reserved in the row height.
  const rowContentHeight = enabledLaneOrder.reduce((sum, l) => sum + LANE_HEIGHTS[l], 0);

  const laneOffsets: Partial<Record<LaneId, number>> = {};
  let laneOffset = 0;
  for (const lane of enabledLaneOrder) {
    laneOffsets[lane] = laneOffset;
    laneOffset += LANE_HEIGHTS[lane];
  }

  const rows: Row[] = [];
  let y = 0;

  for (let i = 0; i < allBars.length; i += barsPerRow) {
    const rowBars = allBars.slice(i, i + barsPerRow);
    if (rowBars.length === 0) break;

    const rowIndex = rows.length;
    const startTick = rowBars[0].startTick;
    const lastBar = rowBars[rowBars.length - 1];
    const endTick = lastBar.startTick + lastBar.lengthTicks;

    const barBoxes: BarBox[] = rowBars.map((bar, j) => {
      const x = ROW_LEFT_PADDING + j * pxPerBar;
      const gridXs: number[] = [];
      for (let s = 0; s <= bar.slots; s++) {
        gridXs.push(x + (s / bar.slots) * pxPerBar);
      }
      return {
        barNumber: bar.number,
        x,
        width: pxPerBar,
        startTick: bar.startTick,
        lengthTicks: bar.lengthTicks,
        gridXs,
      };
    });

    const noteBoxes: NoteBox[] = [];
    for (let j = 0; j < rowBars.length; j++) {
      const bar = rowBars[j];
      const barBox = barBoxes[j];
      const barEndTick = bar.startTick + bar.lengthTicks;

      for (const note of bar.notes) {
        const nextStart = nextStrictlyAfter(nextStartByString.get(note.string), note.startTick);
        let clippedEnd = note.startTick + note.durationTicks;
        if (nextStart !== null) clippedEnd = Math.min(clippedEnd, nextStart);
        clippedEnd = Math.min(clippedEnd, barEndTick);

        const xStart = barBox.x + ((note.startTick - bar.startTick) / bar.lengthTicks) * pxPerBar;
        const xEnd = barBox.x + ((clippedEnd - bar.startTick) / bar.lengthTicks) * pxPerBar;

        noteBoxes.push({
          note,
          x: xStart,
          width: Math.max(0, xEnd - xStart),
          stringIndex: note.string - 1,
        });
      }
    }

    rows.push({
      index: rowIndex,
      y,
      height: rowContentHeight,
      startTick,
      endTick,
      x0: ROW_LEFT_PADDING,
      bars: barBoxes,
      notes: noteBoxes,
      laneOffsets,
    });

    y += rowContentHeight + ROW_GAP;
  }

  const totalHeight = rows.length > 0 ? y - ROW_GAP : 0;
  const width = ROW_LEFT_PADDING + barsPerRow * pxPerBar;

  return {
    rows,
    totalHeight,
    width,
    laneHeights: LANE_HEIGHTS,
  };
}
