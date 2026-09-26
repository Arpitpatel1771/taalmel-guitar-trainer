import { describe, expect, it, vi } from "vitest";
import { VideoClock, SNAP_THRESHOLD_SEC, EASE_DURATION_MS } from "./videoClock";
import { TempoMap } from "../tempo";
import { makeSong } from "../tempo/testSongs";
import { FakePlayer, makeManualScheduler, makeManualNow } from "./testYtPlayer";
import { YT_PLAYER_STATE } from "./youtube";

describe("VideoClock: interpolation, snapping and easing", () => {
  it("advances position between polls using the current rate", () => {
    const song = makeSong([{ bpm: 120, bars: 8 }]);
    const tempo = new TempoMap(song);
    const now = makeManualNow(0);
    const player = new FakePlayer();
    player.currentTime = 10;
    const scheduler = makeManualScheduler();
    const clock = new VideoClock({
      player,
      tempo,
      offsetSec: 0,
      now: now.now,
      setIntervalFn: scheduler.setIntervalFn,
      clearIntervalFn: scheduler.clearIntervalFn,
    });

    expect(clock.positionSec()).toBeCloseTo(10, 10);
    now.set(500); // 500ms later, rate 1
    expect(clock.positionSec()).toBeCloseTo(10.5, 10);
  });

  it("eases toward a small poll discrepancy (<=40ms) over ~100ms instead of jumping", () => {
    const song = makeSong([{ bpm: 120, bars: 8 }]);
    const tempo = new TempoMap(song);
    const now = makeManualNow(0);
    const player = new FakePlayer();
    player.currentTime = 10;
    const scheduler = makeManualScheduler();
    const clock = new VideoClock({
      player,
      tempo,
      offsetSec: 0,
      now: now.now,
      setIntervalFn: scheduler.setIntervalFn,
      clearIntervalFn: scheduler.clearIntervalFn,
    });

    now.set(1000);
    const estimateBeforePoll = clock.positionSec(); // 10 + 1.0 = 11
    expect(estimateBeforePoll).toBeCloseTo(11, 10);

    // The real player reports 20ms ahead of our estimate -- within the snap
    // threshold, so it should ease in rather than jump.
    const diff = 0.02;
    player.currentTime = estimateBeforePoll + diff;
    scheduler.tick(); // poll happens "now" (t=1000ms)

    // At the instant of the poll, displayed position already matches the
    // polled value (continuous -- no visible jump).
    expect(clock.positionSec()).toBeCloseTo(estimateBeforePoll + diff, 10);

    // Halfway through the ease window, the correction has decayed by half.
    now.set(1000 + EASE_DURATION_MS / 2);
    const rawAtHalf = estimateBeforePoll + EASE_DURATION_MS / 2 / 1000; // rate 1
    expect(clock.positionSec()).toBeCloseTo(rawAtHalf + diff / 2, 6);

    // After the ease window, position is purely the raw (rate-based) estimate.
    now.set(1000 + EASE_DURATION_MS);
    const rawAtEnd = estimateBeforePoll + EASE_DURATION_MS / 1000;
    expect(clock.positionSec()).toBeCloseTo(rawAtEnd, 6);
  });

  it("snaps instantly to the polled value when the discrepancy exceeds 40ms", () => {
    const song = makeSong([{ bpm: 120, bars: 8 }]);
    const tempo = new TempoMap(song);
    const now = makeManualNow(0);
    const player = new FakePlayer();
    player.currentTime = 10;
    const scheduler = makeManualScheduler();
    const clock = new VideoClock({
      player,
      tempo,
      offsetSec: 0,
      now: now.now,
      setIntervalFn: scheduler.setIntervalFn,
      clearIntervalFn: scheduler.clearIntervalFn,
    });

    now.set(1000);
    const estimateBeforePoll = clock.positionSec();
    const bigDiff = SNAP_THRESHOLD_SEC + 0.2; // well beyond the 40ms threshold
    player.currentTime = estimateBeforePoll + bigDiff;
    scheduler.tick();

    expect(clock.positionSec()).toBeCloseTo(estimateBeforePoll + bigDiff, 10);

    // No residual easing afterwards: it should progress at rate 1 from here.
    now.set(1000 + 40);
    expect(clock.positionSec()).toBeCloseTo(estimateBeforePoll + bigDiff + 0.04, 10);
  });
});

