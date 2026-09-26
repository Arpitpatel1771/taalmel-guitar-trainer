// Pitch-class comparison helper, spec 9.5: "Comparison uses pitch class only
// (ignore octave)". Kept free of a dependency on `notation` (which owns the
// canonical fretboard math) since that module is written independently of
// this one; the tuning table below mirrors notation's TUNING_MIDI (spec 6)
// for the one thing the matcher needs: a note's MIDI number.

import type { StringNumber } from "../model";

/** Standard tuning, string 1 (high E) to string 6 (low E). Mirrors spec 6. */
export const TUNING_MIDI: Record<StringNumber, number> = {
  1: 64,
  2: 59,
  3: 55,
  4: 50,
  5: 45,
  6: 40,
};

export function midiOf(stringNumber: StringNumber, fret: number): number {
  return TUNING_MIDI[stringNumber] + fret;
}

export function freqToMidi(freqHz: number): number {
  return 69 + 12 * Math.log2(freqHz / 440);
}

/** 0..11, 0 = C, ignoring octave. */
export function pitchClassOfMidi(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

export function pitchClassOfFreq(freqHz: number): number {
  return pitchClassOfMidi(freqToMidi(freqHz));
}

/** True if the detected frequency and the reference MIDI note share a pitch class. */
export function pitchClassesMatch(freqHz: number, referenceMidi: number): boolean {
  return pitchClassOfFreq(freqHz) === pitchClassOfMidi(referenceMidi);
}
