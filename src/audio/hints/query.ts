// Read-side helpers for drawing hints: ranges, coverage, onsets, and the video <-> song time
// mapping. Pure.

import { HINT_FRAME_RATE } from "./constants";
import { pickOnsets } from "./detect";
import { bucketOf, bucketTime, type VideoHints } from "./types";

export interface HintFrame {
  bucket: number;
  /** Video time of the bucket, seconds. */
  timeSec: number;
  frame: Uint8Array;
}

/** Recorded frames whose video time lies in [startSec, endSec], ascending. */
export function framesInRange(hints: VideoHints, startSec: number, endSec: number): HintFrame[] {
  const out: HintFrame[] = [];
  const first = Math.max(0, Math.ceil(startSec / 0.02 - 1e-9));
  const last = Math.floor(endSec / 0.02 + 1e-9);
  const span = last - first + 1;
  if (span <= 0) return out;
  if (span > hints.frames.size) {
    // Sparse data and a wide range: walk the map instead of every bucket.
    for (const [bucket, frame] of hints.frames) {
      if (bucket >= first && bucket <= last) out.push({ bucket, timeSec: bucketTime(bucket), frame });
    }
    return out.sort((a, b) => a.bucket - b.bucket);
  }
  for (let bucket = first; bucket <= last; bucket++) {
    const frame = hints.frames.get(bucket);
    if (frame) out.push({ bucket, timeSec: bucketTime(bucket), frame });
  }
  return out;
}

export interface TimeRange {
  startSec: number;
  endSec: number;
}

/**
 * Video time spans that have frames, merged across holes of up to `maxGapSec`, ascending.
 * The UI hatches everything outside these.
 */
export function coverageRanges(hints: VideoHints, maxGapSec = 0.1): TimeRange[] {
  const buckets = Array.from(hints.frames.keys()).sort((a, b) => a - b);
  const gap = Math.max(1, Math.round(maxGapSec / 0.02));
  const out: TimeRange[] = [];
  let start = 0;
  let prev = 0;
  buckets.forEach((b, i) => {
    if (i === 0) start = prev = b;
    else if (b - prev > gap) {
      out.push({ startSec: bucketTime(start) - 0.01, endSec: bucketTime(prev) + 0.01 });
      start = b;
    }
    prev = b;
  });
  if (buckets.length) out.push({ startSec: bucketTime(start) - 0.01, endSec: bucketTime(prev) + 0.01 });
  return out;
}

/** Parts of [startSec, endSec] with no recorded frames (the complement of coverage). */
export function uncoveredRanges(hints: VideoHints, startSec: number, endSec: number, maxGapSec = 0.1): TimeRange[] {
  const out: TimeRange[] = [];
  let cursor = startSec;
  for (const r of coverageRanges(hints, maxGapSec)) {
    if (r.endSec <= cursor) continue;
    if (r.startSec >= endSec) break;
    if (r.startSec > cursor) out.push({ startSec: cursor, endSec: r.startSec });
    cursor = Math.max(cursor, r.endSec);
  }
  if (cursor < endSec) out.push({ startSec: cursor, endSec });
  return out;
}

/** Whether the video time has a recorded frame. */
export function hasFrameAt(hints: VideoHints, videoSec: number): boolean {
  return hints.frames.has(bucketOf(videoSec));
}

/** Onset times (video seconds) inside [startSec, endSec]. */
export function onsetsInRange(hints: VideoHints, startSec: number, endSec: number): number[] {
  return hints.onsets.filter((t) => t >= startSec && t <= endSec);
}

/** Note starts from the frames: spectral-flux peaks per contiguous recorded run (video seconds). */
export function computeOnsets(hints: VideoHints): number[] {
  const buckets = Array.from(hints.frames.keys()).sort((a, b) => a - b);
  const out: number[] = [];
  let run: Uint8Array[] = [];
  let runStart = 0;
  const flush = (): void => {
    if (run.length > 1) for (const t of pickOnsets(run, HINT_FRAME_RATE)) out.push(bucketTime(runStart) + t);
    run = [];
  };
  let prev = -2;
  for (const b of buckets) {
    if (b !== prev + 1) {
      flush();
      runStart = b;
    }
    run.push(hints.frames.get(b)!);
    prev = b;
  }
  flush();
  return out;
}

/** The part of TempoMap the mapping needs. */
export interface TickSecMap {
  ticksToSec(tick: number): number;
  secToTicks(sec: number): number;
}

export interface VideoSongMapper {
  /** Song tick at a video time. */
  videoToTicks(videoSec: number): number;
  /** Video time at a song tick. */
  ticksToVideo(tick: number): number;
}

/**
 * Maps between video time and song ticks: video = songSec + offsetSec, where offsetSec is the
 * video time of bar 1 (tick 0) and songSec comes from the tempo map.
 */
export function createVideoSongMapper(tempo: TickSecMap, offsetSec: number): VideoSongMapper {
  return {
    videoToTicks: (videoSec) => tempo.secToTicks(videoSec - offsetSec),
    ticksToVideo: (tick) => tempo.ticksToSec(tick) + offsetSec,
  };
}
