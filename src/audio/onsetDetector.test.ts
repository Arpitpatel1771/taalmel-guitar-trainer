import { describe, expect, it } from "vitest";
import { OnsetDetector, DEFAULT_ONSET_CONFIG, type OnsetConfig } from "./onsetDetector";

const SAMPLE_RATE = 48000;
const FRAME = DEFAULT_ONSET_CONFIG.frameSize;

/** Deterministic pseudo-noise so tests are reproducible. */
function noise(n: number, amplitude: number, seed = 1): Float32Array {
  let s = seed;
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    // xorshift32
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    s |= 0;
    out[i] = ((s / 0x7fffffff) as number) * amplitude;
  }
  return out;
}

/** Adds a decaying sine ("pluck") into `buf` starting at `startSample`. */
function addPluck(
  buf: Float32Array,
  startSample: number,
  opts: { freq: number; amplitude: number; decayPerSec: number; sampleRate: number }
): void {
  for (let i = startSample; i < buf.length; i++) {
    const t = (i - startSample) / opts.sampleRate;
    buf[i] += opts.amplitude * Math.exp(-opts.decayPerSec * t) * Math.sin(2 * Math.PI * opts.freq * t);
  }
}

function runDetector(
  signal: Float32Array,
  cfg: OnsetConfig = DEFAULT_ONSET_CONFIG
): { onsets: number[]; slices: Map<number, Float32Array> } {
  const detector = new OnsetDetector(SAMPLE_RATE, cfg);
  const onsets: number[] = [];
  const slices = new Map<number, Float32Array>();
  for (let frame = 0; frame + FRAME <= signal.length; frame += FRAME) {
    const block = signal.subarray(frame, frame + FRAME) as Float32Array;
    const result = detector.process(block, frame);
    if (result.onsetFrame !== null) onsets.push(result.onsetFrame);
    if (result.slice) slices.set(result.slice.onsetFrame, result.slice.samples);
  }
  return { onsets, slices };
}

const INIT_SAMPLES = Math.ceil(DEFAULT_ONSET_CONFIG.noiseFloorInitSec * SAMPLE_RATE);

describe("OnsetDetector", () => {
  it("reports no onsets on quiet room noise alone", () => {
    const signal = noise(INIT_SAMPLES + SAMPLE_RATE, 0.001, 42);
    const { onsets } = runDetector(signal);
    expect(onsets).toHaveLength(0);
  });

  it("detects a single pluck after the noise-floor init period", () => {
    const totalSamples = INIT_SAMPLES + SAMPLE_RATE * 2;
    const signal = noise(totalSamples, 0.001, 7);
    const pluckStart = INIT_SAMPLES + Math.round(0.5 * SAMPLE_RATE);
    addPluck(signal, pluckStart, { freq: 220, amplitude: 0.8, decayPerSec: 6, sampleRate: SAMPLE_RATE });

    const { onsets, slices } = runDetector(signal);

    expect(onsets).toHaveLength(1);
    // Detected within one analysis frame of the true onset.
    expect(Math.abs(onsets[0] - pluckStart)).toBeLessThanOrEqual(FRAME);

    expect(slices.size).toBe(1);
    const slice = slices.get(onsets[0]);
    expect(slice).toBeDefined();
    expect(slice!.length).toBe(DEFAULT_ONSET_CONFIG.sliceLength);
    // Slice should capture real signal (onset+10ms), not silence/zeros.
    const sliceRmsSquared = slice!.reduce((acc, v) => acc + v * v, 0) / slice!.length;
    expect(Math.sqrt(sliceRmsSquared)).toBeGreaterThan(0.05);
  });

  it("detects two well-separated plucks and respects refractory between close ones", () => {
    const totalSamples = INIT_SAMPLES + SAMPLE_RATE * 3;
    const signal = noise(totalSamples, 0.001, 9);
    const firstStart = INIT_SAMPLES + Math.round(0.3 * SAMPLE_RATE);
    const secondStart = firstStart + Math.round(0.3 * SAMPLE_RATE); // 300ms later: well outside refractory
    addPluck(signal, firstStart, { freq: 196, amplitude: 0.8, decayPerSec: 8, sampleRate: SAMPLE_RATE });
    addPluck(signal, secondStart, { freq: 246, amplitude: 0.8, decayPerSec: 8, sampleRate: SAMPLE_RATE });

    const { onsets } = runDetector(signal);

    expect(onsets).toHaveLength(2);
    expect(Math.abs(onsets[0] - firstStart)).toBeLessThanOrEqual(FRAME);
    expect(Math.abs(onsets[1] - secondStart)).toBeLessThanOrEqual(FRAME);
  });

  it("suppresses a second onset within the 50ms refractory window", () => {
    const totalSamples = INIT_SAMPLES + SAMPLE_RATE * 2;
    const signal = noise(totalSamples, 0.001, 11);
    const firstStart = INIT_SAMPLES + Math.round(0.5 * SAMPLE_RATE);
    // 20ms later: inside the 50ms refractory period.
    const secondStart = firstStart + Math.round(0.02 * SAMPLE_RATE);
    addPluck(signal, firstStart, { freq: 220, amplitude: 0.8, decayPerSec: 6, sampleRate: SAMPLE_RATE });
    addPluck(signal, secondStart, { freq: 330, amplitude: 0.8, decayPerSec: 6, sampleRate: SAMPLE_RATE });

    const { onsets } = runDetector(signal);

    expect(onsets).toHaveLength(1);
    expect(Math.abs(onsets[0] - firstStart)).toBeLessThanOrEqual(FRAME);
  });

  it("does not trigger on noise whose RMS never clears the floor multiplier", () => {
    // Amplitude picked so RMS stays well under noiseFloor * 4 even with some
    // variance, since it is drawn from the same distribution as the floor.
    const signal = noise(INIT_SAMPLES + SAMPLE_RATE * 2, 0.0015, 123);
    const { onsets } = runDetector(signal);
    expect(onsets).toHaveLength(0);
  });
});
