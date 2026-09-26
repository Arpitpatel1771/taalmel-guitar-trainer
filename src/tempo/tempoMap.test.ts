import { describe, expect, it } from "vitest";
import { TempoMap } from "./tempoMap";
import { makeSong } from "./testSongs";
import { PPQ } from "../model";

function secPerTick(bpm: number): number {
  return 60 / (bpm * PPQ);
}

describe("TempoMap: single constant-tempo section", () => {
  const song = makeSong([{ bpm: 120, bars: 4 }]);
  const tempo = new TempoMap(song);

  it("produces one segment starting at tick 0 / sec 0", () => {
    expect(tempo.segments).toEqual([{ startTick: 0, startSec: 0, bpm: 120 }]);
  });

  it("converts a quarter note (960 ticks) to seconds at 120bpm (0.5s)", () => {
    expect(tempo.ticksToSec(960)).toBeCloseTo(0.5, 10);
  });

  it("converts whole bar (3840 ticks, 4/4) to 2 seconds at 120bpm", () => {
    expect(tempo.ticksToSec(3840)).toBeCloseTo(2, 10);
  });

  it("secToTicks is the inverse of ticksToSec", () => {
    for (const tick of [0, 480, 960, 3839, 3840, 7680]) {
      expect(tempo.secToTicks(tempo.ticksToSec(tick))).toBeCloseTo(tick, 6);
    }
  });

  it("bpmAtTick returns the constant bpm everywhere", () => {
    expect(tempo.bpmAtTick(0)).toBe(120);
    expect(tempo.bpmAtTick(15360)).toBe(120);
  });
});

describe("TempoMap: negative ticks / seconds (count-in)", () => {
  const song = makeSong([{ bpm: 120, bars: 2 }]);
  const tempo = new TempoMap(song);

  it("extrapolates negative ticks using the first segment's bpm", () => {
    // One bar of count-in before bar 1 = -3840 ticks.
    expect(tempo.ticksToSec(-3840)).toBeCloseTo(-2, 10);
    expect(tempo.ticksToSec(-960)).toBeCloseTo(-0.5, 10);
  });

  it("secToTicks handles negative seconds symmetrically", () => {
    expect(tempo.secToTicks(-2)).toBeCloseTo(-3840, 6);
    expect(tempo.secToTicks(-0.5)).toBeCloseTo(-960, 6);
  });

  it("bpmAtTick returns the first segment's bpm for negative ticks", () => {
    expect(tempo.bpmAtTick(-3840)).toBe(120);
  });
});

describe("TempoMap: multiple sections with a bpm change", () => {
  // Section A: 2 bars @ 120bpm (ticks 0..7680), Section B: 2 bars @ 90bpm (ticks 7680..15360)
  const song = makeSong([
    { bpm: 120, bars: 2 },
    { bpm: 90, bars: 2 },
  ]);
  const tempo = new TempoMap(song);

  it("creates one segment per section, even across a bpm change", () => {
    expect(tempo.segments).toHaveLength(2);
    expect(tempo.segments[0]).toEqual({ startTick: 0, startSec: 0, bpm: 120 });
    expect(tempo.segments[1].startTick).toBe(7680);
    expect(tempo.segments[1].bpm).toBe(90);
  });

  it("computes the correct startSec of the second segment from the first segment's bpm", () => {
    const expectedSec = 7680 * secPerTick(120);
    expect(tempo.segments[1].startSec).toBeCloseTo(expectedSec, 10);
  });

  it("uses segment A's bpm strictly before the boundary tick", () => {
    expect(tempo.bpmAtTick(7679)).toBe(120);
  });

  it("uses segment B's bpm exactly at the boundary tick (inclusive boundary)", () => {
    expect(tempo.bpmAtTick(7680)).toBe(90);
  });

  it("ticksToSec is continuous across the boundary", () => {
    const secBefore = tempo.ticksToSec(7680);
    const secJustBefore = tempo.ticksToSec(7679);
    expect(secBefore - secJustBefore).toBeCloseTo(secPerTick(120), 6);
  });

  it("ticksToSec after the boundary uses the new bpm's slope", () => {
    const secAtBoundary = tempo.ticksToSec(7680);
    const secOneQuarterLater = tempo.ticksToSec(7680 + 960);
    expect(secOneQuarterLater - secAtBoundary).toBeCloseTo(960 * secPerTick(90), 10);
  });

  it("secToTicks round-trips through the section boundary", () => {
    for (const tick of [0, 3840, 7679, 7680, 7681, 11520, 15359]) {
      expect(tempo.secToTicks(tempo.ticksToSec(tick))).toBeCloseTo(tick, 5);
    }
  });

  it("bpmAtTick matches ticksToSec's slope on both sides", () => {
    expect(tempo.bpmAtTick(0)).toBe(120);
    expect(tempo.bpmAtTick(3840)).toBe(120);
    expect(tempo.bpmAtTick(15359)).toBe(90);
  });
});

describe("TempoMap: three sections, middle one repeats the previous bpm", () => {
  const song = makeSong([
    { bpm: 100, bars: 1 },
    { bpm: 100, bars: 1 }, // same bpm as previous -- still gets its own segment
    { bpm: 140, bars: 1 },
  ]);
  const tempo = new TempoMap(song);

  it("still creates a segment for the section with an unchanged bpm", () => {
    expect(tempo.segments).toHaveLength(3);
    expect(tempo.segments[1].bpm).toBe(100);
  });

  it("is harmless: ticksToSec is unaffected by the redundant segment", () => {
    const secPerTick100 = secPerTick(100);
    expect(tempo.ticksToSec(3840)).toBeCloseTo(3840 * secPerTick100, 10);
    expect(tempo.ticksToSec(7679)).toBeCloseTo(7679 * secPerTick100, 6);
  });

  it("bpm changes exactly at the third section's boundary", () => {
    expect(tempo.bpmAtTick(7679)).toBe(100);
    expect(tempo.bpmAtTick(7680)).toBe(140);
  });
});

describe("TempoMap: sections with no bars are skipped", () => {
  const song = makeSong([
    { bpm: 120, bars: 2 },
    { bpm: 200, bars: 0 },
  ]);

  it("does not create a segment for an empty section", () => {
    const tempo = new TempoMap(song);
    expect(tempo.segments).toHaveLength(1);
    expect(tempo.segments[0].bpm).toBe(120);
  });
});
