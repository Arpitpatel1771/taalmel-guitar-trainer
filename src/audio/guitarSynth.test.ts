import { describe, expect, it } from "vitest";
import { parse } from "../songFormat";
import { TempoMap } from "../tempo";
import { PPQ } from "../model";
import { GuitarPlayer, buildPlayPlan, renderPluck } from "./guitarSynth";
import type { Clock } from "../clock";
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
  it("lets a note ring past its bar line for its full length", () => {
    const p = plan("Bar 1: {4} 1S0[3]\nBar 2:");
    expect(p).toHaveLength(1);
    expect(p[0].sec).toBe(3);
    expect(p[0].endSec).toBe(6); // 3 beats at 60 bpm from beat 4 of bar 1
  });

  it("plucks each normal note at its time with its fretted pitch", () => {
    const p = plan("Bar 1: {1} 1S0 {3} 2S1");
    expect(p.map((v) => [v.sec, v.midi])).toEqual([
      [0, 64],
      [2, 60],
    ]);
  });

  it("sounds two semitones up under a capo-2 bar", () => {
    const p = plan("Bar 1: {1} 1S0 {3} 2S1", "title: T\ntime: 4/4\nbpm: 60\nunit: 4\ncapo: 2\n\n[A]\n");
    expect(p.map((v) => v.midi)).toEqual([66, 62]);
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

// Regression: pressing play exactly on a bar line skipped the note there, because the clock had always
// moved on a few ms before the first scheduler tick found it, and late notes were dropped.
describe("GuitarPlayer start of playback", () => {
  const r4 = () => PPQ * 4;
  function setup() {
    const r = parse("title: T\ntime: 4/4\nbpm: 60\nunit: 4\n\n[A]\nBar 1: {1} 1S5\nBar 2: {1} 1S7\n");
    if (!r.ok) throw new Error("parse");
    const starts: number[] = [];
    const param = () => ({ value: 1, setValueAtTime() {}, linearRampToValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
    const ctx = {
      currentTime: 10,
      sampleRate: 8000,
      destination: {},
      createGain: () => ({ gain: param(), connect() {}, disconnect() {} }),
      createBuffer: () => ({ copyToChannel() {} }),
      createBufferSource: () => ({ buffer: null, playbackRate: param(), connect() {}, start: (t: number) => starts.push(t), stop() {} }),
      createOscillator: () => ({ frequency: { value: 0 }, connect() {}, start() {}, stop() {} }),
    };
    let sec = 0;
    const state = new Set<(s: { playing: boolean }) => void>();
    const loops = new Set<() => void>();
    let loop: { startTick: number; endTick: number } | null = null;
    const clock = {
      isPlaying: () => true,
      unclampedPositionSec: () => sec,
      speed: () => 1,
      loop: () => loop,
      onLoop: (cb: () => void) => (loops.add(cb), () => loops.delete(cb)),
      onStateChange: (cb: (s: { playing: boolean }) => void) => (state.add(cb), () => state.delete(cb)),
    };
    const player = new GuitarPlayer(ctx as unknown as AudioContext, r.song, new TempoMap(r.song));
    player.attach(clock as unknown as Clock);
    player.setEnabled(true);
    return {
      player,
      starts,
      at(s: number) {
        sec = s;
      },
      fire: () => state.forEach((cb) => cb({ playing: true })),
      setLoop(l: { startTick: number; endTick: number } | null) {
        loop = l;
      },
      wrap: () => loops.forEach((cb) => cb()),
      tick: () => (player as unknown as { tick(): void }).tick(),
    };
  }

  it("plays the note on the play-from point even when the clock is already a little past it", () => {
    const h = setup();
    h.player.armFrom(4); // bar 2 starts at 4 s
    h.at(4.03);
    h.fire();
    h.tick();
    expect(h.starts).toEqual([10]);
  });

  it("plays the note on a plain play press even though the clock reports playing a moment late", () => {
    const h = setup();
    h.at(4.02);
    h.fire();
    h.tick();
    expect(h.starts).toEqual([10]);
  });

  it("plays the loop's first note on every pass, though the wrap is noticed late", () => {
    const h = setup();
    const bar = r4();
    h.setLoop({ startTick: bar, endTick: 2 * bar }); // loop bar 2 (its note is at 4 s)
    h.player.armFrom(4);
    h.at(4.01);
    h.fire();
    h.tick();
    h.at(7.9);
    h.tick();
    h.at(4.04); // wrapped back to the loop start, found 40 ms late
    h.wrap();
    h.tick();
    expect(h.starts.length).toBe(2);
  });

  it("still drops notes well before the play-from point", () => {
    const h = setup();
    h.player.armFrom(4.5);
    h.at(4.52);
    h.fire();
    h.tick();
    expect(h.starts).toEqual([]);
  });
});
