// What the sheet shows for one matcher verdict (specs/5-11-ui-redesign.md 6.1).
// Pure: colour is timing only, early/late ticks for close/off, a played-note
// label for a wrong pitch. The DOM side lives in verdictMarks.ts.

import type { Verdict } from "../model";
import { noteNameWithOctave, soundingMidi } from "../notation";

export type TimingLook = "ontime" | "off" | "missed";

export interface VerdictLook {
  /** Fret number colour: on time and close are both "ontime". */
  timing: TimingLook;
  /** Early/late tick beside the number, for close and off only. */
  tick: "early" | "late" | null;
  /** Number is underlined (off tier), so colour is not the only cue. */
  underline: boolean;
  /** Note actually played when the pitch was wrong: "F", or "E3" when only the octave differs. */
  playedLabel: string | null;
}

/** Label for the note heard instead of `expectedMidi`. */
export function playedNoteLabel(playedMidi: number, expectedMidi: number, flat: boolean): string {
  const full = noteNameWithOctave(playedMidi, flat ? "flats" : "sharps");
  const sameClass = (((playedMidi - expectedMidi) % 12) + 12) % 12 === 0;
  return sameClass ? full : full.replace(/-?\d+$/, "");
}

/** Null for "extra" verdicts (they draw a dot, not a note mark). */
export function verdictLook(v: Verdict): VerdictLook | null {
  if (v.kind === "extra") return null;
  if (v.kind === "missed") return { timing: "missed", tick: null, underline: false, playedLabel: null };
  const tier = v.tier ?? "off";
  const timing: TimingLook = tier === "off" ? "off" : "ontime";
  const tick = tier === "onTime" || v.errorMs === undefined ? null : v.errorMs < 0 ? "early" : "late";
  let playedLabel: string | null = null;
  const notes = v.expected?.notes ?? [];
  if (v.pitch === "wrong" && v.playedMidi !== undefined && notes.length === 1 && v.expected) {
    const n = notes[0];
    playedLabel = playedNoteLabel(v.playedMidi, soundingMidi(n.string, n.fret, v.expected.capo), !!n.meta.flat);
  }
  return { timing, tick, underline: tier === "off", playedLabel };
}
