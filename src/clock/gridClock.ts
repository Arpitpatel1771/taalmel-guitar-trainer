// GridClock: the metronome is the master clock (spec 7.3). Master time is
// AudioContext.currentTime -- but we only ever read `.currentTime` off the
// context, so tests can pass a plain `{ currentTime: number }` fake instead
// of a real AudioContext.

import type { ClockState, Song } from "../model";
import type { TempoMap } from "../tempo";
import type { Clock, LoopRange } from "./clock";

/** The minimal slice of AudioContext GridClock actually reads. Structurally
 * compatible with a real AudioContext, but also with a plain test fake. */
export interface AudioClockContext {
  readonly currentTime: number;
}

export interface GridClockOptions {
  ctx: AudioClockContext;
  tempo: TempoMap;
  song: Song;
  countIn: boolean;
}

export const SCHEDULE_HEADROOM_SEC = 0.1;
// Sanity bounds only: the UI limits tempo in absolute BPM (20-400), which on
// slow or fast songs can exceed the old 0.25x-2x range.
export const MIN_SPEED = 0.02;
export const MAX_SPEED = 20;

function clampSpeed(factor: number): number {
  return Math.min(MAX_SPEED, Math.max(MIN_SPEED, factor));
}

export class GridClock implements Clock {
  readonly kind = "grid" as const;

  private ctx: AudioClockContext;
  private tempo: TempoMap;
  private song: Song;
  private countInEnabled: boolean;

  private speedFactor = 1;
  private playing = false;

  /** Song position (ticks) in effect while paused / not yet started. While
   * playing, the authoritative position is derived from audioStart/baseSec
   * below; baseTick is kept roughly in sync for bookkeeping (loop checks). */
  private baseTick = 0;
  private baseSec = 0;
  private audioStart: number | null = null;

  private loopRange: LoopRange | null = null;

  private stateListeners = new Set<(s: ClockState) => void>();
  private loopListeners = new Set<() => void>();

  constructor(opts: GridClockOptions) {
    this.ctx = opts.ctx;
    this.tempo = opts.tempo;
    this.song = opts.song;
    this.countInEnabled = opts.countIn;
  }

  private barLengthAtTick(tick: number): number {
    for (const section of this.song.sections) {
      for (const bar of section.bars) {
        if (bar.startTick === tick) return bar.lengthTicks;
      }
    }
    // Fallback: first bar's length, or a default 4/4 bar (3840 ticks).
    const firstBar = this.song.sections.flatMap((s) => s.bars)[0];
    return firstBar ? firstBar.lengthTicks : 3840;
  }

  private rawPositionSec(): number {
    if (this.playing && this.audioStart !== null) {
      const elapsed = this.ctx.currentTime - this.audioStart;
      return this.baseSec + elapsed * this.speedFactor;
    }
    return this.tempo.ticksToSec(this.baseTick);
  }

  /** Wraps the underlying (unclamped) position back to loopRange.startTick
   * once it reaches `endTick + restTicks` (spec 10.2: the rest is extra time
   * held at the loop end before wrapping, not extra time after wrapping). A
   * `for` guard converges even from a position far past the wrap point (e.g.
   * resuming from a stale paused position) via repeated modular subtraction. */
  private maybeWrapLoop(): void {
    if (!this.playing || !this.loopRange) return;
    const range = this.loopRange;
    const wrapAtTick = range.endTick + (range.restTicks ?? 0);
    for (let guard = 0; guard < 1000; guard++) {
      const rawSec = this.rawPositionSec();
      const rawTick = this.tempo.secToTicks(rawSec);
      if (rawTick < wrapAtTick) break;
      const wrapAtSec = this.tempo.ticksToSec(wrapAtTick);
      const overshootSec = rawSec - wrapAtSec;
      const startSec = this.tempo.ticksToSec(range.startTick);
      this.baseSec = startSec + overshootSec;
      this.audioStart = this.ctx.currentTime;
      this.baseTick = range.startTick;
      this.emitLoop();
    }
  }

  private emitState(): void {
    const state: ClockState = { playing: this.playing };
    for (const cb of this.stateListeners) cb(state);
  }

