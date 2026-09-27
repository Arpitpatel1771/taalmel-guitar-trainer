import { describe, expect, it } from "vitest";
import { centsOff, foldOctave, median, midiToFreq, noteName, readTuner } from "./tuner";
import { yin } from "./yin";

describe("tuner math", () => {
  it("maps open strings to the right targets at A4=440", () => {
    const expected: [number, string, number][] = [
      [1, "E4", 329.63],
      [2, "B3", 246.94],
      [3, "G3", 196.0],
      [4, "D3", 146.83],
      [5, "A2", 110.0],
      [6, "E2", 82.41],
    ];
    for (const [s, name, hz] of expected) {
      const r = readTuner(hz, 440);
      expect(r.string).toBe(s);
      expect(r.targetName).toBe(name);
      expect(Math.abs(r.cents)).toBeLessThan(1);
    }
  });

  it("reports sharp as positive and flat as negative cents", () => {
    expect(centsOff(midiToFreq(45) * Math.pow(2, 10 / 1200), midiToFreq(45))).toBeCloseTo(10, 6);
    expect(readTuner(108, 440).cents).toBeLessThan(0); // A2 is 110 Hz
  });

  it("uses the A4 reference", () => {
    expect(readTuner(108, 432).cents).toBeCloseTo(0, 0); // A2 at 432 = 108 Hz
  });

  it("folds octave errors when a string is locked", () => {
    expect(foldOctave(164.82, 82.41)).toBeCloseTo(82.41, 2);
    const r = readTuner(164.82, 440, 6);
    expect(r.string).toBe(6);
    expect(Math.abs(r.cents)).toBeLessThan(1);
  });

  it("names notes and takes medians", () => {
    expect(noteName(69)).toBe("A4");
    expect(median([5, 1, 3])).toBe(3);
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it("detects each open string's pitch from a synthetic tone", () => {
    const sr = 48000;
    for (const midi of [40, 45, 50, 55, 59, 64]) {
      const f = midiToFreq(midi);
      const buf = new Float32Array(4096);
      for (let i = 0; i < buf.length; i++) {
        const t = i / sr;
        buf[i] = 0.6 * Math.sin(2 * Math.PI * f * t) + 0.3 * Math.sin(2 * Math.PI * 2 * f * t) + 0.1 * Math.sin(2 * Math.PI * 3 * f * t);
      }
      const est = yin(buf, sr);
      expect(est).not.toBeNull();
      expect(Math.abs(readTuner(est!.freq).cents)).toBeLessThan(5);
    }
  });
});
