// Tuner math (pure, Node-testable). Standard tuning only (spec 2): string
// targets are the open-string MIDI notes 64, 59, 55, 50, 45, 40 relative to a
// configurable A4 reference.

import type { StringNumber } from "../model";

export const OPEN_STRING_MIDI: Record<StringNumber, number> = { 1: 64, 2: 59, 3: 55, 4: 50, 5: 45, 6: 40 };
const NAMES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

export function midiToFreq(midi: number, a4Hz = 440): number {
  return a4Hz * Math.pow(2, (midi - 69) / 12);
}

export function freqToMidi(freq: number, a4Hz = 440): number {
  return 69 + 12 * Math.log2(freq / a4Hz);
}

/** Signed cents from `target` to `freq` (+ = sharp). */
export function centsOff(freq: number, target: number): number {
  return 1200 * Math.log2(freq / target);
}

export function noteName(midi: number): string {
  const m = Math.round(midi);
  return `${NAMES[((m % 12) + 12) % 12]}${Math.floor(m / 12) - 1}`;
}

export interface TunerReading {
  freq: number;
  string: StringNumber;
  targetFreq: number;
  targetName: string;
  cents: number;
}

/** Folds `freq` by octaves toward `target` (fixes YIN octave errors when the
 * player has chosen which string they are tuning). */
export function foldOctave(freq: number, target: number): number {
  let f = freq;
  while (f / target > Math.SQRT2) f /= 2;
  while (target / f > Math.SQRT2) f *= 2;
  return f;
}

/** Reading against the nearest open string, or against `lockString` if given. */
export function readTuner(freq: number, a4Hz = 440, lockString?: StringNumber): TunerReading {
  let best: StringNumber = 1;
  if (lockString) {
    best = lockString;
  } else {
    let bestAbs = Infinity;
    for (const s of [1, 2, 3, 4, 5, 6] as StringNumber[]) {
      const abs = Math.abs(centsOff(freq, midiToFreq(OPEN_STRING_MIDI[s], a4Hz)));
      if (abs < bestAbs) {
        bestAbs = abs;
        best = s;
      }
    }
  }
  const targetFreq = midiToFreq(OPEN_STRING_MIDI[best], a4Hz);
  const f = lockString ? foldOctave(freq, targetFreq) : freq;
  return { freq: f, string: best, targetFreq, targetName: noteName(OPEN_STRING_MIDI[best]), cents: centsOff(f, targetFreq) };
}

/** Median of the last readings, to steady the needle. */
export function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Within this many cents counts as in tune. */
export const IN_TUNE_CENTS = 3;
