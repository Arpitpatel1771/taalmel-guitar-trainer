// Fretboard math and per-display-notation mappers (spec sections 6, 8.2, 8.3).
// Pure functions only. Depends on `model` types.

import type { Note, StringNumber } from "../model/index.js";

/** Standard tuning, MIDI note number of the open string. String 1 = high E. */
export const TUNING_MIDI: Record<StringNumber, number> = {
  1: 64,
  2: 59,
  3: 55,
  4: 50,
  5: 45,
  6: 40,
};

const SHARP_NAMES = [
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
] as const;

const FLAT_NAMES = [
  "C",
  "Db",
  "D",
  "Eb",
  "E",
  "F",
  "Gb",
  "G",
  "Ab",
  "A",
  "Bb",
  "B",
] as const;

/** MIDI number for a (string, fret) position. */
export function pitchOf(string: StringNumber, fret: number): number {
  return TUNING_MIDI[string] + fret;
}

/** Sharp/flat spelling choice. Internal, low-level: callers with a `Note` should
 * use `letterOfNote` instead, which picks this from the note's own `meta.flat`. */
type Accidentals = "sharps" | "flats";

/** Letter name (no octave) for a MIDI number, e.g. "C#" or "Db". Low-level helper:
 * prefer `letterOfNote` when you have a `Note`, since there is no user-facing
 * sharps/flats setting -- spelling is per-note (`meta.flat`). */
export function letterOf(midi: number, accidentals: Accidentals): string {
  const pitchClass = ((midi % 12) + 12) % 12;
  const table = accidentals === "flats" ? FLAT_NAMES : SHARP_NAMES;
  return table[pitchClass];
}

/** Letter name with octave, e.g. "E4". Octave follows the convention where MIDI 60 = C4. */
export function noteNameWithOctave(midi: number, accidentals: Accidentals): string {
  const octave = Math.floor(midi / 12) - 1;
  return `${letterOf(midi, accidentals)}${octave}`;
}

/** Letter name (no octave) for a note, spelled as a flat when `note.meta.flat` is
 * set, sharp otherwise (the default). This is the note's own spelling: there is no
 * global sharps/flats setting, a song can mix both. */
export function letterOfNote(note: Note): string {
  return letterOf(pitchOf(note.string, note.fret), note.meta.flat ? "flats" : "sharps");
}

/** A note is "picked" (has an audible attack) unless it is reached via a connection flag. */
export function isPicked(note: Note): boolean {
  return !note.meta.connection;
}

export type TeacherGlyph =
  | { kind: "teacher"; letter: string; register: "above" | "none" | "below"; zone: number }
  | { kind: "fallback"; text: string };

/**
 * Maps a note to the teacher's handwritten notation (spec 8.3): letter name, a register
 * mark by string pair, and a fret-zone digit. Frets 13-24 fall outside the teacher's
 * system and fall back to the tab form `<string>S<fret>`.
 */
export function teacherGlyph(note: Note): TeacherGlyph {
  if (note.fret > 12) {
    return { kind: "fallback", text: `${note.string}S${note.fret}` };
  }

  const letter = letterOfNote(note);

  let register: "above" | "none" | "below";
  if (note.string === 1 || note.string === 2) register = "above";
  else if (note.string === 3 || note.string === 4) register = "none";
  else register = "below";

  let zone: number;
  if (note.fret === 0) zone = 0;
  else if (note.fret <= 4) zone = 1;
  else if (note.fret <= 8) zone = 2;
  else zone = 3; // 9-12

  return { kind: "teacher", letter, register, zone };
}

export interface TabGlyph {
  text: string;
  techniqueLabel?: string;
}

/**
 * Maps a note (and its predecessor, if any) to tab-lane glyph data (spec 8.2).
 * `text` is the fret number, decorated with the modifiers that attach to the note itself
 * (slide-in prefix, slide-out suffix, vibrato suffix, muted marker).
 * `techniqueLabel` is the connector label drawn between the previous note and this one,
 * derived from the connection flag (hammer/pull/slide/bend).
 */
export function tabGlyph(note: Note, prev: Note | undefined): TabGlyph {
  let text = String(note.fret);
  if (note.meta.slideIn) text = `~/${text}`;
  if (note.meta.vibrato) text = `${text}~`;
  if (note.meta.slideOut) text = `${text}\\~`;
  if (note.meta.muted) text = `${text}x`;

  const conn = note.meta.connection;
  if (!conn) return { text };

  let techniqueLabel: string;
  switch (conn.kind) {
    case "hammer":
      techniqueLabel = "h";
      break;
    case "pull":
      techniqueLabel = "p";
      break;
    case "slide": {
      const prevFret = prev?.fret ?? note.fret;
      techniqueLabel = note.fret > prevFret ? "/" : "\\";
      break;
    }
    case "bend":
      techniqueLabel = conn.semitones === 0 ? "r" : `b${conn.semitones}`;
      break;
  }
  return { text, techniqueLabel };
}
