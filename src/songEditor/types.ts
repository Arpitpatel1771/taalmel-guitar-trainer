// Types of the piano-roll editor document (specs/5-11-piano-roll.md). Pure data, no DOM.

import type { NoteMeta, SongHeader, StringNumber } from "../model/index.js";

export interface EdNote {
  /** Stable for the life of the document; the UI keys selection on it. */
  id: number;
  string: StringNumber;
  /** Relative to the capo of the bar the note starts in, 0..24-capo. */
  fret: number;
  /** Absolute from song start. */
  startTick: number;
  durationTicks: number;
  offsetMs: number;
  meta: NoteMeta;
}

export interface EdSection {
  name: string;
  /** 0-based index of the first bar. The first section always starts at 0. */
  startBar: number;
  /** Overrides; absent = use the song value. */
  bpm?: number;
  unit?: number;
  capo?: number;
}

export interface EdBar {
  startTick: number;
  lengthTicks: number;
}

export interface EdDoc {
  header: SongHeader;
  sections: EdSection[];
  bars: EdBar[];
  /** Sorted by startTick, then string. */
  notes: EdNote[];
  nextId: number;
}

/**
 * Result of an edit. `doc` is always usable: when `refused` is set it is the
 * unchanged input and `message` says why (show it as a tooltip or toast).
 * Without `refused`, `message` is an optional note ("Shortened to fit the bar").
 * `ids` are the notes the edit created or changed (select them afterwards).
 */
export interface OpResult {
  doc: EdDoc;
  refused?: boolean;
  message?: string;
  ids?: number[];
}

export interface Problem {
  /** The note to select for a "Show" button, when the problem belongs to one. */
  noteId?: number;
  code: string;
  message: string;
}

export type IntoKind =
  | { kind: "none" }
  | { kind: "hammer" }
  | { kind: "pull" }
  | { kind: "slide" }
  | { kind: "bend"; semitones: number };

export type ModifierKey = "vibrato" | "muted" | "slideIn" | "slideOut" | "flat";

/** Copied notes, positions relative to the earliest start. */
export interface Clip {
  notes: {
    dTick: number;
    string: StringNumber;
    midi: number;
    durationTicks: number;
    offsetMs: number;
    meta: NoteMeta;
  }[];
}