  private emitLoop(): void {
    for (const cb of this.loopListeners) cb();
  }

  async play(): Promise<void> {
    if (this.playing) return;
    const startTick = this.loopRange ? this.loopRange.startTick : 0;
    let effectiveBaseTick = this.baseTick;
    if (this.baseTick === startTick && this.countInEnabled) {
      effectiveBaseTick = startTick - this.barLengthAtTick(startTick);
    }
    this.baseTick = effectiveBaseTick;
    this.baseSec = this.tempo.ticksToSec(this.baseTick);
    this.audioStart = this.ctx.currentTime + SCHEDULE_HEADROOM_SEC;
    this.playing = true;
    this.emitState();
  }

  pause(): void {
    if (!this.playing) return;
    this.baseTick = this.positionTick();
    this.playing = false;
    this.audioStart = null;
    this.emitState();
  }

  seekTick(tick: number): void {
    this.baseTick = tick;
    this.baseSec = this.tempo.ticksToSec(tick);
    if (this.playing) {
      this.audioStart = this.ctx.currentTime;
    }
  }

  /** Clamps a raw (unclamped) tick to the loop end throughout a rest window,
   * so the cursor and mic matcher see a frozen position (spec 10.2). Outside
   * of a rest window (or with no rest configured) this is the identity. */
  private clampForRest(rawTick: number): number {
    const range = this.loopRange;
    if (!range) return rawTick;
    const restTicks = range.restTicks ?? 0;
    if (restTicks > 0 && rawTick >= range.endTick) return range.endTick;
    return rawTick;
  }

  positionTick(): number {
    this.maybeWrapLoop();
    const rawTick = this.tempo.secToTicks(this.rawPositionSec());
    return this.clampForRest(rawTick);
  }

  positionSec(): number {
    this.maybeWrapLoop();
    const rawSec = this.rawPositionSec();
    const rawTick = this.tempo.secToTicks(rawSec);
    const clampedTick = this.clampForRest(rawTick);
    return clampedTick === rawTick ? rawSec : this.tempo.ticksToSec(clampedTick);
  }

  /** The true, never-frozen position (spec 10.2 / Clock interface): used by
   * the metronome so clicks keep going through a loop's rest period. */
  unclampedPositionSec(): number {
    this.maybeWrapLoop();
    return this.rawPositionSec();
  }

  isPlaying(): boolean {
    return this.playing;
  }

  setSpeed(factor: number): void {
    const clamped = clampSpeed(factor);
    if (this.playing) {
      // Re-anchor at the current position so the rate change doesn't cause
      // a jump.
      const currentSec = this.rawPositionSec();
      this.baseSec = currentSec;
      this.audioStart = this.ctx.currentTime;
    }
    this.speedFactor = clamped;
  }

  speed(): number {
    return this.speedFactor;
  }

  onStateChange(cb: (s: ClockState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  /** Loop playback over [startTick, endTick), optionally holding a rest at
   * the end before wrapping back to startTick with no count-in (spec 10.2). */
  setLoop(range: LoopRange | null): void {
    if (range && range.endTick <= range.startTick) {
      throw new Error("Invalid loop range: endTick must be greater than startTick");
    }
    if (range && (range.restTicks ?? 0) < 0) {
      throw new Error("Invalid loop range: restTicks must not be negative");
    }
    this.loopRange = range;
  }

  onLoop(cb: () => void): () => void {
    this.loopListeners.add(cb);
    return () => this.loopListeners.delete(cb);
  }

  /** Converts an arbitrary AudioContext-clock timestamp (e.g. an onset
   * frame's time) into song-relative seconds, using the same mapping as
   * positionSec(). Used by the mic pipeline to place onsets on the grid. */
  audioTimeToSongSec(audioTime: number): number {
    if (this.playing && this.audioStart !== null) {
      const elapsed = audioTime - this.audioStart;
      return this.baseSec + elapsed * this.speedFactor;
    }
    return this.tempo.ticksToSec(this.baseTick);
  }

  dispose(): void {
    this.playing = false;
    this.audioStart = null;
    this.stateListeners.clear();
    this.loopListeners.clear();
  }
}
