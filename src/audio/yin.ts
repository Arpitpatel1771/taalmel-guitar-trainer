// YIN pitch detection algorithm, spec 9.5. Pure function over a sample
// buffer; runs both inside pitch.worker.ts and directly in tests.
//
// Reference: de Cheveigne & Kawahara, "YIN, a fundamental frequency
// estimator for speech and music" (2002).

import { rms } from "./mathUtils";

export interface YinOptions {
  /** Absolute threshold for the cumulative mean normalized difference (0.15). */
  threshold: number;
  /** Lowest frequency (Hz) to search for (70). */
  minFreq: number;
  /** Highest frequency (Hz) to search for (1400). */
  maxFreq: number;
}

export const DEFAULT_YIN_OPTIONS: YinOptions = {
  threshold: 0.15,
  minFreq: 70,
  maxFreq: 1400,
};

/** Buffers quieter than this (Float32 full scale is +-1) are treated as
 * silence rather than risk a spurious "confident" reading. */
const SILENCE_RMS = 1e-4;

export interface PitchEstimate {
  freq: number;
  confidence: number;
}

/**
 * Estimates the fundamental frequency of `samples` using YIN. Returns null
 * for silence or when no candidate period passes the threshold search.
 */
export function yin(
  samples: Float32Array,
  sampleRate: number,
  opts: YinOptions = DEFAULT_YIN_OPTIONS
): PitchEstimate | null {
  const n = samples.length;
  if (n < 4) return null;
  if (rms(samples) < SILENCE_RMS) return null;

  const minLag = Math.max(1, Math.floor(sampleRate / opts.maxFreq));
  const maxLag = Math.min(n - 1, Math.floor(sampleRate / opts.minFreq));
  if (maxLag <= minLag) return null;

  // Difference function d(lag) = sum_i (x[i] - x[i+lag])^2
  const diff = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let sum = 0;
    const limit = n - lag;
    for (let i = 0; i < limit; i++) {
      const d = samples[i] - samples[i + lag];
      sum += d * d;
    }
    diff[lag] = sum;
  }

  // Cumulative mean normalized difference function (CMNDF).
  const cmnd = new Float64Array(maxLag + 1);
  cmnd[0] = 1;
  let runningSum = 0;
  for (let lag = 1; lag <= maxLag; lag++) {
    runningSum += diff[lag];
    cmnd[lag] = runningSum > 0 ? (diff[lag] * lag) / runningSum : 1;
  }

  // Absolute threshold: first local minimum below the threshold, searching
  // from minLag upward.
  let tau = -1;
  for (let lag = minLag; lag <= maxLag; lag++) {
    if (cmnd[lag] < opts.threshold) {
      let t = lag;
      while (t + 1 <= maxLag && cmnd[t + 1] < cmnd[t]) t++;
      tau = t;
      break;
    }
  }

  // Fallback: no dip cleared the threshold. Pick the global minimum in range
  // (still returned, but confidence will read as low).
  if (tau === -1) {
    let bestLag = minLag;
    let bestVal = cmnd[minLag];
    for (let lag = minLag + 1; lag <= maxLag; lag++) {
      if (cmnd[lag] < bestVal) {
        bestVal = cmnd[lag];
        bestLag = lag;
      }
    }
    tau = bestLag;
  }

  // Parabolic interpolation around tau for sub-sample precision.
  const x0 = tau > minLag ? tau - 1 : tau;
  const x2 = tau < maxLag ? tau + 1 : tau;
  let betterTau = tau;
  if (x0 !== tau && x2 !== tau) {
    const s0 = cmnd[x0];
    const s1 = cmnd[tau];
    const s2 = cmnd[x2];
    const denom = 2 * s1 - s2 - s0;
    if (denom !== 0) {
      betterTau = tau + (s2 - s0) / (2 * denom);
    }
  }

  const freq = sampleRate / betterTau;
  const confidence = Math.max(0, Math.min(1, 1 - cmnd[tau]));
  if (!isFinite(freq) || freq < opts.minFreq || freq > opts.maxFreq) return null;

  return { freq, confidence };
}
