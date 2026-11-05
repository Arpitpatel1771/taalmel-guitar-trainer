// Constant-Q style filter bank, pure (no audio APIs). One complex-sinusoid correlation per
// semitone with a Hann window whose length is a fixed number of cycles (capped), so the
// bins of neighbouring semitones separate. Cheap enough at 50 frames/s for 49 bins.

import { HINT_BINS, HINT_MIDI_MAX, HINT_MIDI_MIN } from "./constants";

/** Frequency in Hz of a MIDI note (A4 = 69 = 440 Hz). */
export function midiToFreq(midi: number): number {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

/** Frequencies of every analysed semitone, index 0 = MIDI 40. */
export function semitoneFrequencies(): number[] {
  const out: number[] = [];
  for (let m = HINT_MIDI_MIN; m <= HINT_MIDI_MAX; m++) out.push(midiToFreq(m));
  return out;
}

export interface BankOptions {
  /** Window length in cycles of each pitch. */
  cycles: number;
  /** Longest window allowed, seconds (bounds latency for the low strings). */
  maxWindowSec: number;
}

export const DEFAULT_BANK_OPTIONS: BankOptions = { cycles: 22, maxWindowSec: 0.25 };

interface Kernel {
  length: number;
  cos: Float32Array;
  sin: Float32Array;
  /** 2 / sum(window): makes a sine of amplitude A read as A. */
  norm: number;
}

export class FilterBank {
  readonly kernels: Kernel[] = [];
  /** Longest window in samples: the history a caller must keep. */
  readonly maxLength: number;

  constructor(readonly sampleRate: number, options: BankOptions = DEFAULT_BANK_OPTIONS) {
    let max = 0;
    for (const f of semitoneFrequencies()) {
      const length = Math.max(64, Math.round(Math.min((options.cycles * sampleRate) / f, options.maxWindowSec * sampleRate)));
      const cos = new Float32Array(length);
      const sin = new Float32Array(length);
      let sum = 0;
      for (let n = 0; n < length; n++) {
        const w = 0.5 - 0.5 * Math.cos((2 * Math.PI * (n + 0.5)) / length);
        const phase = (2 * Math.PI * f * n) / sampleRate;
        cos[n] = w * Math.cos(phase);
        sin[n] = w * Math.sin(phase);
        sum += w;
      }
      this.kernels.push({ length, cos, sin, norm: 2 / sum });
      if (length > max) max = length;
    }
    this.maxLength = max;
  }

  /**
   * Amplitude per semitone for the window that ends just before `end` (exclusive) in
   * `samples`. Bins whose window reaches before index 0 see zeros there.
   */
  analyze(samples: Float32Array, end: number = samples.length): Float32Array {
    const out = new Float32Array(HINT_BINS);
    for (let k = 0; k < HINT_BINS; k++) {
      const { length, cos, sin, norm } = this.kernels[k];
      const start = end - length;
      let re = 0;
      let im = 0;
      for (let n = Math.max(0, -start); n < length; n++) {
        const x = samples[start + n];
        re += x * cos[n];
        im += x * sin[n];
      }
      out[k] = norm * Math.sqrt(re * re + im * im);
    }
    return out;
  }
}

/** Amplitudes below this are treated as silence (-60 dBFS). */
const FLOOR = 1e-3;
/** dB above the frame median that maps to 255. */
const RANGE_DB = 60;

/**
 * Log-compress and whiten one frame of amplitudes: dB, minus the frame median, scaled so
 * 0 dB over the median is 0 and `RANGE_DB` over it is 255. Silence gives all zeros.
 */
export function whitenFrame(amplitudes: ArrayLike<number>): Uint8Array {
  const db = new Float64Array(amplitudes.length);
  for (let i = 0; i < db.length; i++) db[i] = 20 * Math.log10(Math.max(amplitudes[i], FLOOR));
  const sorted = Array.from(db).sort((a, b) => a - b);
  const median = sorted[sorted.length >> 1];
  const out = new Uint8Array(db.length);
  for (let i = 0; i < db.length; i++) {
    const v = ((db[i] - median) / RANGE_DB) * 255;
    out[i] = v <= 0 ? 0 : v >= 255 ? 255 : Math.round(v);
  }
  return out;
}

/**
 * Offline helper (tests, tools): frames for a whole signal at `frameRate` per second.
 * Frame i covers the window ending at sample (i + 1) * hop.
 */
export function analyzeSignal(samples: Float32Array, sampleRate: number, frameRate: number, bank?: FilterBank): Uint8Array[] {
  const b = bank ?? new FilterBank(sampleRate);
  const hop = Math.round(sampleRate / frameRate);
  const frames: Uint8Array[] = [];
  for (let end = hop; end <= samples.length; end += hop) frames.push(whitenFrame(b.analyze(samples, end)));
  return frames;
}
