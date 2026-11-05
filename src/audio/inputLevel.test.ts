import { describe, expect, it } from "vitest";
import { LEVEL_CONFIG, LevelMeter, levelStateFor, peakDbOf } from "./inputLevel";

const STEP = LEVEL_CONFIG.intervalMs;

/** Feeds `db` for `ms`, starting at `from`; returns the last reading and the end time. */
function feed(m: LevelMeter, db: number, from: number, ms: number) {
  let r = m.push(db, from);
  let t = from;
  while (t < from + ms) {
    t += STEP;
    r = m.push(db, t);
  }
  return { r, t };
}

function tone(amp: number, n = 2048) {
  return Float32Array.from({ length: n }, (_, i) => amp * Math.sin(i * 0.3));
}

describe("peakDbOf", () => {
  it("measures synthetic buffers", () => {
    expect(peakDbOf(new Float32Array(100))).toBe(-Infinity);
    expect(peakDbOf(tone(10 ** (-30 / 20)))).toBeCloseTo(-30, 0);
    expect(peakDbOf(tone(10 ** (-10 / 20)))).toBeCloseTo(-10, 0);
    expect(peakDbOf(Float32Array.from([0.2, -1, 0.5]))).toBeCloseTo(0, 5);
  });
});

describe("levelStateFor", () => {
  it("applies the thresholds", () => {
    expect(levelStateFor(-Infinity)).toBe("waiting");
    expect(levelStateFor(-51)).toBe("waiting");
    expect(levelStateFor(-50)).toBe("tooQuiet");
    expect(levelStateFor(-30)).toBe("tooQuiet");
    expect(levelStateFor(-24)).toBe("good");
    expect(levelStateFor(-10)).toBe("good");
    expect(levelStateFor(-1)).toBe("tooLoud");
    expect(levelStateFor(0)).toBe("tooLoud");
  });
});

describe("LevelMeter", () => {
  it("starts waiting and stays so on silence", () => {
    const m = new LevelMeter();
    expect(feed(m, -Infinity, 0, 3000).r).toMatchObject({ state: "waiting", bars: 0 });
  });

  it("shows a state only after it has held for 1 s", () => {
    const m = new LevelMeter();
    feed(m, -70, 0, 500);
    expect(feed(m, -10, 550, 900).r.state).toBe("waiting");
    expect(feed(m, -10, 1450, 200).r.state).toBe("good");
  });

  it("reaches too quiet, good and too loud", () => {
    const m = new LevelMeter();
    let { r, t } = feed(m, -30, 0, 1200);
    expect(r.state).toBe("tooQuiet");
    ({ r, t } = feed(m, -10, t, 1200));
    expect(r.state).toBe("good");
    ({ r, t } = feed(m, -0.5, t, 1200));
    expect(r.state).toBe("tooLoud");
  });

  it("does not flap on a brief dip between notes", () => {
    const m = new LevelMeter();
    let { t } = feed(m, -10, 0, 1500);
    ({ t } = feed(m, -60, t, 500));
    expect(feed(m, -10, t, 500).r.state).toBe("good");
  });

  it("keeps the loudest peak of the 2 s window, then falls back", () => {
    const m = new LevelMeter();
    let { t } = feed(m, -10, 0, 1500);
    m.push(-0.2, t); // one clipped peak
    ({ t } = feed(m, -10, t, 1200));
    expect(m.push(-10, t + STEP).state).toBe("tooLoud");
    // 2 s after the peak it leaves the window, then 1 s hold.
    expect(feed(m, -10, t, 2500).r.state).toBe("good");
  });

  it("bars follow the peak up at once and fall off gradually", () => {
    const m = new LevelMeter();
    expect(m.push(0, 0).bars).toBe(LEVEL_CONFIG.barCount);
    const next = m.push(-60, STEP).bars;
    expect(next).toBeLessThanOrEqual(LEVEL_CONFIG.barCount);
    expect(next).toBeGreaterThan(0);
    expect(feed(m, -60, STEP, 2000).r.bars).toBe(0);
  });

  it("reset returns to waiting", () => {
    const m = new LevelMeter();
    feed(m, -10, 0, 1500);
    m.reset();
    expect(m.push(-80, 10_000)).toMatchObject({ state: "waiting", bars: 0 });
  });
});
