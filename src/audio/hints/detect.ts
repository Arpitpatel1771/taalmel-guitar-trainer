// Per-frame pitch and onset detection over whitened frames (Uint8 0..255 per semitone).
// Pure functions.

import { HINT_BINS, HINT_MIDI_MIN } from "./constants";

export interface PitchOptions {
  /** Lowest value the top bin must reach after folding. */
  minLevel: number;
  /** How far the top bin must stand above the best non-neighbouring bin. */
  margin: number;
  /** Fraction of a strong bin's value removed from its harmonic bins. */
  fold: number;
  /** A bin must reach this to fold its harmonics. */
  foldMin: number;
}

export const DEFAULT_PITCH_OPTIONS: PitchOptions = { minLevel: 60, margin: 25, fold: 0.6, foldMin: 90 };

/** Semitone offsets of harmonics 2, 3, 4, 5: an octave, octave + fifth, two octaves, + a third. */
const HARMONIC_OFFSETS = [12, 19, 24, 28];

/**
 * The single clearest pitch of a frame as a MIDI note, or null when nothing clearly leads.
 * Bins that sit at harmonic offsets above a strong bin are reduced first (octave/fifth
 * folding), which cuts octave errors on harmonic-rich tones.
 */
export function strongestPitch(frame: ArrayLike<number>, options: PitchOptions = DEFAULT_PITCH_OPTIONS): number | null {
  const v = Array.from(frame as ArrayLike<number>);
  for (let k = 0; k < HINT_BINS; k++) {
    if (v[k] < options.foldMin) continue;
    for (const off of HARMONIC_OFFSETS) {
      const j = k + off;
      if (j < HINT_BINS) v[j] = Math.max(0, v[j] - options.fold * v[k]);
    }
  }
  let best = 0;
  for (let k = 1; k < HINT_BINS; k++) if (v[k] > v[best]) best = k;
  if (v[best] < options.minLevel) return null;
  let rival = 0;
  for (let k = 0; k < HINT_BINS; k++) {
    if (Math.abs(k - best) <= 1) continue;
    if (v[k] > rival) rival = v[k];
  }
  if (v[best] - rival < options.margin) return null;
  return HINT_MIDI_MIN + best;
}

export interface OnsetOptions {
  /** Minimum time between two onsets, seconds. */
  minGapSec: number;
  /** Absolute flux floor (sum of rises over all bins). */
  minFlux: number;
  /** A peak must exceed this multiple of the local mean flux. */
  localFactor: number;
}

export const DEFAULT_ONSET_OPTIONS: OnsetOptions = { minGapSec: 0.06, minFlux: 400, localFactor: 2 };

/** Spectral flux per frame: total positive change since the previous frame. */
export function spectralFlux(frames: ArrayLike<ArrayLike<number>>): Float64Array {
  const flux = new Float64Array(frames.length);
  for (let t = 1; t < frames.length; t++) {
    let sum = 0;
    for (let k = 0; k < HINT_BINS; k++) {
      const d = frames[t][k] - frames[t - 1][k];
      if (d > 0) sum += d;
    }
    flux[t] = sum;
  }
  return flux;
}

/** Note-start times (seconds from frame 0) by spectral-flux peak picking. */
export function pickOnsets(frames: ArrayLike<ArrayLike<number>>, frameRate: number, options: OnsetOptions = DEFAULT_ONSET_OPTIONS): number[] {
  const flux = spectralFlux(frames);
  const n = flux.length;
  const half = Math.round(frameRate * 0.5);
  const minGap = Math.max(1, Math.round(options.minGapSec * frameRate));
  const peaks: number[] = [];
  for (let t = 1; t < n; t++) {
    if (flux[t] < options.minFlux) continue;
    if (flux[t] <= flux[t - 1] || (t + 1 < n && flux[t] < flux[t + 1])) continue;
    let sum = 0;
    let count = 0;
    for (let i = Math.max(0, t - half); i <= Math.min(n - 1, t + half); i++) {
      sum += flux[i];
      count++;
    }
    if (flux[t] < options.localFactor * (sum / count)) continue;
    const last = peaks[peaks.length - 1];
    if (last !== undefined && t - last < minGap) {
      if (flux[t] > flux[last]) peaks[peaks.length - 1] = t;
      continue;
    }
    peaks.push(t);
  }
  return peaks.map((t) => t / frameRate);
}
