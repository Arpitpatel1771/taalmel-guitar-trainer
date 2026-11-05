// Shared types for the song-import core (spec 5-11-song-import.md). Pure data, no DOM.

import type { NoteMeta, StringNumber, TimeSignature } from "../model/index.js";

/** Technique flags on one tab note, expressed as the song format's metadata. */
export type TabTechnique = Pick<NoteMeta, "connection" | "vibrato" | "muted" | "slideIn" | "slideOut">;

export interface TabNote {
  string: StringNumber;
  fret: number;
  technique?: TabTechnique;
}

/** Notes sounding together (a chord, or a single note). */
export interface NoteEvent {
  /** Character column inside its block, counted from the first character after the label. */
  column: number;
  /** Global 0-based index into `ReadTabResult.bars`. Absent for events that came from fretboard entry. */
  bar?: number;
  /** 0-based index of the 6-line block the event came from (tab reader only). */
  block?: number;
  /** 1-based line of the block's top string line (tab reader only). */
  blockLine?: number;
  notes: TabNote[];
}

/** A bar as drawn in the tab: the column span between two bar lines (or a whole block without bar lines). */
export interface TabBar {
  index: number;
  block: number;
  /** First content column of the bar. */
  startColumn: number;
  /** One past the last content column of the bar. */
  endColumn: number;
  /** True when the bar is delimited by `|` characters in the text. */
  explicit: boolean;
}

export interface SectionSuggestion {
  name: string;
  /** Index of the first tab bar after the heading. */
  barIndex: number;
  line: number;
}

export interface TabIssue {
  line?: number;
  /** 1-based column within the line. */
  column?: number;
  code: string;
  message: string;
}
export type Warning = TabIssue;
export type TabError = TabIssue;

export interface ReadTabResult {
  events: NoteEvent[];
  bars: TabBar[];
  capo?: number;
  sectionNames: SectionSuggestion[];
  warnings: Warning[];
  errors: TabError[];
}

/** A note event placed on a bar's slot grid. */
export interface TimedEvent {
  /** 1-based slot. */
  slot: number;
  /** Length in slots of the bar's grid (default 1). */
  lengthSlots?: number;
  notes: TabNote[];
}

export interface TimedBar {
  /** Slot count of this bar's grid. */
  slots: number;
  events: TimedEvent[];
}

export interface RhythmOptions {
  time: TimeSignature;
  unit: number;
}
