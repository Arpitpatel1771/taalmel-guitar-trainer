// Saving (spec 8): the document becomes a Song (and song text that parses back).

import type { Bar, Note, ParseError, Section, Song } from "../model/index.js";
import { soundingMidi } from "../notation/index.js";
import { parse } from "../songFormat/parse.js";
import { serialize } from "../songFormat/serialize.js";
import { barLengthTicks, bpmOfBar, capoAtTick, capoOfBar, compareNotes, unitOfBar } from "./doc.js";
import { isBlackKey, maxFret } from "./pitch.js";
import { findConflicts } from "./strings.js";
import { intoProblem, previousOnString } from "./techniques.js";
import type { EdDoc, EdNote, Problem } from "./types.js";

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y) [x, y] = [y, x % y];
  return x;
}

/**
 * Slot count for one bar: the section unit when every start sits on it, else the coarsest grid
 * that holds every start and length. An empty bar uses the unit.
 */
export function slotsForBar(barTicks: number, unit: number, notes: readonly EdNote[], barStart: number): number {
  const unitOk = Number.isInteger(unit) && unit >= 1 && barTicks % unit === 0;
  if (notes.length === 0) return unitOk ? unit : 1;
  let starts = barTicks;
  for (const n of notes) starts = gcd(starts, n.startTick - barStart);
  // The unit stays when every start sits on it; lengths that miss it are written as kXa/b.
  if (unitOk && starts % (barTicks / unit) === 0) return unit;
  let g = starts;
  for (const n of notes) g = gcd(g, n.durationTicks);
  return barTicks / g;
}

/** Sorts the notes and drops trailing empty bars (the section start bars stay; bars a note rings into stay too). */
export function normalizeDoc(doc: EdDoc): EdDoc {
  const len = barLengthTicks(doc);
  const notes = [...doc.notes].sort(compareNotes);
  let last = doc.bars.length - 1;
  const lastSectionStart = doc.sections.length ? doc.sections[doc.sections.length - 1]!.startBar : 0;
  const lastNoteBar = notes.reduce((m, n) => Math.max(m, Math.floor((n.startTick + n.durationTicks - 1) / len)), 0);
  last = Math.max(0, Math.min(last, Math.max(lastNoteBar, lastSectionStart)));
  const count = last + 1;
  return { ...doc, notes, bars: doc.bars.slice(0, count), sections: doc.sections.filter((s) => s.startBar < count) };
}

function toNote(n: EdNote): Note {
  return {
    string: n.string,
    fret: n.fret,
    startTick: n.startTick,
    durationTicks: n.durationTicks,
    offsetMs: n.offsetMs,
    meta: structuredClone(n.meta),
    source: { line: 0, column: 0 },
  };
}

/** The document as a Song, normalized as for saving. No validation: use `saveDoc` for that. */
export function docToSong(input: EdDoc): Song {
  const doc = normalizeDoc(input);
  const len = barLengthTicks(doc);
  const notes = doc.notes.map(toNote);
  const sections: Section[] = [];
  doc.sections.forEach((s, si) => {
    const to = si + 1 < doc.sections.length ? doc.sections[si + 1]!.startBar : doc.bars.length;
    const unit = unitOfBar(doc, s.startBar);
    const bars: Bar[] = [];
    for (let bi = s.startBar; bi < to; bi++) {
      const start = bi * len;
      const inBar: EdNote[] = doc.notes.filter((n) => n.startTick >= start && n.startTick < start + len);
      bars.push({
        number: bi + 1,
        startTick: start,
        lengthTicks: len,
        slots: slotsForBar(len, unit, inBar, start),
        capo: capoOfBar(doc, bi),
        notes: inBar.map((n) => notes[doc.notes.indexOf(n)]!),
      });
    }
    sections.push({ name: s.name, bpm: bpmOfBar(doc, s.startBar), unit, capo: capoOfBar(doc, s.startBar), bars });
  });
  return { header: structuredClone(doc.header), sections, notes, totalTicks: doc.bars.length * len };
}

/** Canonical song text for the document (no validation). */
export function serializeDoc(doc: EdDoc): string {
  return serialize(docToSong(doc));
}

/** Everything that would stop a save, with the note to show when there is one. */
export function validateDoc(input: EdDoc): Problem[] {
  const doc = normalizeDoc(input);
  const out: Problem[] = [];
  if (!doc.header.title.trim()) out.push({ code: "MISSING_TITLE", message: "The song needs a title." });
  for (const id of findConflicts(doc)) {
    const n = doc.notes.find((x) => x.id === id)!;
    const bad = n.fret < 0 || n.fret > maxFret(capoAtTick(doc, n.startTick));
    out.push({ noteId: id, code: bad ? "FRET_OUT_OF_RANGE" : "NO_FREE_STRING", message: bad ? "This fret can't be played here." : "No free string for this note" });
  }
  for (const n of doc.notes) {
    const conn = n.meta.connection;
    if (conn) {
      const r = intoProblem(previousOnString(doc, n), n, conn.kind === "bend" ? { kind: "bend", semitones: conn.semitones } : { kind: conn.kind });
      if (r) out.push({ noteId: n.id, code: "BAD_TECHNIQUE", message: r });
      if (n.meta.slideIn) out.push({ noteId: n.id, code: "BAD_TECHNIQUE", message: "Slide in can't be combined with another technique." });
    }
    if (n.meta.flat && !isBlackKey(soundingMidi(n.string, n.fret, capoAtTick(doc, n.startTick)))) {
      out.push({ noteId: n.id, code: "FLAT_ON_NATURAL", message: "Only black-key notes can be spelled as a flat." });
    }
    if (n.offsetMs < -500 || n.offsetMs > 500) out.push({ noteId: n.id, code: "BAD_OFFSET", message: "Fine timing must be within 500 ms." });
  }
  return out;
}

export type SaveResult =
  | { ok: true; text: string; song: Song; warnings: ParseError[] }
  | { ok: false; problems: Problem[] };

/** Validates, serializes, and re-parses (the round-trip rule). The returned song is the parsed one. */
export function saveDoc(doc: EdDoc): SaveResult {
  const problems = validateDoc(doc);
  if (problems.length > 0) return { ok: false, problems };
  const text = serializeDoc(doc);
  const parsed = parse(text);
  if (!parsed.ok) return { ok: false, problems: parsed.errors.map((e) => ({ code: e.code, message: e.message })) };
  return { ok: true, text, song: parsed.song, warnings: parsed.warnings };
}
