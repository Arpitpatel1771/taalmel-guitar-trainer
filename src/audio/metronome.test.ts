// Regression test for the "looping doesn't work" bug (spec 10.2): Metronome
// tracked its scheduling watermark (`lastScheduledSongSec`) as a value that
// only ever increased, assuming the clock's position only ever moves
// forward. A loop wrap makes the clock's position jump BACKWARD (from the
// loop end back to its start), so every click inside the loop range then
// compared as "already scheduled" against the stale, larger watermark and
// was skipped forever -- silencing the metronome for the rest of the
// session after the very first loop pass. `Metronome.attach()` now
// subscribes to `clock.onLoop()` and resets the watermark on every wrap.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Metronome } from "./metronome";
import { TempoMap } from "../tempo";
import { makeSong } from "../tempo/testSongs";
import type { Clock, ClockState, LoopRange } from "../clock";

interface FakeAudioContext {
  currentTime: number;
  createOscillator: () => {
    type: string;
    frequency: { value: number };
    connect: () => void;
    start: (t: number) => void;
    stop: () => void;
  };
  createGain: () => {
    gain: {
      setValueAtTime: () => void;
      linearRampToValueAtTime: () => void;
      exponentialRampToValueAtTime: () => void;
    };
    connect: () => void;
  };
  destination: object;
}

function makeFakeAudioContext(): { obj: FakeAudioContext; startedTimes: number[] } {
  const startedTimes: number[] = [];
  const obj: FakeAudioContext = {
    currentTime: 0,
    createOscillator: () => ({
      type: "sine",
      frequency: { value: 0 },
      connect: () => {},
      start: (t: number) => startedTimes.push(Math.round(t * 1000) / 1000),
      stop: () => {},
    }),
    createGain: () => ({
      gain: {
        setValueAtTime: () => {},
        linearRampToValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {},
      },
      connect: () => {},
    }),
    destination: {},
  };
  return { obj, startedTimes };
}

/** A minimal fake Clock so the test controls positionSec()/
 * unclampedPositionSec() directly and can fire onLoop() at a chosen moment,
 * exactly like GridClock does on a loop wrap (mutate position, then notify). */
class FakeClock implements Clock {
  readonly kind = "grid" as const;
  private sec = 0;
  private loopListeners = new Set<() => void>();

  async play(): Promise<void> {}
  pause(): void {}
  seekTick(): void {}
  positionTick(): number {
    return 0;
  }
  positionSec(): number {
    return this.sec;
  }
  unclampedPositionSec(): number {
    return this.sec;
  }
  isPlaying(): boolean {
    return true;
  }
  setSpeed(): void {}
  speed(): number {
    return 1;
  }
  onStateChange(_cb: (s: ClockState) => void): () => void {
    return () => {};
  }
  setLoop(_range: LoopRange | null): void {}
  onLoop(cb: () => void): () => void {
    this.loopListeners.add(cb);
    return () => this.loopListeners.delete(cb);
  }
  dispose(): void {}

  setSec(sec: number): void {
    this.sec = sec;
  }
  /** Mirrors GridClock.maybeWrapLoop(): mutate position first, then notify,
   * so subscribers reading unclampedPositionSec() from inside the callback
   * see the post-wrap value. */
  wrapTo(sec: number): void {
    this.sec = sec;
    for (const cb of this.loopListeners) cb();
  }
}

describe("Metronome: surviving a loop wrap (spec 10.2)", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("keeps scheduling clicks on the pass after the clock loops back (bug fix)", () => {
    // 6 bars @ 120bpm, 2s/bar: bar3 spans [4.0, 6.0)s -- an interior loop
    // range touching neither the song's start nor its end (the "section"
    // case), with quarter-note clicks at 4.0/4.5/5.0/5.5.
    const song = makeSong([{ bpm: 120, bars: 6 }]);
    const tempo = new TempoMap(song);
    const { obj: ctxObj, startedTimes } = makeFakeAudioContext();
    const ctx = ctxObj as unknown as AudioContext;

    const metronome = new Metronome(ctx, song, tempo);
    const clock = new FakeClock();
    metronome.attach(clock);
    metronome.start(); // schedules the click at sec=0 immediately

    const step = 0.08; // < SCHEDULE_AHEAD_SEC (0.1), so no clicks are skipped
    function advanceTo(sec: number) {
      ctxObj.currentTime = sec;
      clock.setSec(sec);
      vi.advanceTimersByTime(25);
    }

    // Play through pass 1, up to (but not past) the loop end.
    for (let t = step; t < 6.0; t += step) advanceTo(Math.min(t, 5.99));

    const clicksBeforeWrap = startedTimes.filter((t) => t >= 4.0 && t < 6.0);
    expect(clicksBeforeWrap).toEqual([4.0, 4.5, 5.0, 5.5]);

    // The clock wraps back to the loop start (bar 3, 4.0s) -- exactly like
    // GridClock.maybeWrapLoop(): position jumps backward, then onLoop fires.
    clock.wrapTo(4.0);
    advanceTo(4.0); // a tick right at the wrap moment, same as the real rAF loop calling positionTick() every frame

    // Play through pass 2 of the same loop range.
    for (let t = 4.0 + step; t < 6.0; t += step) advanceTo(Math.min(t, 5.99));

    const clicksAfterWrap = startedTimes.filter(
      (t, i) => t >= 4.0 && t < 6.0 && i >= startedTimes.indexOf(5.5) + 1,
    );
    // Without the fix, this is empty: every click in [4.0, 6.0) compared as
    // "already scheduled" against the stale pre-wrap watermark and was
    // skipped forever.
    expect(clicksAfterWrap).toEqual([4.0, 4.5, 5.0, 5.5]);
  });

  it("start() also seeds the watermark from unclampedPositionSec(), not positionSec()", () => {
    const song = makeSong([{ bpm: 120, bars: 2 }]);
    const tempo = new TempoMap(song);
    const { obj: ctxObj, startedTimes } = makeFakeAudioContext();
    const ctx = ctxObj as unknown as AudioContext;
    const metronome = new Metronome(ctx, song, tempo);
    const clock = new FakeClock();
    clock.setSec(0);
    metronome.attach(clock);
    metronome.start();
    expect(startedTimes).toContain(0);
  });
});
