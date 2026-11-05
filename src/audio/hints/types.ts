// Data shapes for recorded pitch hints.

import { HINT_BINS } from "./constants";

/** Frames per storage chunk (10 s of video). */
export const HINT_CHUNK_BUCKETS = 500;

/**
 * Hints recorded for one YouTube video. `frames` is sparse: bucket -> 49 Uint8 values
 * (MIDI 40..88, 0..255), bucket = round(videoSec / 0.02). Video time, not song time.
 */
export interface VideoHints {
  videoId: string;
  frames: Map<number, Uint8Array>;
  /** Note-start times in video seconds, ascending. Derived from frames on save. */
  onsets: number[];
  /** Chunk indexes (bucket / HINT_CHUNK_BUCKETS) changed since the last save. */
  dirtyChunks: Set<number>;
}

export function emptyHints(videoId: string): VideoHints {
  return { videoId, frames: new Map(), onsets: [], dirtyChunks: new Set() };
}

/** Bucket a video time falls in. */
export function bucketOf(videoSec: number): number {
  return Math.round(videoSec / 0.02);
}

/** Video time at a bucket's centre. */
export function bucketTime(bucket: number): number {
  return bucket * 0.02;
}

/** Stores (or replaces) one frame. Ignores wrong-sized frames and negative buckets. */
export function setFrame(hints: VideoHints, bucket: number, frame: Uint8Array): void {
  if (bucket < 0 || frame.length !== HINT_BINS) return;
  hints.frames.set(bucket, frame);
  hints.dirtyChunks.add(Math.floor(bucket / HINT_CHUNK_BUCKETS));
}

/** Copies every frame of `from` into `into` (replacing equal buckets). */
export function mergeHints(into: VideoHints, from: VideoHints): void {
  for (const [bucket, frame] of from.frames) setFrame(into, bucket, frame);
}
