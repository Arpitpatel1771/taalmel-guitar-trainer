// Builds canonical Taalmel song text from header info plus timed events.
// Constructs a `Song` model, serializes it, then re-parses the text to prove it is valid.

import type { Bar, Note, ParseError, Section, Song, SongHeader, StringNumber, TimeSignature } from "../model/index.js";
import { parse } from "../songFormat/parse.js";
import { serialize } from "../songFormat/serialize.js";
import { parseYouTubeId } from "../songFormat/youtube.js";
import { barTicks, slotsDivideBar } from "./rhythm.js";
import type { TimedBar } from "./types.js";

export interface SongInfo {
  title: string;
  /** Written as the song format's `artist` header field. */
  artist?: string;
  time: TimeSignature;
  bpm: number;
  unit: number;
  capo?: number;
  youtube?: string;
  /** Video timestamp of bar 1, slot 1. Only written when `youtube` is set. Default 0. */
  offsetSec?: number;
}

export interface SectionStart {
  name: string;
  /** 0-based index into the bars array where the section begins. */
  startBar: number;
}

export type BuildResult =
  | { ok: true; text: string; song: Song; warnings: ParseError[] }
  | { ok: false; errors: ParseError[] };

function fail(message: string, code = "IMPORT_BUILD"): BuildResult {
  return { ok: false, errors: [{ line: 0, code, message }] };
}

/** Section starts from tab heading suggestions (barIndex) so the first section always begins at bar 0. */
export function sectionsFromSuggestions(
  suggestions: { name: string; barIndex: number }[],
  defaultName = "Song",
): SectionStart[] {
  const sorted = [...suggestions].sort((a, b) => a.barIndex - b.barIndex);
  const out: SectionStart[] = sorted.map((s) => ({ name: s.name, startBar: s.barIndex }));
  if (out.length === 0 || out[0]!.startBar > 0) out.unshift({ name: defaultName, startBar: 0 });
  return out;
}

export function buildSongText(info: SongInfo, bars: TimedBar[], sections?: SectionStart[]): BuildResult {
  if (!info.title.trim()) return fail("Title is required", "MISSING_TITLE");
  if (!slotsDivideBar(info.time, info.unit)) return fail(`unit ${info.unit} does not divide the bar`, "INVALID_UNIT");

  const ticksPerBar = barTicks(info.time);
  const header: SongHeader = { title: info.title.trim(), time: info.time, bpm: info.bpm, unit: info.unit };
  if (info.artist?.trim()) header.artist = info.artist.trim();
  if (info.capo !== undefined && info.capo > 0) header.capo = info.capo;
  if (info.youtube) {
    const videoId = parseYouTubeId(info.youtube);
    if (!videoId) return fail(`Not a YouTube link: ${info.youtube}`, "INVALID_YOUTUBE");
    header.youtube = { url: info.youtube.trim(), videoId, offsetSec: info.offsetSec ?? 0 };
  }
  const capo = header.capo ?? 0;

  const starts = sections && sections.length > 0 ? [...sections].sort((a, b) => a.startBar - b.startBar) : [{ name: "Song", startBar: 0 }];
  if (starts[0]!.startBar !== 0) starts.unshift({ name: "Song", startBar: 0 });

  const flat: Note[] = [];
  const modelSections: Section[] = [];
  for (let si = 0; si < starts.length; si++) {
    const from = starts[si]!.startBar;
    const to = si + 1 < starts.length ? starts[si + 1]!.startBar : bars.length;
    const sectionBars: Bar[] = [];
    for (let bi = from; bi < to && bi < bars.length; bi++) {
      const tb = bars[bi]!;
      if (!slotsDivideBar(info.time, tb.slots)) return fail(`Bar ${bi + 1}: ${tb.slots} slots do not divide the bar`, "INVALID_SLOTS");
      const slotTicks = ticksPerBar / tb.slots;
      const startTick = bi * ticksPerBar;
      const notes: Note[] = [];
      for (const ev of tb.events) {
        if (ev.slot < 1 || ev.slot > tb.slots) return fail(`Bar ${bi + 1}: slot ${ev.slot} is outside 1-${tb.slots}`, "INVALID_SLOT");
        for (const n of ev.notes) {
          notes.push({
            string: n.string as StringNumber,
            fret: n.fret,
            startTick: startTick + (ev.slot - 1) * slotTicks,
            durationTicks: (ev.lengthSlots ?? 1) * slotTicks,
            offsetMs: 0,
            meta: { ...(n.technique ?? {}) },
            source: { line: 0, column: 0 },
          });
        }
      }
      notes.sort((a, b) => a.startTick - b.startTick || a.string - b.string);
      flat.push(...notes);
      sectionBars.push({ number: bi + 1, startTick, lengthTicks: ticksPerBar, slots: tb.slots, capo, notes });
    }
    if (sectionBars.length === 0) continue;
    modelSections.push({ name: starts[si]!.name, bpm: info.bpm, unit: info.unit, capo, bars: sectionBars });
  }
  if (modelSections.length === 0) return fail("There are no bars to write", "NO_BARS");

  const model: Song = { header, sections: modelSections, notes: flat, totalTicks: bars.length * ticksPerBar };
  const text = serialize(model);
  const parsed = parse(text);
  if (!parsed.ok) return { ok: false, errors: parsed.errors };
  return { ok: true, text, song: parsed.song, warnings: parsed.warnings };
}
