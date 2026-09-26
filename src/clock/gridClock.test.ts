import { describe, expect, it, vi } from "vitest";
import { GridClock, SCHEDULE_HEADROOM_SEC, type AudioClockContext } from "./gridClock";
import { TempoMap } from "../tempo";
import { makeSong } from "../tempo/testSongs";

function makeFakeCtx(initial = 0): AudioClockContext & { currentTime: number } {
  return { currentTime: initial };
}

describe("GridClock: basic play/pause position tracking", () => {
  it("tracks position from AudioContext.currentTime after the headroom", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });

    await clock.play();
    expect(clock.isPlaying()).toBe(true);

    // Still inside the scheduling headroom: position is slightly negative.
    expect(clock.positionSec()).toBeCloseTo(-SCHEDULE_HEADROOM_SEC, 10);

    // Exactly at the scheduled start.
    ctx.currentTime = SCHEDULE_HEADROOM_SEC;
    expect(clock.positionSec()).toBeCloseTo(0, 10);

    // One real second later: at 120bpm that's 1920 ticks (2 quarter notes).
    ctx.currentTime = SCHEDULE_HEADROOM_SEC + 1;
    expect(clock.positionSec()).toBeCloseTo(1, 10);
    expect(clock.positionTick()).toBeCloseTo(1920, 6);
  });

  it("pause freezes position; resuming continues from there without a jump", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });

    await clock.play();
    ctx.currentTime = SCHEDULE_HEADROOM_SEC + 1; // positionSec = 1
    clock.pause();
    expect(clock.isPlaying()).toBe(false);
    expect(clock.positionSec()).toBeCloseTo(1, 10);

    // Time passes while paused -- position must not move.
    ctx.currentTime = 50;
    expect(clock.positionSec()).toBeCloseTo(1, 10);

    // Resuming does NOT re-trigger a count-in (position isn't at the start).
    await clock.play();
    ctx.currentTime = 50 + SCHEDULE_HEADROOM_SEC; // headroom applies again on each play()
    expect(clock.positionSec()).toBeCloseTo(1, 6);
    ctx.currentTime = 50 + SCHEDULE_HEADROOM_SEC + 0.5;
    expect(clock.positionSec()).toBeCloseTo(1.5, 6);
  });

  it("seekTick while playing re-anchors immediately, without waiting for headroom", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });

    await clock.play();
    ctx.currentTime = SCHEDULE_HEADROOM_SEC + 1;
    clock.seekTick(3840); // seek to bar 2
    expect(clock.positionTick()).toBeCloseTo(3840, 6);

    ctx.currentTime += 0.5; // 0.5s later at 120bpm = 960 ticks
    expect(clock.positionTick()).toBeCloseTo(3840 + 960, 5);
  });

  it("seekTick while paused sets the position without needing play()", () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });

    clock.seekTick(1920);
    expect(clock.positionTick()).toBeCloseTo(1920, 6);
  });
});

describe("GridClock: speed factor", () => {
  it("applies the speed multiplier to song-time progression", async () => {
    const song = makeSong([{ bpm: 120, bars: 8 }]);
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });

    await clock.play();
    ctx.currentTime = SCHEDULE_HEADROOM_SEC;
    clock.setSpeed(2);
    expect(clock.speed()).toBe(2);

    ctx.currentTime = SCHEDULE_HEADROOM_SEC + 1; // 1 real second at 2x = 2 song-seconds
    expect(clock.positionSec()).toBeCloseTo(2, 10);
  });

  it("clamps speed to [0.25, 2.0]", () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const clock = new GridClock({ ctx: makeFakeCtx(), tempo, song, countIn: false });

    clock.setSpeed(5);
    expect(clock.speed()).toBe(2.0);
    clock.setSpeed(0.1);
    expect(clock.speed()).toBe(0.25);
  });
});