describe("VideoClock: play/pause/seek", () => {
  it("play() calls playVideo(), resyncs, and reports playing", async () => {
    const song = makeSong([{ bpm: 120, bars: 8 }]);
    const tempo = new TempoMap(song);
    const now = makeManualNow(0);
    const player = new FakePlayer();
    const scheduler = makeManualScheduler();
    const clock = new VideoClock({
      player,
      tempo,
      offsetSec: 0,
      now: now.now,
      setIntervalFn: scheduler.setIntervalFn,
      clearIntervalFn: scheduler.clearIntervalFn,
    });

    player.currentTime = 5;
    await clock.play();
    expect(clock.isPlaying()).toBe(true);
    expect(clock.positionSec()).toBeCloseTo(5, 10);
  });

  it("pause() calls pauseVideo() and reports not playing", () => {
    const song = makeSong([{ bpm: 120, bars: 8 }]);
    const tempo = new TempoMap(song);
    const now = makeManualNow(0);
    const player = new FakePlayer();
    const scheduler = makeManualScheduler();
    const clock = new VideoClock({
      player,
      tempo,
      offsetSec: 0,
      now: now.now,
      setIntervalFn: scheduler.setIntervalFn,
      clearIntervalFn: scheduler.clearIntervalFn,
    });
    clock.pause();
    expect(clock.isPlaying()).toBe(false);
    expect(player.state).toBe(YT_PLAYER_STATE.PAUSED);
  });

  it("seekTick() converts ticks to video seconds (incl. offset) and re-anchors immediately", () => {
    // 960 ticks = 0.5s @120bpm; offset = 2s -> seekTo(2.5)
    const song = makeSong([{ bpm: 120, bars: 8 }]);
    const tempo = new TempoMap(song);
    const now = makeManualNow(0);
    const player = new FakePlayer();
    const scheduler = makeManualScheduler();
    const clock = new VideoClock({
      player,
      tempo,
      offsetSec: 2,
      now: now.now,
      setIntervalFn: scheduler.setIntervalFn,
      clearIntervalFn: scheduler.clearIntervalFn,
    });

    clock.seekTick(960);
    expect(player.currentTime).toBeCloseTo(2.5, 10);
    expect(clock.positionTick()).toBeCloseTo(960, 6);
  });

  it("setOffset() shifts positionSec/positionTick without moving the video", () => {
    const song = makeSong([{ bpm: 120, bars: 8 }]);
    const tempo = new TempoMap(song);
    const now = makeManualNow(0);
    const player = new FakePlayer();
    player.currentTime = 10;
    const scheduler = makeManualScheduler();
    const clock = new VideoClock({
      player,
      tempo,
      offsetSec: 0,
      now: now.now,
      setIntervalFn: scheduler.setIntervalFn,
      clearIntervalFn: scheduler.clearIntervalFn,
    });

    expect(clock.positionSec()).toBeCloseTo(10, 10);
    clock.setOffset(3);
    expect(clock.positionSec()).toBeCloseTo(7, 10);
  });
});

describe("VideoClock: speed / playback rate", () => {
  it("maps a requested speed to the nearest available YouTube rate", () => {
    const song = makeSong([{ bpm: 120, bars: 8 }]);
    const tempo = new TempoMap(song);
    const now = makeManualNow(0);
    const player = new FakePlayer();
    player.availableRates = [0.25, 0.5, 1, 1.5, 2];
    const scheduler = makeManualScheduler();
    const clock = new VideoClock({
      player,
      tempo,
      offsetSec: 0,
      now: now.now,
      setIntervalFn: scheduler.setIntervalFn,
      clearIntervalFn: scheduler.clearIntervalFn,
    });

    clock.setSpeed(1.6);
    expect(player.rate).toBe(1.5); // nearest of the available rates
    expect(clock.actualRate()).toBe(1.5);
    expect(clock.speed()).toBe(1.6); // nominal request, per contract
  });
});

describe("VideoClock: player-driven state changes", () => {
  it("reflects buffering/pause/ended events fired from the YouTube UI", () => {
    const song = makeSong([{ bpm: 120, bars: 8 }]);
    const tempo = new TempoMap(song);
    const now = makeManualNow(0);
    const player = new FakePlayer();
    const scheduler = makeManualScheduler();
    const clock = new VideoClock({
      player,
      tempo,
      offsetSec: 0,
      now: now.now,
      setIntervalFn: scheduler.setIntervalFn,
      clearIntervalFn: scheduler.clearIntervalFn,
    });

    const states: { playing: boolean; buffering?: boolean }[] = [];
    clock.onStateChange((s) => states.push(s));

    player.simulateStateChange(YT_PLAYER_STATE.BUFFERING);
    player.simulateStateChange(YT_PLAYER_STATE.PLAYING);
    player.simulateStateChange(YT_PLAYER_STATE.PAUSED);
    player.simulateStateChange(YT_PLAYER_STATE.ENDED);

    expect(states).toEqual([
      { playing: false, buffering: true },
      { playing: true, buffering: false },
      { playing: false, buffering: false },
      { playing: false, buffering: false },
    ]);
  });
});

