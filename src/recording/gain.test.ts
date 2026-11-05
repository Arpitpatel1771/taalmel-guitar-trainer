import { describe, expect, it } from "vitest";
import { computeGainDb } from "./gain";

const RATE = 8000;
function tone(peakDb: number, sec = 2) {
  const amp = 10 ** (peakDb / 20);
  return Float32Array.from({ length: RATE * sec }, (_, i) => amp * Math.sin((2 * Math.PI * 220 * i) / RATE));
}

describe("computeGainDb", () => {
  it("boosts a quiet clip towards -16 dBFS RMS", () => {
    // Sine: RMS is 3 dB under the peak, so a -26 dB peak is -29 dB RMS: +13 dB.
    expect(computeGainDb(tone(-26), RATE)).toBeCloseTo(13, 0);
  });

  it("is limited by the peak when one loud spike sits in a quiet clip", () => {
    const s = tone(-30);
    s[5000] = 10 ** (-12 / 20);
    // RMS wants about +14 dB but the spike allows only 11 dB.
    expect(computeGainDb(s, RATE)).toBeCloseTo(11, 0);
  });

  it("returns 0 for a clip that is already loud", () => {
    expect(computeGainDb(tone(-3), RATE)).toBe(0);
    expect(computeGainDb(tone(-10), RATE)).toBe(0); // under 1 dB of headroom to the target
  });

  it("returns 0 for silence and near-silence", () => {
    expect(computeGainDb(new Float32Array(RATE), RATE)).toBe(0);
    expect(computeGainDb(new Float32Array(0), RATE)).toBe(0);
    expect(computeGainDb(tone(-70), RATE)).toBe(0);
  });

  it("ignores silence around the playing", () => {
    const quiet = tone(-26, 1);
    const padded = new Float32Array(RATE * 5);
    padded.set(quiet, RATE * 2);
    expect(computeGainDb(padded, RATE)).toBeCloseTo(computeGainDb(quiet, RATE), 0);
  });

  it("clamps at 24 dB", () => {
    expect(computeGainDb(tone(-45), RATE)).toBe(24);
  });
});
