import { describe, expect, it } from "vitest";
import { parse } from "../songFormat";
import { TempoMap } from "../tempo";
import { buildPlayPlan, renderPluck } from "./guitarSynth";
import { yin } from "./yin";

function plan(body: string, header = "title: T\ntime: 4/4\nbpm: 60\nunit: 4\n\n[A]\n") {
  const r = parse(header + body + "\n");
  if (!r.ok) throw new Error(r.errors.map((e) => e.message).join("; "));
  return buildPlayPlan(r.song, new TempoMap(r.song));
}

describe("renderPluck", () => {
  it("produces a decaying tone at the requested pitch", () => {
    const sr = 48000;
    const buf = renderPluck(110, sr);
    expect(buf.length).toBe(Math.floor(2.5 * sr));
    const est = yin(buf.subarray(2048, 2048 + 4096), sr);
    expect(est).not.toBeNull();
    expect(Math.abs(1200 * Math.log2(est!.freq / 110))).toBeLessThan(20);
    const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);
    expect(rms(buf.subarray(0, 4800))).toBeGreaterThan(rms(buf.subarray(sr * 2, sr * 2 + 4800)));
  });

  it("makes muted notes short", () => {
    expect(renderPluck(110, 48000, true).length).toBeLessThan(48000 * 0.3);
  });
});

describe("buildPlayPlan", () => {
  it("plucks each normal note at its time with its fretted pitch", () => {
    const p = plan("Bar 1: {1} 1S0 {3} 2S1");
    expect(p.map((v) => [v.sec, v.midi])).toEqual([
      [0, 64],
      [2, 60],
    ]);
  });

  it("does not re-pluck hammer, pull or slide; it changes pitch instead", () => {
    const p = plan("Bar 1: {1} 1S3 {2} 1S5(hammer) {3} 1S3(pull) {4} 1S7(slide)");
    expect(p).toHaveLength(1);
    expect(p[0].changes.map((c) => [c.sec, c.midi, c.glideSec > 0])).toEqual([
      [1, 69, false],
      [2, 67, false],
      [3, 71, true],
    ]);
  });

  it("bends a same-fret note without re-plucking, and plucks a fresh bend", () => {
    const same = plan("Bar 1: {1} 2S7 {3} 2S7(bend: 2) {4} 2S7(bend: 0)");
    expect(same).toHaveLength(1);
    expect(same[0].changes.map((c) => c.midi)).toEqual([68, 66]);
    const fresh = plan("Bar 1: {1} 2S7(bend: 2)");
    expect(fresh).toHaveLength(1);
    expect(fresh[0].changes.map((c) => c.midi)).toEqual([68]);
  });

  it("spreads strums: down from string 6, up from string 1", () => {
    const down = plan("Bar 1: {1} 1S0(strum: down) 6S0");
    const s6 = down.find((v) => v.string === 6)!;
    const s1 = down.find((v) => v.string === 1)!;
    expect(s6.sec).toBeLessThan(s1.sec);
    const up = plan("Bar 1: {1} 1S0(strum: up) 6S0");
    expect(up.find((v) => v.string === 1)!.sec).toBeLessThan(up.find((v) => v.string === 6)!.sec);
  });

  it("cuts a ringing string when it is plucked again", () => {
    const p = plan("Bar 1: {1} 1S0[4] {2} 1S2");
    expect(p[0].endSec).toBeCloseTo(1, 6);
  });
});
