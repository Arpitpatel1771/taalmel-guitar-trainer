// Canonical serializer for the song text format (spec 5.7).
// `serialize(song)` always produces the same text for equivalent songs, so exports
// and diffs are stable. Comments and blank lines from the original input are not
// preserved (there is nothing to preserve from a `Song`, which has no such fields).

import type { Note, NoteMeta, Song } from "../model/index.js";
import { WHOLE_NOTE_TICKS } from "../model/index.js";

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    [x, y] = [y, x % y];
  }
  return x === 0 ? 1 : x;
}

/** Serializes a note's `[...]` length block, or "" if every part is default. */
function serializeLengthBlock(note: Note, slotTicks: number): string {
  let countPart = "";
  if (note.durationTicks !== slotTicks) {
    if (note.durationTicks % slotTicks === 0) {
      countPart = String(note.durationTicks / slotTicks);
    } else {
      const g = gcd(note.durationTicks, WHOLE_NOTE_TICKS);
      const p = note.durationTicks / g;
      const q = WHOLE_NOTE_TICKS / g;
      countPart = `${p}X1/${q}`;
    }
  }

  // JS number-to-string already omits "+" for positive and includes "-" for negative.
  const offsetPart = note.offsetMs !== 0 ? `>${note.offsetMs}` : "";
  const uncertainPart = note.uncertain ? "?" : "";

  const inner = `${countPart}${offsetPart}${uncertainPart}`;
  return inner === "" ? "" : `[${inner}]`;
}

/** Serializes a note's `(...)` metadata block, keys in the spec 5.6 table order. */
function serializeMetaBlock(meta: NoteMeta): string {
  const entries: string[] = [];
  const conn = meta.connection;
  if (conn?.kind === "hammer") entries.push("hammer");
  if (conn?.kind === "pull") entries.push("pull");
  if (conn?.kind === "slide") entries.push("slide");
  if (conn?.kind === "bend") entries.push(`bend: ${conn.semitones}`);
  if (meta.slideIn) entries.push("slide_in");
  if (meta.slideOut) entries.push("slide_out");
  if (meta.vibrato) entries.push("vibrato");
  if (meta.muted) entries.push("muted");
  if (meta.strum) entries.push(`strum: ${meta.strum}`);
  if (meta.flat) entries.push("flat");
  return entries.length === 0 ? "" : `(${entries.join(", ")})`;
}

function serializeNote(note: Note, slotTicks: number): string {
  return `${note.string}S${note.fret}${serializeLengthBlock(note, slotTicks)}${serializeMetaBlock(note.meta)}`;
}

export function serialize(song: Song): string {
  const lines: string[] = [];

  lines.push(`title: ${song.header.title}`);
  lines.push(`time: ${song.header.time.numerator}/${song.header.time.denominator}`);
  lines.push(`bpm: ${song.header.bpm}`);
  lines.push(`unit: ${song.header.unit}`);
  if (song.header.youtube) {
    lines.push(`youtube: ${song.header.youtube.url}`);
    lines.push(`offset: ${song.header.youtube.offsetSec}`);
  }
  lines.push("");

  const sectionBlocks: string[] = [];
  for (const section of song.sections) {
    const sectionLines: string[] = [];
    sectionLines.push(`[${section.name}]`);
    if (section.bpm !== song.header.bpm) sectionLines.push(`bpm: ${section.bpm}`);
    if (section.unit !== song.header.unit) sectionLines.push(`unit: ${section.unit}`);

    for (const bar of section.bars) {
      const slotTicks = bar.lengthTicks / bar.slots;
      const parts: string[] = [];
      if (bar.slots !== section.unit) parts.push(`(${bar.slots})`);

      let i = 0;
      while (i < bar.notes.length) {
        const startTick = bar.notes[i]!.startTick;
        const slot = (startTick - bar.startTick) / slotTicks + 1;
        const groupNotes: Note[] = [];
        while (i < bar.notes.length && bar.notes[i]!.startTick === startTick) {
          groupNotes.push(bar.notes[i]!);
          i++;
        }
        groupNotes.sort((a, b) => a.string - b.string);
        const noteTexts = groupNotes.map((n) => serializeNote(n, slotTicks)).join(" ");
        parts.push(`{${slot}} ${noteTexts}`);
      }

      const rest = parts.length > 0 ? ` ${parts.join(" ")}` : "";
      sectionLines.push(`Bar ${bar.number}:${rest}`);
    }

    sectionBlocks.push(sectionLines.join("\n"));
  }

  lines.push(sectionBlocks.join("\n\n"));

  return `${lines.join("\n")}\n`;
}
