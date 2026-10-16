import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clampFreeBpm, clickInterval, FreeMetronome, type ClickFn } from "./freeMetronome";

function setup() {
  const ctx = { currentTime: 0 } as unknown as AudioContext & { currentTime: number };
  const clicks: { time: number; accent: boolean; volume: number }[] = [];
  const click: ClickFn = (_c, time, accent, volume) => clicks.push({ time, accent, volume });
  const m = new FreeMetronome(ctx, click);
  /** Advances audio time and fake timers together in scheduler-sized steps. */
  const advance = (sec: number) => {
    for (let t = 0; t < sec; t += 0.025) {
      ctx.currentTime += 0.025;
      vi.advanceTimersByTime(25);
    }
  };
  return { ctx, clicks, m, advance };
}

describe("FreeMetronome", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("computes click intervals and clamps BPM to 20..999", () => {
    expect(clickInterval(120, 1)).toBeCloseTo(0.5);
    expect(clickInterval(120, 4)).toBeCloseTo(0.125);
    expect(clampFreeBpm(5)).toBe(20);
    expect(clampFreeBpm(5000)).toBe(999);
    expect(clickInterval(5000, 1)).toBeCloseTo(60 / 999);
  });

  it("accents beat 1 of each bar", () => {
    const { clicks, m, advance } = setup();
    m.setBpm(120);
    m.setBeatsPerBar(3);
    m.start();
    advance(3);
    m.stop();
    expect(clicks.slice(0, 7).map((c) => c.accent)).toEqual([true, false, false, true, false, false, true]);
  });

  it("keeps up at 999 BPM with evenly spaced clicks", () => {
    const { clicks, m, advance } = setup();
    m.setBpm(999);
    m.start();
    advance(2);
    m.stop();
    // ~2s of audio plus the lookahead window: about 33-35 clicks.
    expect(clicks.length).toBeGreaterThanOrEqual(33);
    expect(clicks.length).toBeLessThanOrEqual(36);
    for (let i = 1; i < clicks.length; i++) {
      expect(clicks[i].time - clicks[i - 1].time).toBeCloseTo(60 / 999, 9);
    }
  });

  it("plays quieter, unaccented subdivision clicks between beats", () => {
    const { clicks, m, advance } = setup();
    m.setVolume(0.8);
    m.setSubdivision(2);
    m.start();
    advance(1);
    m.stop();
    expect(clicks[0]).toMatchObject({ accent: true, volume: 0.8 });
    expect(clicks[1]).toMatchObject({ accent: false, volume: 0.4 });
    expect(clicks[1].time - clicks[0].time).toBeCloseTo(0.25);
  });

  it("applies a tempo change from the next click", () => {
    const { clicks, m, advance } = setup();
    m.setBpm(60);
    m.start();
    advance(0.5);
    m.setBpm(120);
    advance(2);
    m.stop();
    expect(clicks[1].time - clicks[0].time).toBeCloseTo(1);
    expect(clicks[2].time - clicks[1].time).toBeCloseTo(0.5);
  });

  it("notifies beat listeners with the beat index", () => {
    const { m, advance } = setup();
    const beats: number[] = [];
    m.onBeat((i) => beats.push(i));
    m.setBeatsPerBar(2);
    m.start();
    advance(2);
    m.stop();
    expect(beats.slice(0, 4)).toEqual([0, 1, 0, 1]);
  });
});
