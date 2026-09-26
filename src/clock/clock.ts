// The Clock interface (spec 7.2) shared by GridClock and VideoClock.

import type { ClockState } from "../model";

export interface LoopRange {
  startTick: number;
  endTick: number;
  /** Extra ticks of "rest" held at the loop end before wrapping back to
   * startTick (spec 10.2). The underlying clock keeps running through the
   * rest (so a consumer reading `unclampedPositionSec()` -- e.g. the
   * metronome -- keeps advancing), but `positionTick()`/`positionSec()` are
   * held at `endTick` throughout the rest, so the cursor visibly waits there
   * and the mic matcher never ages an event into "missed" during the rest.
   * Omitted or 0 = no rest, wraps immediately at endTick. */
  restTicks?: number;
}

export interface Clock {
  readonly kind: "grid" | "video";
  play(): Promise<void>;
  pause(): void;
  seekTick(tick: number): void;
  /** Current musical position in ticks. May be negative during count-in, and
   * is held at the loop's endTick throughout a rest period (spec 10.2). */
  positionTick(): number;
  /** Song-relative seconds (0 = bar 1 slot 1). Same rest-holding behavior as
   * positionTick(). */
  positionSec(): number;
  isPlaying(): boolean;
  /** grid: any 0.25..2.0; video: nearest available YouTube rate. */
  setSpeed(factor: number): void;
  onStateChange(cb: (s: ClockState) => void): () => void;
  /** The active speed factor (grid: the clamped multiplier in use; video:
   * the last requested factor -- see `actualRate()` on VideoClock for the
   * actual applied YouTube rate). */
  speed(): number;
  /** Loop playback over a tick range, optionally with a rest held at the end
   * (spec 10.2). null disables looping. */
  setLoop(range: LoopRange | null): void;
  /** Fires each time the clock wraps back to the loop start (after any
   * rest). Used to reset per-pass mic feedback state and the metronome's
   * scheduling watermark. */
  onLoop(cb: () => void): () => void;
  /** The clock's true position in song seconds, never held/clamped during a
   * loop's rest period (unlike positionSec()). The metronome schedules
   * clicks from this so it keeps clicking through a rest instead of going
   * silent (spec 10.2, 7.5). Identical to positionSec() outside of a rest
   * window, and on VideoClock (which has no rest concept). */
  unclampedPositionSec(): number;
  dispose(): void;
}

export type { ClockState };