describe("GridClock: count-in", () => {
  it("starts one bar early (negative position) when playing from the start", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]); // bar 1 = 3840 ticks = 2s @120bpm
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: true });

    await clock.play();
    ctx.currentTime = SCHEDULE_HEADROOM_SEC;
    expect(clock.positionTick()).toBeCloseTo(-3840, 6);
    expect(clock.positionSec()).toBeCloseTo(-2, 10);

    // 2 seconds of count-in later, position crosses into bar 1 / tick 0.
    ctx.currentTime = SCHEDULE_HEADROOM_SEC + 2;
    expect(clock.positionTick()).toBeCloseTo(0, 5);
  });

  it("does not add a count-in when resuming mid-count-in", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: true });

    await clock.play();
    ctx.currentTime = SCHEDULE_HEADROOM_SEC + 1; // still mid count-in (-1s)
    clock.pause();
    expect(clock.positionSec()).toBeCloseTo(-1, 10);

    await clock.play(); // resume: base tick isn't 0, so no second count-in
    ctx.currentTime += SCHEDULE_HEADROOM_SEC;
    expect(clock.positionSec()).toBeCloseTo(-1, 6);
  });

  it("does not count in when countIn is false", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });

    await clock.play();
    ctx.currentTime = SCHEDULE_HEADROOM_SEC;
    expect(clock.positionTick()).toBeCloseTo(0, 6);
  });
});

describe("GridClock: looping", () => {
  it("wraps to loop start at loop end and fires onLoop", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]); // each bar = 3840 ticks = 2s
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });
    clock.setLoop({ startTick: 0, endTick: 3840 });

    const onLoop = vi.fn();
    clock.onLoop(onLoop);

    await clock.play();
    ctx.currentTime = SCHEDULE_HEADROOM_SEC + 2.5; // 2.5s > loop length (2s): overshoot 0.5s
    expect(clock.positionSec()).toBeCloseTo(0.5, 10);
    expect(clock.positionTick()).toBeCloseTo(960, 5);
    expect(onLoop).toHaveBeenCalledTimes(1);

    // No further wrap without further advancing time.
    clock.positionTick();
    expect(onLoop).toHaveBeenCalledTimes(1);
  });

  it("adds a count-in on the first pass when playing from the loop start", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: true });
    clock.setLoop({ startTick: 3840, endTick: 7680 }); // start bar 2, one bar long

    await clock.play();
    ctx.currentTime = SCHEDULE_HEADROOM_SEC;
    // Count-in is one bar (3840 ticks) before the loop's start bar.
    expect(clock.positionTick()).toBeCloseTo(0, 5);
  });

  it("setLoop rejects a non-positive range", () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const clock = new GridClock({ ctx: makeFakeCtx(), tempo, song, countIn: false });
    expect(() => clock.setLoop({ startTick: 100, endTick: 100 })).toThrow();
    expect(() => clock.setLoop({ startTick: 200, endTick: 100 })).toThrow();
  });

  it("onLoop unsubscribe stops further notifications", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });
    clock.setLoop({ startTick: 0, endTick: 3840 });

    const onLoop = vi.fn();
    const unsubscribe = clock.onLoop(onLoop);
    unsubscribe();

    await clock.play();
    ctx.currentTime = SCHEDULE_HEADROOM_SEC + 2.5;
    clock.positionTick();
    expect(onLoop).not.toHaveBeenCalled();
  });

  it("loops a whole-song range (no bar range selected, spec 10.2) repeatedly", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]); // 4 bars * 3840 = 15360 ticks total
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });
    clock.setLoop({ startTick: 0, endTick: song.totalTicks });

    const onLoop = vi.fn();
    clock.onLoop(onLoop);
    await clock.play();

    // 4 bars @ 120bpm = 8s/loop. Poll every 16ms (like a rAF loop) for well
    // over two full passes and confirm the position never runs past the
    // song's end and the loop keeps firing every pass.
    for (let i = 0; i < 1200; i++) {
      ctx.currentTime = SCHEDULE_HEADROOM_SEC + i * 0.016;
      const tick = clock.positionTick();
      expect(tick).toBeLessThan(song.totalTicks);
      expect(tick).toBeGreaterThanOrEqual(0);
    }
    expect(onLoop.mock.calls.length).toBeGreaterThanOrEqual(2);
  });

  it("regression: an interior sub-range loop (e.g. a section that is neither the first nor the last bar) wraps repeatedly and never runs past its end", async () => {
    // Mirrors a real multi-section song: three 2-bar sections at different
    // BPMs. The loop covers only the MIDDLE section -- a range touching
    // neither bar 1 nor the song's last bar -- which is exactly the shape a
    // "loop this range" selection produces for anything but the first/last
    // bars of a song.
    const song = makeSong([
      { name: "Intro", bpm: 120, bars: 2 },
      { name: "Verse", bpm: 100, bars: 2 },
      { name: "Chorus", bpm: 140, bars: 2 },
    ]);
    const tempo = new TempoMap(song);
    const bars = song.sections.flatMap((s) => s.bars);
    const rangeStart = bars[2].startTick; // first bar of "Verse"
    const rangeEnd = bars[3].startTick + bars[3].lengthTicks; // end of "Verse"
    expect(rangeStart).toBeGreaterThan(0);
    expect(rangeEnd).toBeLessThan(song.totalTicks);

    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });
    clock.setLoop({ startTick: rangeStart, endTick: rangeEnd });

    const onLoop = vi.fn();
    clock.onLoop(onLoop);
    await clock.play();

    let maxTickSeen = -Infinity;
    for (let i = 0; i < 3000; i++) {
      ctx.currentTime = SCHEDULE_HEADROOM_SEC + i * 0.016;
      const tick = clock.positionTick();
      maxTickSeen = Math.max(maxTickSeen, tick);
    }
    // The bug this reproduces: without a correct wrap, position runs past
    // rangeEnd and never comes back (it would climb toward song.totalTicks).
    expect(maxTickSeen).toBeLessThan(rangeEnd);
    expect(onLoop.mock.calls.length).toBeGreaterThan(3);
  });
});

