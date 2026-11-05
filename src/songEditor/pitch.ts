// Pitch helpers. The open-string table lives in `notation` (soundingMidi); nothing is duplicated here.

import type { StringNumber } from "../model/index.js";
import { letterOfNote, noteNameWithOctave, soundingMidi } from "../notation/index.js";
import type { EdDoc, EdNote } from "./types.js";
import { capoAtTick } from "./doc.js";

export const STRINGS: readonly StringNumber[] = [1, 2, 3, 4, 5, 6];
export const MAX_FRET = 24;
/** Roll range, sounding pitch: E2..E6. */
export const ROLL_MIN_MIDI = 40;
export const ROLL_MAX_MIDI = 88;

const BLACK = new Set([1, 3, 6, 8, 10]);

export function isBlackKey(midi: number): boolean {
  return BLACK.has(((midi % 12) + 12) % 12);
}

export interface Position {
  string: StringNumber;
  fret: number;
}

/** Highest fret (relative to the capo) a note may use. */
export function maxFret(capo: number): number {
  return MAX_FRET - capo;
}

/** Every (string, fret) that sounds `midi` under `capo`, lowest fret first. */
export function positionsFor(midi: number, capo: number): Position[] {
  const out: Position[] = [];
  for (const s of STRINGS) {
    const fret = midi - soundingMidi(s, 0, capo);
    if (fret >= 0 && fret <= maxFret(capo)) out.push({ string: s, fret });
  }
  return out.sort((a, b) => a.fret - b.fret || a.string - b.string);
}

/** Sounding MIDI of a note, using the capo of the bar it starts in. */
export function noteMidi(doc: EdDoc, n: EdNote): number {
  return soundingMidi(n.string, n.fret, capoAtTick(doc, n.startTick));
}

/** "E4", "C#5", or "Db5" when `flat` is set. */
export function noteName(midi: number, flat = false): string {
  return noteNameWithOctave(midi, flat ? "flats" : "sharps");
}

/** Name of a note as the song spells it (respects the note's flat flag). */
export function noteLabel(doc: EdDoc, n: EdNote): string {
  return letterOfNote(
    { ...n, source: { line: 0, column: 0 } },
    capoAtTick(doc, n.startTick),
  );
}
