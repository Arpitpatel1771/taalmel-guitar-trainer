import { SLASH_CHORDS } from "./shapes.js";
import { normalizeSlashName, parseChordText } from "./theory.js";
import type { ParsedChord } from "./types.js";

export { checkVoicing } from "./check.js";
export type { CheckOptions } from "./check.js";
export { listVoicings, openChordList, slashChordsFor, SLASH_CHORDS } from "./shapes.js";
export { CHORD_TYPES, ROOTS, chordDisplayName, chordKey, chordNotes, chordType } from "./theory.js";
export type {
  CheckResult,
  ChordGroup,
  ChordType,
  ChordTypeId,
  Fret,
  ParsedChord,
  RootInfo,
  SlashChord,
  Spelling,
  StringInfo,
  Voicing,
} from "./types.js";

/**
 * Parses "C", "C#m7", "Dbmaj7", "Bb5" (also with the sharp and flat symbols),
 * or a known slash chord such as "D/F#". Returns null for anything else.
 */
export function parseChordName(text: string): ParsedChord | { slash: string } | null {
  if (text.includes("/")) {
    const name = normalizeSlashName(text);
    return SLASH_CHORDS.some((s) => s.name === name) ? { slash: name } : null;
  }
  return parseChordText(text);
}