describe("GridClock: rest between loops (spec 10.2)", () => {
  it("holds positionTick()/positionSec() at the loop end throughout the rest, then wraps to the start", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]); // 2s/bar
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });
    // Loop bar 2 only (ticks 3840..7680), with a 1-bar (3840-tick) rest.
    clock.setLoop({ startTick: 3840, endTick: 7680, restTicks: 3840 });

    const onLoop = vi.fn();
    clock.onLoop(onLoop);
    await clock.play();

    // Reach the loop end (bar 2 is 2s long, starting at song-second 2).
    ctx.currentTime = SCHEDULE_HEADROOM_SEC + 4; // song second 4 = tick 7680
    expect(clock.positionTick()).toBeCloseTo(7680, 5);
    expect(onLoop).not.toHaveBeenCalled(); // still resting, hasn't wrapped yet

    // Well into the rest (rest is worth 2 more song-seconds at 120bpm): the
    // cursor and matcher must see the position frozen at the loop end.
    ctx.currentTime = SCHEDULE_HEADROOM_SEC + 5;
    expect(clock.positionTick()).toBe(7680);
    expect(clock.positionSec()).toBeCloseTo(tempo.ticksToSec(7680), 10);
    expect(onLoop).not.toHaveBeenCalled();

    // Rest elapses (2s of rest after reaching the end, i.e. real time 4+2=6s
    // of song-second-equivalent progress) -- now it wraps to the start.
    ctx.currentTime = SCHEDULE_HEADROOM_SEC + 6;
    expect(clock.positionTick()).toBeCloseTo(3840, 5);
    expect(onLoop).toHaveBeenCalledTimes(1);

    // A little further past the wrap: normal forward progress from the loop
    // start (any overshoot from the exact wrap instant carries forward).
    ctx.currentTime = SCHEDULE_HEADROOM_SEC + 6.5;
    expect(clock.positionTick()).toBeCloseTo(3840 + 960, 4); // 0.5s later at 120bpm
    expect(onLoop).toHaveBeenCalledTimes(1);
  });

  it("keeps the underlying clock (unclampedPositionSec) running through the rest, unlike positionSec()", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });
    clock.setLoop({ startTick: 3840, endTick: 7680, restTicks: 3840 });

    await clock.play();
    ctx.currentTime = SCHEDULE_HEADROOM_SEC + 5; // 1s into the 2s rest
    // positionSec() is held at the loop end (song second 4)...
    expect(clock.positionSec()).toBeCloseTo(4, 10);
    // ...but the metronome's clock keeps advancing underneath, past the end.
    expect(clock.unclampedPositionSec()).toBeCloseTo(5, 10);
  });

  it("does not fire onLoop until the rest has fully elapsed, and fires exactly once per pass", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });
    clock.setLoop({ startTick: 0, endTick: 3840, restTicks: 1920 }); // 1 bar range, half-bar rest

    const onLoop = vi.fn();
    clock.onLoop(onLoop);
    await clock.play();

    // Poll finely across several passes and count wraps precisely.
    for (let i = 0; i < 2000; i++) {
      ctx.currentTime = SCHEDULE_HEADROOM_SEC + i * 0.01;
      clock.positionTick();
    }
    // Loop+rest is 2s (bar) + 1s (half-bar rest at 120bpm) = 3s/pass over 20s.
    expect(onLoop.mock.calls.length).toBeGreaterThanOrEqual(5);
    expect(onLoop.mock.calls.length).toBeLessThanOrEqual(8);
  });

  it("with no rest configured, wraps immediately at the loop end (restTicks defaults to 0)", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });
    clock.setLoop({ startTick: 0, endTick: 3840 });

    await clock.play();
    ctx.currentTime = SCHEDULE_HEADROOM_SEC + 2.1;
    // No rest: position should already be wrapped, not held at 3840.
    expect(clock.positionTick()).toBeLessThan(3840);
  });

  it("setLoop rejects a negative restTicks", () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const clock = new GridClock({ ctx: makeFakeCtx(), tempo, song, countIn: false });
    expect(() => clock.setLoop({ startTick: 0, endTick: 3840, restTicks: -1 })).toThrow();
  });
});

