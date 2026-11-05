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

/** Room a fret number needs before the next note starts: the 22px-wide head, wider for two digits
 * (13.2px per mono glyph), plus a small gap. Matches the sheet's note pills. */
function onsetRoomPx(digits: number): number {
  return Math.max(22, digits * 13.2 + 6) + 6;
}

/** Width a bar needs so no fret number overlaps the next one: every gap between note starts (and from
 * the last start to the bar end) gets at least the room of the note before it. */
function neededBarWidth(bar: Bar): number {
  const digitsAt = new Map<number, number>();
  for (const n of bar.notes) {
    const d = n.meta.muted ? 1 : String(n.fret).length;
    digitsAt.set(n.startTick, Math.max(d, digitsAt.get(n.startTick) ?? 0));
  }
  const starts = [...digitsAt.keys()].sort((a, b) => a - b);
  let need = 0;
  for (let i = 0; i < starts.length; i++) {
    const next = i + 1 < starts.length ? starts[i + 1] : bar.startTick + bar.lengthTicks;
    const gap = next - starts[i];
    if (gap > 0) need = Math.max(need, (onsetRoomPx(digitsAt.get(starts[i])!) * bar.lengthTicks) / gap);
  }
  return Math.ceil(need);
}

export function computeLayout(song: Song, opts: ComputeLayoutOptions): Layout {
  const pxPerBar = clamp(opts.zoom, MIN_ZOOM, MAX_ZOOM);
  const availableWidth = Math.max(0, opts.viewportWidth - ROW_LEFT_PADDING);

  const allBars: Bar[] = song.sections.flatMap((s) => s.bars);
  // Bars share the zoom width, but a dense bar widens until its notes don't overlap (at most a full row).
  const barWidths = allBars.map((bar) => Math.max(pxPerBar, Math.min(Math.max(availableWidth, pxPerBar), neededBarWidth(bar))));
  const rowSlices: [number, number][] = [];
  for (let i = 0; i < allBars.length; ) {
    let used = barWidths[i];
    let j = i + 1;
    while (j < allBars.length && used + barWidths[j] <= availableWidth) used += barWidths[j++];
    rowSlices.push([i, j]);
    i = j;
  }
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

  let maxRowWidth = pxPerBar;
  for (const [i, iEnd] of rowSlices) {
    const rowBars = allBars.slice(i, iEnd);

    const rowIndex = rows.length;
    const startTick = rowBars[0].startTick;
    const lastBar = rowBars[rowBars.length - 1];
    const endTick = lastBar.startTick + lastBar.lengthTicks;

    let x = ROW_LEFT_PADDING;
    const barBoxes: BarBox[] = rowBars.map((bar, j) => {
      const width = barWidths[i + j];
      const gridXs: number[] = [];
      for (let s = 0; s <= bar.slots; s++) {
        gridXs.push(x + (s / bar.slots) * width);
      }
      const box = {
        barNumber: bar.number,
        x,
        width,
        startTick: bar.startTick,
        lengthTicks: bar.lengthTicks,
        capo: bar.capo,
        gridXs,
      };
      x += width;
      return box;
    });
    maxRowWidth = Math.max(maxRowWidth, x - ROW_LEFT_PADDING);

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

        const xStart = barBox.x + ((note.startTick - bar.startTick) / bar.lengthTicks) * barBox.width;
        const xEnd = barBox.x + ((clippedEnd - bar.startTick) / bar.lengthTicks) * barBox.width;

        noteBoxes.push({
          note,
          x: xStart,
          width: Math.max(0, xEnd - xStart),
          stringIndex: note.string - 1,
          capo: bar.capo,
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
  // Rows of plain bars keep the old full width (whole bars per row), dense rows can be wider.
  const plainRow = Math.max(1, Math.floor(availableWidth / pxPerBar)) * pxPerBar;
  const width = ROW_LEFT_PADDING + Math.max(plainRow, maxRowWidth);

  return {
    rows,
    totalHeight,
    width,
    laneHeights: LANE_HEIGHTS,
  };
}
