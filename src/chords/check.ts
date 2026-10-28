// Validates a voicing against a chord (spec section 1, "Checker").

import { OPEN_STRING_MIDI } from "../audio/tuner.js";
import type { StringNumber } from "../model/index.js";
import { chordToneNames, chordType, mod12, pcName, spellingFamily } from "./theory.js";
import type { CheckResult, ChordTypeId, Spelling, StringInfo, Voicing } from "./types.js";

const GENERIC_INTERVALS = ["R", "b2", "2", "b3", "3", "4", "b5", "5", "#5", "6", "b7", "7"];

/** Strings in `frets` order. */
export const STRING_ORDER: StringNumber[] = [6, 5, 4, 3, 2, 1];

export interface CheckOptions {
  /** Pitch class of the bass for a slash chord; upper notes are checked against the chord. */
  bassPc?: number;
  spelling?: Spelling;
}

export function checkVoicing(voicing: Voicing, rootPc: number, typeId: ChordTypeId, opts: CheckOptions = {}): CheckResult {
  const type = chordType(typeId);
  const root = mod12(rootPc);
  const errors: string[] = [];
  const family = spellingFamily(root, typeId, opts.spelling ?? "sharp");
  const toneNames = chordToneNames(root, typeId, opts.spelling ?? "sharp");
  const formula = new Set(type.tones.map((t) => t.semi));
  const required = type.tones.map((t) => t.semi).filter((s) => !type.optional.includes(s));

  const strings: (StringInfo | null)[] = voicing.frets.map((fret, i) => {
    if (fret === null) return null;
    const string = STRING_ORDER[i];
    const midi = OPEN_STRING_MIDI[string] + fret;
    const pc = mod12(midi);
    const semi = mod12(pc - root);
    const tone = type.tones.find((t) => t.semi === semi);
    return { string, fret, midi, pc, interval: tone ? tone.label : GENERIC_INTERVALS[semi], note: toneNames.get(pc) ?? pcName(pc, family) };
  });

  const sounding = strings.filter((s): s is StringInfo => s !== null);
  if (sounding.length < 2) errors.push("fewer than two sounding strings");

  // Notes.
  const lowest = sounding.length > 0 ? sounding.reduce((a, b) => (b.midi < a.midi ? b : a)) : null;
  // A slash chord's bass is not part of the chord; only the notes above it are.
  const upper = opts.bassPc === undefined ? sounding : sounding.filter((s) => s !== lowest);
  const present = new Set(upper.map((s) => mod12(s.pc - root)));
  for (const semi of required) {
    if (!present.has(semi)) errors.push(`missing ${type.tones.find((t) => t.semi === semi)?.label}`);
  }
  for (const s of upper) {
    if (!formula.has(mod12(s.pc - root))) errors.push(`note ${s.note} on string ${s.string} is not in the chord`);
  }
  if (lowest) {
    const wantBass = opts.bassPc === undefined ? root : mod12(opts.bassPc);
    if (lowest.pc !== wantBass) errors.push(`lowest note is ${lowest.note}, expected ${pcName(wantBass, family)}`);
  }

  // Playability.
  voicing.frets.forEach((fret, i) => {
    const finger = voicing.fingers[i];
    const label = `string ${STRING_ORDER[i]}`;
    if (finger !== null) {
      if (finger < 1 || finger > 4) errors.push(`${label}: finger ${finger} out of range`);
      if (fret === null || fret < 1) errors.push(`${label}: finger on an open or muted string`);
    } else if (fret !== null && fret > 0) {
      errors.push(`${label}: fretted without a finger`);
    }
  });
  const used = new Set(voicing.fingers.filter((f): f is number => f !== null));
  if (used.size > 4) errors.push("more than 4 fingers");
  const fretted = voicing.frets.filter((f): f is number => f !== null && f > 0);
  if (fretted.length > 0 && Math.max(...fretted) - Math.min(...fretted) > 4) errors.push("fret span over 4");

  const barre = voicing.barre;
  if (barre) {
    const lo = Math.min(barre.fromString, barre.toString);
    const hi = Math.max(barre.fromString, barre.toString);
    if (hi === lo) errors.push("barre covers a single string");
    if (barre.finger !== 1) errors.push("barre must use finger 1");
    for (let s = lo; s <= hi; s++) {
      const i = STRING_ORDER.indexOf(s as StringNumber);
      const fret = voicing.frets[i];
      if (fret === null || fret < barre.fret) errors.push(`barre string ${s} does not sound at or above fret ${barre.fret}`);
      else if (fret === barre.fret && voicing.fingers[i] !== 1) errors.push(`barre string ${s} is not finger 1`);
    }
  }

  return { ok: errors.length === 0, errors, strings };
}
