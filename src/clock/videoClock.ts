// VideoClock: the embedded YouTube player is the master clock (spec 7.4).
// getCurrentTime() updates coarsely, so we poll every 50ms and interpolate
// between polls using a monotonic clock (performance.now() by default,
// injectable for tests) and the player's actual playback rate. Large drift
// (>40ms) snaps; small drift eases out over ~100ms so the cursor never jumps.

import type { ClockState } from "../model";
import type { TempoMap } from "../tempo";
import type { Clock, LoopRange } from "./clock";
import type { YTPlayerLike } from "./youtube";
import { YT_PLAYER_STATE } from "./youtube";

export const POLL_INTERVAL_MS = 50;
export const SNAP_THRESHOLD_SEC = 0.04;
export const EASE_DURATION_MS = 100;

/** The slice of AudioContext.getOutputTimestamp() VideoClock needs, for
 * audioTimeToSongSec's cross-clock-domain conversion (spec 7.1's audio ->
 * song time mapping, applied to the video-time clock domain). */
export interface OutputTimestampSource {
  getOutputTimestamp(): { contextTime: number; performanceTime: number };
}

export interface VideoClockOptions {
  player: YTPlayerLike;
  tempo: TempoMap;
  offsetSec: number;
  /** Injectable monotonic clock, defaults to performance.now(). */
  now?: () => number;
  /** Injectable interval scheduler, defaults to setInterval/clearInterval.
   * Typed as `unknown` handle to stay agnostic between DOM (number) and
   * Node (Timeout) typings. */
  setIntervalFn?: (fn: () => void, ms: number) => unknown;
  clearIntervalFn?: (handle: unknown) => void;
}

export class VideoClock implements Clock {
  readonly kind = "video" as const;

  private player: YTPlayerLike;
  private tempo: TempoMap;
  private offsetSec: number;
  private nowFn: () => number;

  private requestedSpeed = 1;
  private playing = false;
  private buffering = false;

  // Anchor-based interpolation state (all in video-seconds / perf-ms).
  private anchorVideoSec = 0;
  private anchorPerfMs = 0;
  private anchorRate = 1;
  private correctionAmountSec = 0;
  private correctionStartPerfMs = 0;

  private loopRange: LoopRange | null = null;
  private stateListeners = new Set<(s: ClockState) => void>();
  private loopListeners = new Set<() => void>();

  private pollHandle: unknown = null;
  private clearIntervalFn: (handle: unknown) => void;
  private disposed = false;

  private onPlayerStateChange = (e: { data: number }): void => {
    switch (e.data) {
      case YT_PLAYER_STATE.PLAYING:
        this.playing = true;
        this.buffering = false;
        this.resync();
        this.emitState();
        break;
      case YT_PLAYER_STATE.PAUSED:
        this.playing = false;
        this.buffering = false;
        this.emitState();
        break;
      case YT_PLAYER_STATE.BUFFERING:
        this.buffering = true;
        this.emitState();
        break;
      case YT_PLAYER_STATE.ENDED:
        this.playing = false;
        this.buffering = false;
        this.emitState();
        break;
      default:
        break;
    }
  };

  constructor(opts: VideoClockOptions) {
    this.player = opts.player;
    this.tempo = opts.tempo;
    this.offsetSec = opts.offsetSec;
    this.nowFn = opts.now ?? (() => performance.now());
    const setIntervalFn = opts.setIntervalFn ?? ((fn, ms) => setInterval(fn, ms));
    this.clearIntervalFn = opts.clearIntervalFn ?? ((h) => clearInterval(h as Parameters<typeof clearInterval>[0]));

    const now = this.nowFn();
    this.anchorVideoSec = this.player.getCurrentTime();
    this.anchorPerfMs = now;
    this.anchorRate = this.player.getPlaybackRate() || 1;

    this.player.addEventListener("onStateChange", this.onPlayerStateChange);
    this.pollHandle = setIntervalFn(() => this.poll(), POLL_INTERVAL_MS);
  }

  /** Re-anchors immediately from the player's current reading, discarding
   * any pending ease. Used after play/seek/rate changes so there's no stale
   * interpolation from before the discontinuity. */
  private resync(): void {
    const now = this.nowFn();
    this.anchorVideoSec = this.player.getCurrentTime();
    this.anchorPerfMs = now;
    this.anchorRate = this.player.getPlaybackRate() || 1;
    this.correctionAmountSec = 0;
  }

  private rawEstimate(nowMs: number): number {
    return this.anchorVideoSec + ((nowMs - this.anchorPerfMs) / 1000) * this.anchorRate;
  }

  private correctionAt(nowMs: number): number {
    if (this.correctionAmountSec === 0) return 0;
    const elapsed = nowMs - this.correctionStartPerfMs;
    if (elapsed >= EASE_DURATION_MS) return 0;
    return this.correctionAmountSec * (1 - elapsed / EASE_DURATION_MS);
  }

  private displayedVideoSec(nowMs: number): number {
    return this.rawEstimate(nowMs) + this.correctionAt(nowMs);
  }

