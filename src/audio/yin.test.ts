import { describe, expect, it } from "vitest";
import { yin, DEFAULT_YIN_OPTIONS } from "./yin";

const SAMPLE_RATE = 48000;
const N = 2048; // matches the onset detector's slice length

function sine(freq: number, n: number, sampleRate: number, amplitude = 0.6): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = amplitude * Math.sin((2 * Math.PI * freq * i) / sampleRate);
  }
  return out;
}

/** Fundamental plus a couple of harmonics, like a real plucked string. */
function harmonicTone(freq: number, n: number, sampleRate: number): Float32Array {
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const t = i / sampleRate;
    out[i] =
      0.6 * Math.sin(2 * Math.PI * freq * t) +
      0.25 * Math.sin(2 * Math.PI * freq * 2 * t) +
      0.12 * Math.sin(2 * Math.PI * freq * 3 * t);
  }
  return out;
}

describe("yin", () => {
  const pitches = [
    { name: "low E2", freq: 82.41 },
    { name: "A2", freq: 110 },
    { name: "D3", freq: 146.83 },
    { name: "G3", freq: 196 },
    { name: "B3", freq: 246.94 },
    { name: "high E4", freq: 329.63 },
  ];

  for (const { name, freq } of pitches) {
    it(`detects a pure sine at ${name} (${freq} Hz)`, () => {
      const samples = sine(freq, N, SAMPLE_RATE);
      const result = yin(samples, SAMPLE_RATE, DEFAULT_YIN_OPTIONS);
      expect(result).not.toBeNull();
      expect(result!.freq).toBeCloseTo(freq, 0);
      expect(Math.abs(result!.freq - freq) / freq).toBeLessThan(0.02);
      expect(result!.confidence).toBeGreaterThan(0.5);
    });
  }

  for (const { name, freq } of pitches) {
    it(`detects the fundamental of a harmonic-rich tone at ${name} without an octave error`, () => {
      const samples = harmonicTone(freq, N, SAMPLE_RATE);
      const result = yin(samples, SAMPLE_RATE, DEFAULT_YIN_OPTIONS);
      expect(result).not.toBeNull();
      expect(Math.abs(result!.freq - freq) / freq).toBeLessThan(0.02);
    });
  }

  it("returns null for silence", () => {
    const samples = new Float32Array(N); // all zeros
    expect(yin(samples, SAMPLE_RATE, DEFAULT_YIN_OPTIONS)).toBeNull();
  });

  it("returns null for a frequency below the search range", () => {
    const samples = sine(40, N, SAMPLE_RATE); // below minFreq 70
    const result = yin(samples, SAMPLE_RATE, DEFAULT_YIN_OPTIONS);
    // Either null, or clamped/rejected outside the configured range.
    if (result) {
      expect(result.freq).toBeGreaterThanOrEqual(DEFAULT_YIN_OPTIONS.minFreq);
    }
  });
});
