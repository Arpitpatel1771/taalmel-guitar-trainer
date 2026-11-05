// The editable document: creation from a Song, and small lookups shared by every module.

import type { Song, TimeSignature } from "../model/index.js";
import { barTicks } from "../importTab/rhythm.js";
import { parseYouTubeId } from "../songFormat/youtube.js";
import type { EdBar, EdDoc, EdNote, EdSection } from "./types.js";

export const DEFAULT_BPM = 100;
export const DEFAULT_TIME: TimeSignature = { numerator: 4, denominator: 4 };

export function compareNotes(a: EdNote, b: EdNote): number {
  return a.startTick - b.startTick || a.string - b.string || a.id - b.id;
}

export function makeBars(count: number, lengthTicks: number): EdBar[] {
  return Array.from({ length: count }, (_, i) => ({ startTick: i * lengthTicks, lengthTicks }));
}

/** Empty song: 4 bars of 4/4 at 100 BPM, unit 16. */
export function emptyDoc(opts: { title: string; artist?: string; youtubeUrl?: string; bpm?: number }): EdDoc {
  const len = barTicks(DEFAULT_TIME);
  const header: EdDoc["header"] = { title: opts.title, time: DEFAULT_TIME, bpm: opts.bpm !== undefined && Number.isFinite(opts.bpm) ? Math.round(opts.bpm) : DEFAULT_BPM, unit: 16 };
  if (opts.artist?.trim()) header.artist = opts.artist.trim();
  const url = opts.youtubeUrl?.trim();
  const videoId = url ? parseYouTubeId(url) : null;
  if (url && videoId) header.youtube = { url, videoId, offsetSec: 0 };
  return { header, sections: [{ name: "Song", startBar: 0 }], bars: makeBars(4, len), notes: [], nextId: 1 };
}

/** Editable copy of a parsed song. Section overrides that equal the song value are dropped. */
export function docFromSong(song: Song): EdDoc {
  const sections: EdSection[] = [];
  const bars: EdBar[] = [];
  const h = song.header;
  for (const s of song.sections) {
    const sec: EdSection = { name: s.name, startBar: bars.length };
    if (s.bpm !== h.bpm) sec.bpm = s.bpm;
    if (s.unit !== h.unit) sec.unit = s.unit;
    if (s.capo !== (h.capo ?? 0)) sec.capo = s.capo;
    sections.push(sec);
    for (const b of s.bars) bars.push({ startTick: b.startTick, lengthTicks: b.lengthTicks });
  }
  let id = 1;
  const notes: EdNote[] = song.notes.map((n) => ({
    id: id++,
    string: n.string,
    fret: n.fret,
    startTick: n.startTick,
    durationTicks: n.durationTicks,
    offsetMs: n.offsetMs,
    meta: structuredClone(n.meta),
  }));
  notes.sort(compareNotes);
  return { header: structuredClone(h), sections, bars, notes, nextId: id };
}

export function barLengthTicks(doc: EdDoc): number {
  return barTicks(doc.header.time);
}

export function totalTicks(doc: EdDoc): number {
  return doc.bars.length * barLengthTicks(doc);
}

/** 0-based bar index holding `tick` (not limited to the existing bars). */
export function barIndexOf(doc: EdDoc, tick: number): number {
  return Math.max(0, Math.floor(tick / barLengthTicks(doc)));
}

/** Index into `doc.sections` of the section a bar belongs to (bars past the end belong to the last one). */
export function sectionIndexOfBar(doc: EdDoc, barIndex: number): number {
  let idx = 0;
  doc.sections.forEach((s, i) => {
    if (s.startBar <= barIndex) idx = i;
  });
  return idx;
}

export function capoOfBar(doc: EdDoc, barIndex: number): number {
  return doc.sections[sectionIndexOfBar(doc, barIndex)]?.capo ?? doc.header.capo ?? 0;
}

export function capoAtTick(doc: EdDoc, tick: number): number {
  return capoOfBar(doc, barIndexOf(doc, tick));
}

export function bpmOfBar(doc: EdDoc, barIndex: number): number {
  return doc.sections[sectionIndexOfBar(doc, barIndex)]?.bpm ?? doc.header.bpm;
}

export function unitOfBar(doc: EdDoc, barIndex: number): number {
  return doc.sections[sectionIndexOfBar(doc, barIndex)]?.unit ?? doc.header.unit;
}

/** The doc with at least `count` bars (new bars extend the last section). */
export function withBars(doc: EdDoc, count: number): EdDoc {
  if (doc.bars.length >= count) return doc;
  const len = barLengthTicks(doc);
  const bars = [...doc.bars];
  for (let i = bars.length; i < count; i++) bars.push({ startTick: i * len, lengthTicks: len });
  return { ...doc, bars };
}

export function noteById(doc: EdDoc, id: number): EdNote | undefined {
  return doc.notes.find((n) => n.id === id);
}

export function notesInBar(doc: EdDoc, barIndex: number): EdNote[] {
  const len = barLengthTicks(doc);
  return doc.notes.filter((n) => Math.floor(n.startTick / len) === barIndex);
}
