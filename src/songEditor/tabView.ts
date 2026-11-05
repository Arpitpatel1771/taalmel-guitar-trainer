// Read-only plain tab of the song (spec 3.7).

import { barLengthTicks, capoOfBar } from "./doc.js";
import { previousOnString } from "./techniques.js";
import type { EdDoc, EdNote } from "./types.js";

export interface TabCell {
  noteId: number;
  /** Row of the fret number in `lines`. */
  row: number;
  /** First character of the fret number, and its width. */
  col: number;
  length: number;
}

export interface TabView {
  lines: string[];
  text: string;
  cells: TabCell[];
}

export interface TabViewOptions {
  /** 0-based, inclusive. Default: the whole song. */
  fromBar?: number;
  toBar?: number;
  barsPerLine?: number;
}

const LABELS = ["e", "B", "G", "D", "A", "E"];

/**
 * Token for one note. Reached by: `h` hammer, `p` pull, `/` or `\` slide up or down, `b` bend
 * (`r` = release). Slide in is a `/` prefix, slide out a `\` suffix; `~` vibrato, `x` muted.
 */
function token(doc: EdDoc, n: EdNote): { text: string; at: number } {
  let pre = "";
  let post = "";
  const c = n.meta.connection;
  if (c?.kind === "hammer") pre = "h";
  else if (c?.kind === "pull") pre = "p";
  else if (c?.kind === "slide") pre = n.fret > (previousOnString(doc, n)?.fret ?? n.fret) ? "/" : "\\";
  else if (c?.kind === "bend") post = c.semitones === 0 ? "r" : "b";
  if (n.meta.slideIn) pre = "/";
  if (n.meta.slideOut) post += "\\";
  if (n.meta.vibrato) post += "~";
  if (n.meta.muted) post += "x";
  return { text: `${pre}${n.fret}${post}`, at: pre.length };
}

/** Six-line tab for a bar range. Notes starting together share one column. */
export function tabView(doc: EdDoc, opts: TabViewOptions = {}): TabView {
  const len = barLengthTicks(doc);
  const from = Math.max(0, opts.fromBar ?? 0);
  const to = Math.min(doc.bars.length - 1, opts.toBar ?? doc.bars.length - 1);
  const perLine = Math.max(1, opts.barsPerLine ?? 4);
  const lines: string[] = [];
  const cells: TabCell[] = [];
  let prevCapo = 0;

  for (let sysFrom = from; sysFrom <= to; sysFrom += perLine) {
    const sysTo = Math.min(to, sysFrom + perLine - 1);
    if (lines.length > 0) lines.push("");
    const capo = capoOfBar(doc, sysFrom);
    if (capo !== prevCapo || (sysFrom === from && capo > 0)) lines.push(capo > 0 ? `Capo ${capo}` : "No capo");
    prevCapo = capo;
    const top = lines.length;
    const rows = LABELS.map((l) => `${l}|`);
    for (let b = sysFrom; b <= sysTo; b++) {
      const start = b * len;
      const notes = doc.notes.filter((n) => n.startTick >= start && n.startTick < start + len);
      const ticks = [...new Set(notes.map((n) => n.startTick))].sort((a, c) => a - c);
      rows.forEach((_, r) => (rows[r] += "-"));
      ticks.forEach((t, i) => {
        const group = notes.filter((n) => n.startTick === t);
        const toks = new Map(group.map((n) => [n, token(doc, n)] as const));
        const width = Math.max(...[...toks.values()].map((k) => k.text.length));
        const gap = Math.max(1, Math.min(4, Math.round(((ticks[i + 1] ?? start + len) - t) / 240)));
        for (let r = 0; r < 6; r++) {
          const n = group.find((x) => x.string === r + 1);
          if (n) {
            const k = toks.get(n)!;
            cells.push({ noteId: n.id, row: top + r, col: rows[r]!.length + k.at, length: String(n.fret).length });
            rows[r] += k.text + "-".repeat(width - k.text.length);
          } else rows[r] += "-".repeat(width);
          rows[r] += "-".repeat(gap);
        }
      });
      if (ticks.length === 0) rows.forEach((_, r) => (rows[r] += "---"));
      rows.forEach((_, r) => (rows[r] += "|"));
    }
    lines.push(...rows);
  }
  return { lines, text: lines.join("\n"), cells };
}