describe("VideoClock: looping", () => {
  it("seeks back to the loop start and fires onLoop when the range ends", () => {
    // Loop bar 1 only: [0, 3840) ticks = [0, 2)s @120bpm.
    const song = makeSong([{ bpm: 120, bars: 8 }]);
    const tempo = new TempoMap(song);
    const now = makeManualNow(0);
    const player = new FakePlayer();
    player.currentTime = 0;
    const scheduler = makeManualScheduler();
    const clock = new VideoClock({
      player,
      tempo,
      offsetSec: 0,
      now: now.now,
      setIntervalFn: scheduler.setIntervalFn,
      clearIntervalFn: scheduler.clearIntervalFn,
    });
    clock.setLoop({ startTick: 0, endTick: 3840 });

    const onLoop = vi.fn();
    clock.onLoop(onLoop);

    now.set(2500); // 2.5s: past the 2s loop end
    player.currentTime = 2.5; // simulate the player having actually played there
    scheduler.tick();

    expect(player.currentTime).toBeCloseTo(0, 10); // seekTo(0) was issued
    expect(onLoop).toHaveBeenCalledTimes(1);
  });

  it("applies a non-zero offset when seeking the loop back to start", () => {
    const song = makeSong([{ bpm: 120, bars: 8 }]);
    const tempo = new TempoMap(song);
    const now = makeManualNow(0);
    const player = new FakePlayer();
    const scheduler = makeManualScheduler();
    const clock = new VideoClock({
      player,
      tempo,
      offsetSec: 5,
      now: now.now,
      setIntervalFn: scheduler.setIntervalFn,
      clearIntervalFn: scheduler.clearIntervalFn,
    });
    clock.setLoop({ startTick: 0, endTick: 3840 });

    now.set(2500);
    player.currentTime = 5 + 2.5; // offset + 2.5s of song time
    scheduler.tick();

    expect(player.currentTime).toBeCloseTo(5, 10); // offset + loop start (tick 0)
  });

  it("setLoop rejects a non-positive range", () => {
    const song = makeSong([{ bpm: 120, bars: 8 }]);
    const tempo = new TempoMap(song);
    const player = new FakePlayer();
    const scheduler = makeManualScheduler();
    const clock = new VideoClock({
      player,
      tempo,
      offsetSec: 0,
      setIntervalFn: scheduler.setIntervalFn,
      clearIntervalFn: scheduler.clearIntervalFn,
    });
    expect(() => clock.setLoop({ startTick: 100, endTick: 100 })).toThrow();
  });
});

describe("VideoClock: audioTimeToSongSec", () => {
  it("maps an AudioContext timestamp via getOutputTimestamp() to song seconds", () => {
    const song = makeSong([{ bpm: 120, bars: 8 }]);
    const tempo = new TempoMap(song);
    const now = makeManualNow(0);
    const player = new FakePlayer();
    player.currentTime = 0;
    const scheduler = makeManualScheduler();
    const clock = new VideoClock({
      player,
      tempo,
      offsetSec: 0,
      now: now.now,
      setIntervalFn: scheduler.setIntervalFn,
      clearIntervalFn: scheduler.clearIntervalFn,
    });

    const fakeAudioCtx = {
      getOutputTimestamp: () => ({ contextTime: 5, performanceTime: 1000 }),
    };
    // audioTime=6 is 1s after contextTime=5, i.e. performance time 2000ms.
    // At perf=2000ms the anchor (perf=0, videoSec=0, rate=1) estimates 2s.
    expect(clock.audioTimeToSongSec(6, fakeAudioCtx)).toBeCloseTo(2, 10);
  });
});

describe("VideoClock: dispose", () => {
  it("stops polling and detaches the player listener", () => {
    const song = makeSong([{ bpm: 120, bars: 8 }]);
    const tempo = new TempoMap(song);
    const now = makeManualNow(0);
    const player = new FakePlayer();
    const scheduler = makeManualScheduler();
    const clock = new VideoClock({
      player,
      tempo,
      offsetSec: 0,
      now: now.now,
      setIntervalFn: scheduler.setIntervalFn,
      clearIntervalFn: scheduler.clearIntervalFn,
    });

    const cb = vi.fn();
    clock.onStateChange(cb);
    clock.dispose();

    expect(scheduler.isScheduled).toBe(false);
    player.simulateStateChange(YT_PLAYER_STATE.PLAYING);
    expect(cb).not.toHaveBeenCalled();

    // Even if something still calls the (now-cleared) poll callback, it's a no-op.
    scheduler.tick();
  });
});
