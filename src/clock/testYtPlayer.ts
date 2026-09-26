// A minimal fake YTPlayerLike for VideoClock tests, plus a manually-driven
// "scheduler" standing in for setInterval so tests can trigger polls at
// exact, deterministic moments instead of relying on real timers.

import type { YTPlayerLike } from "./youtube";
import { YT_PLAYER_STATE } from "./youtube";

export class FakePlayer implements YTPlayerLike {
  currentTime = 0;
  rate = 1;
  state: number = YT_PLAYER_STATE.UNSTARTED;
  availableRates = [0.25, 0.5, 1, 1.5, 2];
  private listeners = new Map<string, Set<(e: { data: number }) => void>>();

  getCurrentTime(): number {
    return this.currentTime;
  }
  playVideo(): void {
    this.state = YT_PLAYER_STATE.PLAYING;
    this.emit("onStateChange", { data: this.state });
  }
  pauseVideo(): void {
    this.state = YT_PLAYER_STATE.PAUSED;
    this.emit("onStateChange", { data: this.state });
  }
  seekTo(seconds: number): void {
    this.currentTime = seconds;
  }
  setPlaybackRate(rate: number): void {
    this.rate = rate;
  }
  getPlaybackRate(): number {
    return this.rate;
  }
  getAvailablePlaybackRates(): number[] {
    return this.availableRates;
  }
  getPlayerState(): number {
    return this.state;
  }
  addEventListener(event: string, listener: (e: { data: number }) => void): void {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(listener);
  }
  removeEventListener(event: string, listener: (e: { data: number }) => void): void {
    this.listeners.get(event)?.delete(listener);
  }
  /** Test-only: simulate a state change originating from the YouTube UI
   * (buffering, user pauses in the embed, video ends, etc.). */
  simulateStateChange(state: number): void {
    this.state = state;
    this.emit("onStateChange", { data: state });
  }
  private emit(event: string, data: { data: number }): void {
    for (const cb of this.listeners.get(event) ?? []) cb(data);
  }
}

/** A manually-driven stand-in for setInterval/clearInterval: `tick()` runs
 * the registered callback synchronously, whenever the test wants a poll to
 * fire, instead of waiting on a real (or fake) timer. */
export function makeManualScheduler() {
  let callback: (() => void) | null = null;
  let handleCounter = 0;
  return {
    setIntervalFn: (fn: () => void): number => {
      callback = fn;
      return ++handleCounter;
    },
    clearIntervalFn: (): void => {
      callback = null;
    },
    tick: (): void => {
      callback?.();
    },
    get isScheduled(): boolean {
      return callback !== null;
    },
  };
}

/** A mutable, injectable monotonic clock for tests. */
export function makeManualNow(initial = 0) {
  let value = initial;
  return {
    now: (): number => value,
    set: (v: number): void => {
      value = v;
    },
    advance: (delta: number): void => {
      value += delta;
    },
  };
}
