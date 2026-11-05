// Building a document from a pasted tab (spec 7): tab reader + spacing guess.

import { buildSongText, sectionsFromSuggestions } from "../importTab/buildSong.js";
import { guessRhythm } from "../importTab/rhythm.js";
import { parseTempo } from "../importTab/parseTempo.js";
import { readTab } from "../importTab/readTab.js";
import { DEFAULT_BPM, DEFAULT_TIME, docFromSong } from "./doc.js";
import type { EdDoc } from "./types.js";

export interface TabSummary {
  noteCount: number;
  barCount: number;
  capo?: number;
  warnings: string[];
  errors: string[];
}

/** Live summary for the paste box ("38 notes in 12 bars, capo 2"). */
export function summarizeTab(tabText: string): TabSummary {
  const read = readTab(tabText);
  const s: TabSummary = {
    noteCount: read.events.reduce((sum, e) => sum + e.notes.length, 0),
    barCount: read.bars.length,
    warnings: read.warnings.map((w) => w.message),
    errors: read.errors.map((e) => e.message),
  };
  if (read.capo !== undefined) s.capo = read.capo;
  return s;
}

/** First line of the tab text that is not tab notation, as a title suggestion ("" when none). */
export function guessTabTitle(tabText: string): string {
  for (const raw of tabText.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    if (/[|]/.test(line) || /^[eBGDAEa-g]\s*[|:]/.test(line) || /-{3,}/.test(line)) return "";
    if (line.length > 80) return "";
    // Capo, tuning and tempo lines sit above the title in some tabs; they're never the title.
    if (/^(capo|tuning)\b/i.test(line) || parseTempo(line) !== null) continue;
    return line.replace(/^(title|song)\s*[:-]\s*/i, "").replace(/^\[.*\]$/, "").trim();
  }
  return "";
}

export type TabDocResult =
  | { ok: true; doc: EdDoc; summary: TabSummary }
  | { ok: false; message: string; summary: TabSummary };

export function docFromTab(tabText: string, opts: { title?: string; artist?: string; youtubeUrl?: string; bpm?: number } = {}): TabDocResult {
  const summary = summarizeTab(tabText);
  const read = readTab(tabText);
  if (read.errors.length > 0) return { ok: false, message: summary.errors.join(" "), summary };
  const unit = 8;
  let bars;
  try {
    bars = guessRhythm(read.events, read.bars, { time: DEFAULT_TIME, unit });
  } catch (err) {
    return { ok: false, message: err instanceof Error ? err.message : String(err), summary };
  }
  const built = buildSongText(
    {
      title: opts.title?.trim() || "Untitled",
      artist: opts.artist,
      time: DEFAULT_TIME,
      bpm: opts.bpm !== undefined && Number.isFinite(opts.bpm) ? Math.round(opts.bpm) : DEFAULT_BPM,
      unit,
      capo: read.capo,
      youtube: opts.youtubeUrl?.trim() || undefined,
    },
    bars,
    sectionsFromSuggestions(read.sectionNames),
  );
  if (!built.ok) return { ok: false, message: built.errors.map((e) => e.message).join(" "), summary };
  return { ok: true, doc: docFromSong(built.song), summary };
}
