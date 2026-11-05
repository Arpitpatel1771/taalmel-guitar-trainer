// Pitch helpers. Spec 9.5 originally compared pitch class only; since
// 2026-11-05 the matcher checks the exact pitch incl. octave (specs/5-11-ui-redesign.md 6.2). A note's MIDI number comes from notation's soundingMidi.

export function freqToMidi(freqHz: number, a4Hz = 440): number {
  return 69 + 12 * Math.log2(freqHz / a4Hz);
}

/** 0..11, 0 = C, ignoring octave. */
export function pitchClassOfMidi(midi: number): number {
  return ((Math.round(midi) % 12) + 12) % 12;
}

export function pitchClassOfFreq(freqHz: number, a4Hz = 440): number {
  return pitchClassOfMidi(freqToMidi(freqHz, a4Hz));
}

/** True if the detected frequency and the reference MIDI note share a pitch class. */
export function pitchClassesMatch(freqHz: number, referenceMidi: number, a4Hz = 440): boolean {
  return pitchClassOfFreq(freqHz, a4Hz) === pitchClassOfMidi(referenceMidi);
}