describe("GridClock: state change notifications", () => {
  it("notifies subscribers on play/pause and supports unsubscribe", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });

    const states: boolean[] = [];
    const unsubscribe = clock.onStateChange((s) => states.push(s.playing));

    await clock.play();
    clock.pause();
    expect(states).toEqual([true, false]);

    unsubscribe();
    await clock.play();
    expect(states).toEqual([true, false]); // no new entry after unsubscribe
  });
});

describe("GridClock: audioTimeToSongSec", () => {
  it("maps an arbitrary AudioContext timestamp to song seconds while playing", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });

    await clock.play(); // audioStart = 0.1
    expect(clock.audioTimeToSongSec(0.1)).toBeCloseTo(0, 10);
    expect(clock.audioTimeToSongSec(1.1)).toBeCloseTo(1, 10);
  });

  it("returns the frozen position while paused, regardless of the audio time given", () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });
    clock.seekTick(1920);
    expect(clock.audioTimeToSongSec(999)).toBeCloseTo(1, 10);
  });
});

describe("GridClock: dispose", () => {
  it("clears listeners so they no longer fire", async () => {
    const song = makeSong([{ bpm: 120, bars: 4 }]);
    const tempo = new TempoMap(song);
    const ctx = makeFakeCtx(0);
    const clock = new GridClock({ ctx, tempo, song, countIn: false });

    const cb = vi.fn();
    clock.onStateChange(cb);
    clock.dispose();
    expect(clock.isPlaying()).toBe(false);

    await clock.play();
    expect(cb).not.toHaveBeenCalled();
  });
});
