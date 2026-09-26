// Tempo map: converts between seconds and ticks for a song, respecting
// per-section BPM (spec 7.1). Pure, no side effects.

import { PPQ, type Song } from "../model";

export interface TempoSegment {
  startTick: number;
  startSec: number;
  bpm: number;
}

function secondsPerTick(bpm: number): number {
  return 60 / (bpm * PPQ);
}

/** Rightmost index i such that keyOf(arr[i]) <= value, or 0 if value is
 * before the first entry (used to extrapolate before the song start / a
 * count-in). Assumes arr is sorted ascending by keyOf and non-empty. */
function findSegmentIndex<T>(arr: T[], value: number, keyOf: (t: T) => number): number {
  if (value < keyOf(arr[0])) return 0;
  let lo = 0;
  let hi = arr.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (keyOf(arr[mid]) <= value) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

export class TempoMap {
  readonly segments: TempoSegment[];

  constructor(song: Song) {
    const segments: TempoSegment[] = [];
    let sec = 0;
    let prevTick = 0;
    let prevBpm = song.header.bpm;
    let first = true;

    for (const section of song.sections) {
      if (section.bars.length === 0) continue;
      const startTick = section.bars[0].startTick;
      if (!first) {
        sec += (startTick - prevTick) * secondsPerTick(prevBpm);
      } else {
        // Anchor: tick 0 is always song-second 0 (spec: "0 = bar 1 slot 1").
        // If the very first bar somehow doesn't start at tick 0, extrapolate
        // backwards from tick 0 using this section's own bpm so the anchor
        // still holds.
        sec = -startTick * secondsPerTick(section.bpm) + 0; // +0 avoids -0 when startTick is 0
      }
      segments.push({ startTick, startSec: sec, bpm: section.bpm });
      prevTick = startTick;
      prevBpm = section.bpm;
      first = false;
    }

    if (segments.length === 0) {
      // No bars anywhere (e.g. hand-built song with no sections/bars).
      // Fall back to a single segment at the header bpm.
      segments.push({ startTick: 0, startSec: 0, bpm: song.header.bpm });
    }

    this.segments = segments;
  }

  private segmentForTick(tick: number): TempoSegment {
    const idx = findSegmentIndex(this.segments, tick, (s) => s.startTick);
    return this.segments[idx];
  }

  private segmentForSec(sec: number): TempoSegment {
    const idx = findSegmentIndex(this.segments, sec, (s) => s.startSec);
    return this.segments[idx];
  }

  ticksToSec(tick: number): number {
    const seg = this.segmentForTick(tick);
    return seg.startSec + (tick - seg.startTick) * secondsPerTick(seg.bpm);
  }

  secToTicks(sec: number): number {
    const seg = this.segmentForSec(sec);
    return seg.startTick + (sec - seg.startSec) / secondsPerTick(seg.bpm);
  }

  bpmAtTick(tick: number): number {
    return this.segmentForTick(tick).bpm;
  }
}