  private poll(): void {
    if (this.disposed) return;
    const nowMs = this.nowFn();
    const polled = this.player.getCurrentTime();
    const currentEstimate = this.displayedVideoSec(nowMs);
    const diff = polled - currentEstimate;
    const rate = this.player.getPlaybackRate() || 1;

    if (Math.abs(diff) > SNAP_THRESHOLD_SEC) {
      this.anchorVideoSec = polled;
      this.correctionAmountSec = 0;
    } else {
      this.anchorVideoSec = currentEstimate;
      this.correctionAmountSec = diff;
      this.correctionStartPerfMs = nowMs;
    }
    this.anchorPerfMs = nowMs;
    this.anchorRate = rate;

    if (this.loopRange) {
      const posSec = this.displayedVideoSec(nowMs) - this.offsetSec;
      const posTick = this.tempo.secToTicks(posSec);
      if (posTick >= this.loopRange.endTick) {
        this.wrapLoop();
      }
    }
  }

  private wrapLoop(): void {
    if (!this.loopRange) return;
    const startVideoSec = this.tempo.ticksToSec(this.loopRange.startTick) + this.offsetSec;
    this.player.seekTo(startVideoSec, true);
    const nowMs = this.nowFn();
    this.anchorVideoSec = startVideoSec;
    this.anchorPerfMs = nowMs;
    this.anchorRate = this.player.getPlaybackRate() || 1;
    this.correctionAmountSec = 0;
    this.emitLoop();
  }

  private emitState(): void {
    const state: ClockState = { playing: this.playing, buffering: this.buffering };
    for (const cb of this.stateListeners) cb(state);
  }

  private emitLoop(): void {
    for (const cb of this.loopListeners) cb();
  }

  async play(): Promise<void> {
    this.player.playVideo();
    this.playing = true;
    this.resync();
    this.emitState();
  }

  pause(): void {
    this.player.pauseVideo();
    this.playing = false;
    this.emitState();
  }

  seekTick(tick: number): void {
    const videoSec = this.tempo.ticksToSec(tick) + this.offsetSec;
    this.player.seekTo(videoSec, true);
    const nowMs = this.nowFn();
    this.anchorVideoSec = videoSec;
    this.anchorPerfMs = nowMs;
    this.anchorRate = this.player.getPlaybackRate() || 1;
    this.correctionAmountSec = 0;
  }

  positionSec(): number {
    return this.displayedVideoSec(this.nowFn()) - this.offsetSec;
  }

  positionTick(): number {
    return this.tempo.secToTicks(this.positionSec());
  }

  /** VideoClock has no rest-between-loops concept (spec 10.2 limits rest to
   * grid mode), so this is simply an alias for positionSec(). */
  unclampedPositionSec(): number {
    return this.positionSec();
  }

  isPlaying(): boolean {
    return this.playing;
  }

  /** Maps `factor` to the nearest rate YouTube actually offers. */
  setSpeed(factor: number): void {
    this.requestedSpeed = factor;
    const rates = this.player.getAvailablePlaybackRates();
    const nearest = rates.reduce(
      (best, r) => (Math.abs(r - factor) < Math.abs(best - factor) ? r : best),
      rates[0] ?? 1,
    );
    this.player.setPlaybackRate(nearest);
    const nowMs = this.nowFn();
    this.anchorVideoSec = this.displayedVideoSec(nowMs);
    this.anchorPerfMs = nowMs;
    this.anchorRate = nearest;
    this.correctionAmountSec = 0;
  }

  /** The last factor requested via setSpeed (nominal; see actualRate() for
   * the real YouTube rate in effect). */
  speed(): number {
    return this.requestedSpeed;
  }

  /** The actual YouTube playback rate in effect -- for display, since it
   * may differ from the requested `speed()` (nearest available rate). */
  actualRate(): number {
    return this.player.getPlaybackRate();
  }

  setOffset(sec: number): void {
    this.offsetSec = sec;
  }

  setLoop(range: LoopRange | null): void {
    if (range && range.endTick <= range.startTick) {
      throw new Error("Invalid loop range: endTick must be greater than startTick");
    }
    this.loopRange = range;
  }

  onLoop(cb: () => void): () => void {
    this.loopListeners.add(cb);
    return () => this.loopListeners.delete(cb);
  }

  onStateChange(cb: (s: ClockState) => void): () => void {
    this.stateListeners.add(cb);
    return () => this.stateListeners.delete(cb);
  }

  /** Converts an AudioContext-clock timestamp into song-relative seconds,
   * via the relationship between AudioContext.getOutputTimestamp() and the
   * VideoClock's own performance.now()-based interpolation (spec 7.4/7.1). */
  audioTimeToSongSec(audioTime: number, ctx: OutputTimestampSource): number {
    const ts = ctx.getOutputTimestamp();
    const perfAtAudioTime = ts.performanceTime + (audioTime - ts.contextTime) * 1000;
    return this.displayedVideoSec(perfAtAudioTime) - this.offsetSec;
  }

  dispose(): void {
    this.disposed = true;
    if (this.pollHandle !== null) {
      this.clearIntervalFn(this.pollHandle);
      this.pollHandle = null;
    }
    this.player.removeEventListener?.("onStateChange", this.onPlayerStateChange);
    this.stateListeners.clear();
    this.loopListeners.clear();
  }
}
