// Canvas drawing of the piano roll: grid, rows, pitch hints, notes, technique links, ruler and
// keyboard column. Only the visible range is drawn. Colours come from the design tokens.

import { WHOLE_NOTE_TICKS } from "../../model";
import {
  ROLL_MAX_MIDI,
  ROLL_MIN_MIDI,
  barLengthTicks,
  bpmOfBar,
  capoOfBar,
  isBlackKey,
  noteName,
  previousOnString,
  type EdDoc,
  type EdNote,
} from "../../songEditor";
import { HINT_BINS, HINT_MIDI_MIN, framesInRange, onsetsInRange, strongestPitch, uncoveredRanges, type VideoHints, type VideoSongMapper } from "../../audio/hints";
import { KEY_W, LANE_H, RULER_H, laneTop, noteRect, rowTop, type Geom, type Rect } from "./rollGeometry";

export interface RollTheme {
  dark: boolean;
  bg: string;
  surface2: string;
  line: string;
  barline: string;
  text: string;
  muted: string;
  subtle: string;
  accent: string;
  onAccent: string;
  accentText: string;
  accentTint: string;
  record: string;
  warn: string;
  ok: string;
}

export function readRollTheme(): RollTheme {
  const el = document.documentElement;
  const cs = getComputedStyle(el);
  const v = (name: string, fallback: string): string => cs.getPropertyValue(name).trim() || fallback;
  return {
    dark: el.getAttribute("data-theme") !== "light",
    bg: v("--surface-1", "#1e1b16"),
    surface2: v("--surface-2", "#27231c"),
    line: v("--line", "#3a352c"),
    barline: v("--barline", "#4a443a"),
    text: v("--text", "#f2ede4"),
    muted: v("--text-muted", "#b8b0a3"),
    subtle: v("--text-subtle", "#8c8477"),
    accent: v("--accent", "#f2a93b"),
    onAccent: v("--on-accent", "#1a1408"),
    accentText: v("--accent-text", "#f2a93b"),
    accentTint: v("--accent-tint", "#2e2717"),
    record: v("--record", "#f06a4a"),
    warn: v("--warn", "#e8b04a"),
    ok: v("--ok", "#7fc8a9"),
  };
}

export interface HintsLayer {
  hints: VideoHints;
  mapper: VideoSongMapper;
  /** 0..1 */
  brightness: number;
}

export interface DrawState {
  doc: EdDoc;
  g: Geom;
  theme: RollTheme;
  width: number;
  height: number;
  scrollX: number;
  scrollY: number;
  selected: ReadonlySet<number>;
  conflicts: ReadonlySet<number>;
  playheadTick: number;
  loop: { startTick: number; endTick: number } | null;
  hintsLayer: HintsLayer | null;
  /** Video flag: video time of bar 1, seconds. Absent = no video. */
  flagSec?: number;
  snapTicks: number;
  box: Rect | null;
  ghost: Rect | null;
  hoverId: number | null;
}

export const STRING_LETTERS = ["e", "B", "G", "D", "A", "E"] as const;
const MONO = '"JetBrains Mono", "SF Mono", Menlo, Consolas, monospace';
const UI = 'Inter, -apple-system, "Segoe UI", sans-serif';

export function flagText(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  return `◆ Bar 1 = ${m}:${(s - m * 60).toFixed(2).padStart(5, "0")} in the video`;
}
/** Width the flag label takes in the ruler (for hit testing). */
export const FLAG_HIT_W = 200;
export const FLAG_Y0 = 33;
export const FLAG_Y1 = 47;

const strongCache = new WeakMap<Uint8Array, number | null>();
function strongest(frame: Uint8Array): number | null {
  let v = strongCache.get(frame);
  if (v === undefined) {
    v = strongestPitch(frame);
    strongCache.set(frame, v);
  }
  return v;
}

let hatchCache: { color: string; pattern: CanvasPattern } | null = null;
function hatch(ctx: CanvasRenderingContext2D, color: string): CanvasPattern | null {
  if (hatchCache?.color === color) return hatchCache.pattern;
  const c = document.createElement("canvas");
  c.width = c.height = 12;
  const p = c.getContext("2d");
  if (!p) return null;
  p.strokeStyle = color;
  p.lineWidth = 1.5;
  p.beginPath();
  p.moveTo(-2, 14);
  p.lineTo(14, -2);
  p.moveTo(-2, 8);
  p.lineTo(8, -2);
  p.moveTo(4, 14);
  p.lineTo(14, 4);
  p.stroke();
  const pattern = ctx.createPattern(c, "repeat");
  if (pattern) hatchCache = { color, pattern };
  return pattern;
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, Math.min(r, w / 2, h / 2));
}

export function drawRoll(ctx: CanvasRenderingContext2D, s: DrawState): void {
  const { doc, g, theme: t, width: W, height: H, scrollX, scrollY } = s;
  const barLen = barLengthTicks(doc);
  const gridW = W - KEY_W;
  const gridH = H - RULER_H;
  const gx = (tick: number): number => KEY_W + tick * g.pxPerTick - scrollX;
  const gy = (y: number): number => RULER_H + y - scrollY;
  const t0 = scrollX / g.pxPerTick;
  const t1 = (scrollX + gridW) / g.pxPerTick;
  const pitch = g.view === "pitch";

  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, W, H);

  // ---- grid area
  ctx.save();
  ctx.beginPath();
  ctx.rect(KEY_W, RULER_H, gridW, gridH);
  ctx.clip();

  // Rows.
  const ink = t.dark ? 0.05 : 0.06;
  ctx.fillStyle = t.text;
  if (pitch) {
    const m0 = Math.max(ROLL_MIN_MIDI, ROLL_MAX_MIDI - Math.ceil((scrollY + gridH) / g.rowH));
    const m1 = Math.min(ROLL_MAX_MIDI, ROLL_MAX_MIDI - Math.floor(scrollY / g.rowH));
    for (let m = m0; m <= m1; m++) {
      const y = gy(rowTop(g, m));
      if (isBlackKey(m)) {
        ctx.globalAlpha = t.dark ? 0.1 : 0.06;
        ctx.fillRect(KEY_W, y, gridW, g.rowH);
        ctx.globalAlpha = 1;
      }
    }
    ctx.strokeStyle = t.line;
    ctx.lineWidth = 1;
    for (let m = m0; m <= m1; m++) {
      if (m % 12 !== 0) continue;
      const y = Math.round(gy(rowTop(g, m) + g.rowH)) - 0.5;
      ctx.beginPath();
      ctx.moveTo(KEY_W, y);
      ctx.lineTo(W, y);
      ctx.stroke();
    }
  } else {
    for (let st = 1; st <= 6; st++) {
      const y = gy(laneTop(st));
      if (st % 2 === 0) {
        ctx.globalAlpha = t.dark ? 0.1 : 0.06;
        ctx.fillRect(KEY_W, y, gridW, LANE_H);
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = t.line;
      ctx.beginPath();
      ctx.moveTo(KEY_W, Math.round(y + LANE_H / 2) + 0.5);
      ctx.lineTo(W, Math.round(y + LANE_H / 2) + 0.5);
      ctx.stroke();
    }
  }

  // Past the last bar.
  const endX = gx(doc.bars.length * barLen);
  if (endX < W) {
    ctx.globalAlpha = 0.05;
    ctx.fillStyle = t.text;
    ctx.fillRect(Math.max(KEY_W, endX), RULER_H, W, gridH);
    ctx.globalAlpha = 1;
  }

  // Loop tint.
  if (s.loop) {
    ctx.fillStyle = t.accent;
    ctx.globalAlpha = t.dark ? 0.08 : 0.1;
    ctx.fillRect(gx(s.loop.startTick), RULER_H, (s.loop.endTick - s.loop.startTick) * g.pxPerTick, gridH);
    ctx.globalAlpha = 1;
  }

  // Vertical lines: snap steps (faint), beats, bar lines.
  const beatTicks = WHOLE_NOTE_TICKS / doc.header.time.denominator;
  const stepPx = s.snapTicks * g.pxPerTick;
  const barFrom = Math.max(0, Math.floor(t0 / barLen));
  const barTo = Math.ceil(t1 / barLen);
  ctx.lineWidth = 1;
  for (let b = barFrom; b <= barTo; b++) {
    const base = b * barLen;
    if (stepPx >= 7) {
      ctx.strokeStyle = t.text;
      ctx.globalAlpha = ink * 0.8;
      for (let k = 1; k * s.snapTicks < barLen; k++) {
        const tk = base + k * s.snapTicks;
        if (tk % beatTicks === 0) continue;
        const x = Math.round(gx(tk)) + 0.5;
        ctx.beginPath();
        ctx.moveTo(x, RULER_H);
        ctx.lineTo(x, H);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    }
    ctx.strokeStyle = t.line;
    for (let k = 1; k * beatTicks < barLen; k++) {
      const x = Math.round(gx(base + k * beatTicks)) + 0.5;
      ctx.beginPath();
      ctx.moveTo(x, RULER_H);
      ctx.lineTo(x, H);
      ctx.stroke();
    }
    ctx.strokeStyle = t.barline;
    ctx.lineWidth = 2;
    const x = Math.round(gx(base));
    ctx.beginPath();
    ctx.moveTo(x, RULER_H);
    ctx.lineTo(x, H);
    ctx.stroke();
    ctx.lineWidth = 1;
  }

  // Pitch hints: heat-map, strongest-pitch dots, hatching over parts not heard yet.
  const layer = s.hintsLayer;
  if (layer && pitch) {
    const v0 = layer.mapper.ticksToVideo(Math.max(0, t0));
    const v1 = layer.mapper.ticksToVideo(t1);
    const frames = framesInRange(layer.hints, v0 - 0.05, v1 + 0.05);
    const frameTicks = layer.mapper.videoToTicks(v0 + 0.02) - layer.mapper.videoToTicks(v0);
    const fw = Math.max(1.5, Math.abs(frameTicks) * g.pxPerTick);
    ctx.fillStyle = t.text;
    const rowTopBase = RULER_H - scrollY + 1;
    for (const f of frames) {
      const x = gx(layer.mapper.videoToTicks(f.timeSec));
      if (x + fw < KEY_W || x > W) continue;
      for (let k = 0; k < HINT_BINS; k++) {
        const val = f.frame[k]!;
        if (val < 40) continue;
        const a = Math.pow(val / 255, 1.6) * layer.brightness * 0.55;
        if (a < 0.02) continue;
        ctx.globalAlpha = Math.min(1, a);
        ctx.fillRect(x, rowTopBase + (ROLL_MAX_MIDI - (HINT_MIDI_MIN + k)) * g.rowH, fw, g.rowH - 2);
      }
      const sp = strongest(f.frame);
      if (sp !== null) {
        ctx.globalAlpha = 0.7 * Math.max(0.4, layer.brightness);
        ctx.fillRect(x + fw / 2 - 1.5, gy(rowTop(g, sp) + g.rowH / 2) - 1.5, 3, 3);
      }
    }
    ctx.globalAlpha = 1;
    const gaps = uncoveredRanges(layer.hints, Math.max(0, v0), v1);
    const pat = hatch(ctx, t.dark ? "rgba(242,237,228,0.07)" : "rgba(31,27,20,0.08)");
    for (const r of gaps) {
      const xa = Math.max(KEY_W, gx(layer.mapper.videoToTicks(r.startSec)));
      const xb = Math.min(W, gx(layer.mapper.videoToTicks(r.endSec)));
      if (xb <= xa) continue;
      if (pat) {
        ctx.fillStyle = pat;
        ctx.fillRect(xa, RULER_H, xb - xa, gridH);
      }
      if (xb - xa > 190) {
        const label = "Play this part to see hints";
        ctx.font = `600 11px ${UI}`;
        const lw = ctx.measureText(label).width + 16;
        const cx = Math.max(xa, KEY_W) + (xb - xa) / 2 - lw / 2;
        ctx.fillStyle = t.bg;
        roundRect(ctx, cx, RULER_H + 10, lw, 20, 10);
        ctx.fill();
        ctx.fillStyle = t.muted;
        ctx.textBaseline = "middle";
        ctx.fillText(label, cx + 8, RULER_H + 20);
      }
    }
  } else if (layer && !pitch) {
    const label = "Pitch hints show in the Pitch view";
    ctx.font = `600 11px ${UI}`;
    const lw = ctx.measureText(label).width + 18;
    ctx.fillStyle = t.surface2;
    roundRect(ctx, W - lw - 10, H - 28, lw, 20, 10);
    ctx.fill();
    ctx.fillStyle = t.muted;
    ctx.textBaseline = "middle";
    ctx.fillText(label, W - lw - 1, H - 18);
  }

  // Visible notes.
  const visible: EdNote[] = [];
  for (const n of doc.notes) {
    if (n.startTick > t1 + barLen || n.startTick + n.durationTicks < t0 - barLen) continue;
    visible.push(n);
  }

  // Technique links, under the blocks.
  ctx.lineWidth = 1.6;
  ctx.font = `700 11px ${MONO}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "alphabetic";
  for (const n of visible) {
    const c = n.meta.connection;
    if (!c || c.kind === "bend") continue;
    const prev = previousOnString(doc, n);
    if (!prev) continue;
    const a = noteRect(g, doc, prev);
    const b = noteRect(g, doc, n);
    const x1 = gx(0) + a.x + a.w - 3;
    const x2 = gx(0) + b.x + 3;
    const y1 = gy(a.y + a.h / 2);
    const y2 = gy(b.y + b.h / 2);
    ctx.strokeStyle = t.text;
    ctx.fillStyle = t.text;
    ctx.globalAlpha = 0.85;
    ctx.beginPath();
    if (c.kind === "slide") {
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.stroke();
      ctx.fillText(n.fret > prev.fret ? "/" : "\\", (x1 + x2) / 2, (y1 + y2) / 2 - 6);
    } else {
      const top1 = gy(a.y);
      const top2 = gy(b.y);
      const peak = Math.min(top1, top2) - 14;
      ctx.moveTo(x1, top1);
      ctx.quadraticCurveTo((x1 + x2) / 2, peak, x2, top2);
      ctx.stroke();
      ctx.fillText(c.kind === "hammer" ? "h" : "p", (x1 + x2) / 2, peak + 1);
    }
    ctx.globalAlpha = 1;
  }

  // Blocks.
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const labelFont = `700 ${pitch ? Math.min(11, g.rowH - 4) : 12.5}px ${MONO}`;
  const pills: { x: number; y: number; h: number; text: string; fill: string; fg: string }[] = [];
  for (const n of visible) {
    const r = noteRect(g, doc, n);
    const x = gx(0) + r.x;
    const y = gy(r.y);
    if (x > W || x + r.w < KEY_W || y > H || y + r.h < RULER_H) continue;
    const bad = s.conflicts.has(n.id);
    const sel = s.selected.has(n.id);
    const fill = bad ? t.record : t.accent;
    const fg = bad ? "#fff" : t.onAccent;
    roundRect(ctx, x, y, r.w, r.h, Math.min(5, r.w / 2));
    ctx.fillStyle = fill;
    ctx.fill();
    if (s.hoverId === n.id && !sel) {
      ctx.strokeStyle = t.text;
      ctx.globalAlpha = 0.5;
      ctx.lineWidth = 1;
      roundRect(ctx, x + 0.5, y + 0.5, r.w - 1, r.h - 1, 5);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (sel) {
      ctx.strokeStyle = t.accent;
      ctx.globalAlpha = 0.45;
      ctx.lineWidth = 4;
      roundRect(ctx, x - 3, y - 3, r.w + 6, r.h + 6, 7);
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = t.text;
      ctx.lineWidth = 2;
      roundRect(ctx, x - 1, y - 1, r.w + 2, r.h + 2, 6);
      ctx.stroke();
      // resize handle
      ctx.fillStyle = "rgba(0,0,0,0.2)";
      ctx.fillRect(x + r.w - 6, y + 2, 4, r.h - 4);
    }
    // label
    const label =
      (n.meta.muted ? "x" : pitch ? `${n.fret} ${STRING_LETTERS[n.string - 1]}` : String(n.fret)) +
      (n.meta.vibrato ? " ~" : "") +
      (n.meta.connection?.kind === "bend" ? (n.meta.connection.semitones === 0 ? " ↘" : " ↗") : "");
    // Full label inside when it fits, else just the fret; failing that, a pill over the note (drawn after
    // every block so neighbours can't cover it).
    ctx.font = labelFont;
    const short = n.meta.muted ? "x" : String(n.fret);
    const fits = (text: string): boolean => ctx.measureText(text).width + 7 <= r.w;
    const text = fits(label) ? label : fits(short) ? short : null;
    if (text) {
      ctx.fillStyle = fg;
      ctx.fillText(text, x + 4, y + r.h / 2 + 0.5);
    } else {
      pills.push({ x, y, h: r.h, text: short, fill, fg });
    }
    if (n.meta.slideIn || n.meta.slideOut) {
      ctx.strokeStyle = t.text;
      ctx.lineWidth = 1.6;
      ctx.beginPath();
      if (n.meta.slideIn) {
        ctx.moveTo(x - 8, y + r.h - 1);
        ctx.lineTo(x - 1, y + r.h / 2);
      }
      if (n.meta.slideOut) {
        ctx.moveTo(x + r.w + 1, y + r.h / 2);
        ctx.lineTo(x + r.w + 8, y + r.h - 1);
      }
      ctx.stroke();
    }
  }

  // Labels of notes too short to hold them, centred on the note's start; skipped where they'd cover
  // the previous pill in the same row.
  ctx.font = labelFont;
  const lastEnd = new Map<number, number>();
  for (const pl of pills) {
    const w = ctx.measureText(pl.text).width + 6;
    const px = pl.x - 1;
    if ((lastEnd.get(pl.y) ?? -Infinity) > px) continue;
    lastEnd.set(pl.y, px + w + 1);
    roundRect(ctx, px, pl.y, w, pl.h, 4);
    ctx.fillStyle = pl.fill;
    ctx.fill();
    ctx.strokeStyle = t.bg;
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.fillStyle = pl.fg;
    ctx.fillText(pl.text, px + 3, pl.y + pl.h / 2 + 0.5);
  }

  if (s.ghost) {
    ctx.setLineDash([4, 3]);
    ctx.strokeStyle = t.accent;
    ctx.fillStyle = t.accent;
    ctx.lineWidth = 1.5;
    ctx.globalAlpha = 0.25;
    roundRect(ctx, gx(0) + s.ghost.x, gy(s.ghost.y), s.ghost.w, s.ghost.h, 5);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
    ctx.setLineDash([]);
  }
  if (s.box) {
    ctx.fillStyle = t.accent;
    ctx.globalAlpha = 0.14;
    ctx.fillRect(gx(0) + s.box.x, gy(s.box.y), s.box.w, s.box.h);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = t.accent;
    ctx.lineWidth = 1;
    ctx.strokeRect(gx(0) + s.box.x + 0.5, gy(s.box.y) + 0.5, s.box.w, s.box.h);
  }

  // Playhead.
  const px = Math.round(gx(s.playheadTick));
  if (px >= KEY_W - 1 && px <= W) {
    ctx.fillStyle = t.accent;
    ctx.shadowColor = t.accent;
    ctx.shadowBlur = 8;
    ctx.fillRect(px - 1, RULER_H, 2, gridH);
    ctx.shadowBlur = 0;
  }
  ctx.restore();

  // ---- keyboard column
  ctx.save();
  ctx.beginPath();
  ctx.rect(0, RULER_H, KEY_W, gridH);
  ctx.clip();
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, RULER_H, KEY_W, gridH);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  if (pitch) {
    const m0 = Math.max(ROLL_MIN_MIDI, ROLL_MAX_MIDI - Math.ceil((scrollY + gridH) / g.rowH));
    const m1 = Math.min(ROLL_MAX_MIDI, ROLL_MAX_MIDI - Math.floor(scrollY / g.rowH));
    for (let m = m0; m <= m1; m++) {
      const y = gy(rowTop(g, m));
      const black = isBlackKey(m);
      const isC = m % 12 === 0;
      if (black) {
        ctx.fillStyle = t.surface2;
        ctx.fillRect(0, y, KEY_W, g.rowH);
      }
      ctx.fillStyle = black ? t.subtle : isC ? t.text : t.muted;
      ctx.font = `${isC ? 700 : 500} ${isC || m % 12 === 4 ? 10.5 : 9.5}px ${MONO}`;
      ctx.fillText(noteName(m), 8, y + g.rowH / 2 + 0.5);
      if (isC) {
        ctx.strokeStyle = t.line;
        ctx.beginPath();
        ctx.moveTo(0, Math.round(y + g.rowH) - 0.5);
        ctx.lineTo(KEY_W, Math.round(y + g.rowH) - 0.5);
        ctx.stroke();
      }
    }
  } else {
    for (let st = 1; st <= 6; st++) {
      const y = gy(laneTop(st));
      ctx.fillStyle = t.muted;
      ctx.font = `700 11px ${MONO}`;
      ctx.fillText(`${STRING_LETTERS[st - 1]} string`, 6, y + LANE_H / 2 + 0.5);
      ctx.strokeStyle = t.line;
      ctx.beginPath();
      ctx.moveTo(0, Math.round(y + LANE_H) - 0.5);
      ctx.lineTo(KEY_W, Math.round(y + LANE_H) - 0.5);
      ctx.stroke();
    }
  }
  ctx.restore();
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(KEY_W - 0.5, RULER_H);
  ctx.lineTo(KEY_W - 0.5, H);
  ctx.stroke();

  // ---- ruler
  ctx.save();
  ctx.beginPath();
  ctx.rect(KEY_W, 0, gridW, RULER_H);
  ctx.clip();
  ctx.fillStyle = t.bg;
  ctx.fillRect(KEY_W, 0, gridW, RULER_H);
  if (s.loop) {
    const lx = gx(s.loop.startTick);
    const lw = (s.loop.endTick - s.loop.startTick) * g.pxPerTick;
    ctx.fillStyle = t.accent;
    ctx.globalAlpha = t.dark ? 0.16 : 0.2;
    ctx.fillRect(lx, 0, lw, 18);
    ctx.globalAlpha = 0.55;
    ctx.fillRect(lx, 0, 2, 18);
    ctx.fillRect(lx + lw - 2, 0, 2, 18);
    ctx.globalAlpha = 1;
  }
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (let b = barFrom; b <= barTo; b++) {
    const x = gx(b * barLen);
    ctx.strokeStyle = t.line;
    ctx.beginPath();
    ctx.moveTo(Math.round(x) + 0.5, 0);
    ctx.lineTo(Math.round(x) + 0.5, 18);
    ctx.stroke();
    ctx.fillStyle = b < doc.bars.length ? t.muted : t.subtle;
    ctx.font = `700 11px ${MONO}`;
    ctx.fillText(String(b + 1), x + 5, 13);
  }
  // Section chips.
  ctx.textBaseline = "middle";
  doc.sections.forEach((sec, i) => {
    const bar = doc.bars[sec.startBar];
    if (!bar) return;
    let x = gx(bar.startTick) + 4;
    const chips: { text: string; fg: string; bg: string }[] = [{ text: sec.name, fg: t.accentText, bg: t.accentTint }];
    const capo = capoOfBar(doc, sec.startBar);
    if (capo > 0) chips.push({ text: `Capo ${capo}`, fg: t.warn, bg: t.surface2 });
    if (sec.bpm !== undefined && (i > 0 || sec.bpm !== doc.header.bpm)) chips.push({ text: `${bpmOfBar(doc, sec.startBar)} bpm`, fg: t.muted, bg: t.surface2 });
    ctx.font = `700 10.5px ${UI}`;
    for (const c of chips) {
      const w = ctx.measureText(c.text).width + 14;
      if (x + w > KEY_W && x < W) {
        ctx.fillStyle = c.bg;
        roundRect(ctx, x, 20, w, 15, 7.5);
        ctx.fill();
        ctx.fillStyle = c.fg;
        ctx.fillText(c.text, x + 7, 28);
      }
      x += w + 4;
    }
  });
  // Pitch-hint note starts.
  if (layer) {
    const v0 = layer.mapper.ticksToVideo(Math.max(0, t0));
    const v1 = layer.mapper.ticksToVideo(t1);
    ctx.fillStyle = t.muted;
    for (const sec of onsetsInRange(layer.hints, v0, v1)) {
      ctx.fillRect(Math.round(gx(layer.mapper.videoToTicks(sec))) - 1, RULER_H - 7, 2, 7);
    }
  }
  // Bar-1 flag.
  if (s.flagSec !== undefined) {
    const fx = gx(0);
    ctx.fillStyle = t.ok;
    ctx.fillRect(fx - 1, 0, 2, RULER_H);
    ctx.font = `700 10px ${UI}`;
    ctx.textBaseline = "middle";
    ctx.fillText(flagText(s.flagSec), fx + 4, 41);
  }
  // Playhead marker.
  const hx = gx(s.playheadTick);
  ctx.fillStyle = t.accent;
  ctx.beginPath();
  ctx.moveTo(hx - 6, RULER_H - 14);
  ctx.lineTo(hx + 6, RULER_H - 14);
  ctx.lineTo(hx, RULER_H - 6);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = t.line;
  ctx.beginPath();
  ctx.moveTo(0, RULER_H - 0.5);
  ctx.lineTo(W, RULER_H - 0.5);
  ctx.stroke();

  // Corner.
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, KEY_W - 1, RULER_H - 1);
  ctx.fillStyle = t.subtle;
  ctx.font = `700 10px ${UI}`;
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.fillText(pitch ? "PITCH" : "STRINGS", 8, RULER_H - 7);
}
