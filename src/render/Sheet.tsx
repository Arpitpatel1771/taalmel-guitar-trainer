// Renders a song's sheet from a precomputed Layout (spec 8.1-8.3; UI revamp
// phase 2, specs/26-9-ui-revamp.md 5.2). One SVG per row draws the grid, loop
// band, tab lane (strings, note pills, technique curves) and letter lane in
// the layout's absolute x coordinates. The live waveform canvas sits behind it
// and the teacher lane stays HTML (dot/zone glyph layout). Re-rendered only
// when layout/song/lanes change; per-frame work lives in PlaybackController.

import { useEffect, useRef, type ReactNode } from "react";
import type { LaneId, Note, Song, TimeSignature } from "../model";
import type { BarBox, Layout, NoteBox, Row } from "../layout";
import { LETTER_LINE_HEIGHT, STRING_COUNT, TAB_LANE_TOP, TAB_STRING_GAP } from "../layout";
import { letterOfNote, tabGlyph, teacherGlyph } from "../notation";
import type { SongIndex } from "./songIndex";

export interface SheetHandle {
  container: HTMLDivElement;
  cursor: HTMLDivElement;
  getRowCanvas: (rowIndex: number) => HTMLCanvasElement | null;
}

export interface SheetProps {
  song: Song;
  layout: Layout;
  songIndex: SongIndex;
  lanes: Record<LaneId, boolean>;
  onReady: (handle: SheetHandle) => void;
  /** Loop selection, as inclusive bar numbers (spec 10.2). */
  loopRange?: { start: number; end: number } | null;
  /** Mouse-down/enter on a bar header: click, shift-click to extend, or
   * click-and-drag across bar headers to pick a loop range (spec 10.2). */
  onBarMouseDown?: (barNumber: number, shiftKey: boolean) => void;
  onBarMouseEnter?: (barNumber: number) => void;
}

/** Width of a note's head (the part holding the fret number). */
const HEAD_W = 18;
const HEAD_H = 16;

function stringY(laneTop: number, stringIndex: number): number {
  return laneTop + TAB_LANE_TOP + stringIndex * TAB_STRING_GAP;
}

/** Ticks per metronome beat: quarter notes, or eighths for x/8 (spec 7.5). */
function beatTicks(time: TimeSignature): number {
  return time.denominator >= 8 ? 3840 / time.denominator : 960;
}

function GridLines({ bar, time, y0, y1 }: { bar: BarBox; time: TimeSignature; y0: number; y1: number }) {
  const slots = bar.gridXs.length - 1;
  const slotTicks = bar.lengthTicks / slots;
  const beat = beatTicks(time);
  return (
    <>
      {bar.gridXs.slice(0, slots).map((gx, i) => {
        const cls = i === 0 ? "grid-bar" : (i * slotTicks) % beat === 0 ? "grid-beat" : "grid-slot";
        return <line key={i} x1={gx} x2={gx} y1={y0} y2={y1} className={cls} />;
      })}
    </>
  );
}

function bendLabel(semitones: number): string {
  if (semitones === 1) return "½";
  if (semitones === 2) return "full";
  return String(semitones / 2);
}

/** Drawn technique mark from the previous note on the same string to this
 * one (spec 8.2, revamp 5.2). `prevX` is null when the previous note is on an
 * earlier row, in which case a half-mark starts at the row's left edge. */
function TechniqueMark({ note, prev, x, prevX, sy, rowX0 }: { note: Note; prev: Note | undefined; x: number; prevX: number | null; sy: number; rowX0: number }) {
  const conn = note.meta.connection;
  if (!conn) return null;
  const endX = x + HEAD_W / 2;

  if (conn.kind === "bend") {
    const bx = x + HEAD_W + 2;
    if (conn.semitones === 0) {
      return (
        <g className="tech-mark">
          <path d={`M ${bx} ${sy - 12} Q ${bx + 8} ${sy - 12} ${bx + 8} ${sy - 2}`} className="tech-line" />
          <path d={`M ${bx + 5} ${sy - 5} L ${bx + 8} ${sy - 1} L ${bx + 11} ${sy - 5}`} className="tech-line" />
          <text x={bx + 12} y={sy - 10} className="tech-label">r</text>
        </g>
      );
    }
    return (
      <g className="tech-mark">
        <path d={`M ${bx} ${sy} Q ${bx + 8} ${sy} ${bx + 8} ${sy - 14}`} className="tech-line" />
        <path d={`M ${bx + 5} ${sy - 11} L ${bx + 8} ${sy - 15} L ${bx + 11} ${sy - 11}`} className="tech-line" />
        <text x={bx + 12} y={sy - 12} className="tech-label">{bendLabel(conn.semitones)}</text>
      </g>
    );
  }

  // No previous note at all (hammer-on from nowhere): short lead-in arc.
  // Previous note on an earlier row: half-arc from the row's left edge.
  const startX = !prev ? x - 14 : prevX === null ? rowX0 : prevX + HEAD_W / 2;
  if (conn.kind === "slide") {
    const up = prev ? note.fret > prev.fret : true;
    const x1 = prevX === null ? rowX0 : prevX + HEAD_W + 1;
    const x2 = x - 1;
    if (x2 <= x1) return null;
    return <line className="tech-line" x1={x1} x2={x2} y1={up ? sy + 4 : sy - 4} y2={up ? sy - 4 : sy + 4} />;
  }

  // Hammer-on / pull-off: slur arc above the two note heads.
  const top = sy - HEAD_H / 2 - 1;
  const midX = (startX + endX) / 2;
  const lift = Math.min(10, Math.max(5, (endX - startX) / 5));
  return (
    <g className="tech-mark">
      <path className="tech-line" d={`M ${startX} ${top} Q ${midX} ${top - lift * 1.6} ${endX} ${top}`} />
      <text x={midX} y={top - lift - 2} className="tech-label" textAnchor="middle">
        {conn.kind === "hammer" ? "h" : "p"}
      </text>
    </g>
  );
}

function NotePill({ nb, sy }: { nb: NoteBox; sy: number }) {
  const { note } = nb;
  const glyph = tabGlyph(note, undefined);
  const headW = Math.max(HEAD_W, glyph.text.length * 8 + 6);
  const w = Math.max(headW, nb.width - 2);
  return (
    <g className={`note-pill${note.uncertain ? " uncertain" : ""}${note.meta.muted ? " muted" : ""}`}>
      <rect className="note-tail" x={nb.x} y={sy - 3} width={w} height={6} rx={3} />
      <rect className="note-head" x={nb.x} y={sy - HEAD_H / 2} width={headW} height={HEAD_H} rx={HEAD_H / 2} />
      <text className="note-fret" x={nb.x + headW / 2} y={sy + 0.5} textAnchor="middle" dominantBaseline="central">
        {glyph.text}
      </text>
    </g>
  );
}

function TabLane({ row, songIndex, laneTop }: { row: Row; songIndex: SongIndex; laneTop: number }) {
  const xByNote = new Map<Note, number>(row.notes.map((nb) => [nb.note, nb.x]));
  const strummed = new Set<number>();
  const strumMarks: ReactNode[] = [];
  for (const nb of row.notes) {
    if (nb.note.meta.strum && !strummed.has(nb.note.startTick)) {
      strummed.add(nb.note.startTick);
      strumMarks.push(
        <text key={`strum-${nb.note.startTick}`} x={nb.x + HEAD_W / 2} y={laneTop + 26} className="strum-mark" textAnchor="middle">
          {nb.note.meta.strum === "up" ? "↑" : "↓"}
        </text>,
      );
    }
  }
  const x1 = row.bars.length ? row.bars[row.bars.length - 1].x + row.bars[row.bars.length - 1].width : row.x0;
  return (
    <g className="lane-tab">
      {Array.from({ length: STRING_COUNT }, (_, i) => (
        <line key={i} className="string-line" x1={row.x0} x2={x1} y1={stringY(laneTop, i)} y2={stringY(laneTop, i)} />
      ))}
      {row.notes.map((nb) => {
        const prev = songIndex.prevNote(nb.note);
        const prevX = prev ? xByNote.get(prev) ?? null : null;
        return (
          <TechniqueMark
            key={`t-${nb.note.string}-${nb.note.startTick}`}
            note={nb.note}
            prev={prev}
            x={nb.x}
            prevX={prevX}
            sy={stringY(laneTop, nb.stringIndex)}
            rowX0={row.x0}
          />
        );
      })}
      {row.notes.map((nb) => (
        <NotePill key={`${nb.note.string}-${nb.note.startTick}`} nb={nb} sy={stringY(laneTop, nb.stringIndex)} />
      ))}
      {strumMarks}
    </g>
  );
}

function LetterLane({ row, laneTop }: { row: Row; laneTop: number }) {
  return (
    <g className="lane-letter">
      {row.notes.map((nb) => {
        const rank = row.notes.filter((o) => o.note.startTick === nb.note.startTick && o.note.string < nb.note.string).length;
        return (
          <text
            key={`${nb.note.string}-${nb.note.startTick}`}
            x={nb.x + HEAD_W / 2}
            y={laneTop + 12 + rank * LETTER_LINE_HEIGHT}
            textAnchor="middle"
            className={`letter-glyph${nb.note.uncertain ? " uncertain" : ""}`}
          >
            {letterOfNote(nb.note)}
          </text>
        );
      })}
    </g>
  );
}

function TeacherNote({ note, x }: { note: Note; x: number }) {
  const glyph = teacherGlyph(note);
  if (glyph.kind === "fallback") {
    return (
      <div className={`teacher-note fallback${note.uncertain ? " uncertain" : ""}`} style={{ left: x }}>
        {glyph.text}
      </div>
    );
  }
  return (
    <div className={`teacher-note${note.uncertain ? " uncertain" : ""}`} style={{ left: x }}>
      <span className="teacher-zone">{glyph.zone}</span>
      {glyph.register === "above" && <span className="teacher-dot teacher-dot-above" />}
      <span className="teacher-letter">{glyph.letter}</span>
      {glyph.register === "below" && <span className="teacher-dot teacher-dot-below" />}
    </div>
  );
}

function RowView({
  row,
  width,
  time,
  songIndex,
  lanes,
  registerCanvas,
  loopRange,
  onBarMouseDown,
  onBarMouseEnter,
}: {
  row: Row;
  width: number;
  time: TimeSignature;
  songIndex: SongIndex;
  lanes: Record<LaneId, boolean>;
  registerCanvas: (rowIndex: number, el: HTMLCanvasElement | null) => void;
  loopRange?: { start: number; end: number } | null;
  onBarMouseDown?: (barNumber: number, shiftKey: boolean) => void;
  onBarMouseEnter?: (barNumber: number) => void;
}) {
  const lastBar = row.bars[row.bars.length - 1];
  const barsEnd = lastBar ? lastBar.x + lastBar.width : row.x0;
  const barsWidth = barsEnd - row.x0;
  const loopBars = loopRange ? row.bars.filter((b) => b.barNumber >= loopRange.start && b.barNumber <= loopRange.end) : [];

  return (
    <div className="sheet-row" data-row={row.index} style={{ top: row.y, height: row.height }}>
      {/* Waveform/verdict overlay, painted first so notes stay readable on top (spec 9.2). */}
      <canvas
        ref={(el) => registerCanvas(row.index, el)}
        className="envelope-canvas"
        style={{ top: 0, left: row.x0, width: barsWidth, height: row.height }}
        width={Math.max(1, Math.round(barsWidth))}
        height={Math.max(1, Math.round(row.height))}
      />

      <svg className="row-svg" width={width} height={row.height} aria-hidden="true">
        {loopBars.length > 0 && (
          <rect
            className="loop-band"
            x={loopBars[0].x}
            y={0}
            width={loopBars[loopBars.length - 1].x + loopBars[loopBars.length - 1].width - loopBars[0].x}
            height={row.height}
          />
        )}
        {row.bars.map((bar) => (
          <GridLines key={bar.barNumber} bar={bar} time={time} y0={18} y1={row.height} />
        ))}
        <line x1={barsEnd} x2={barsEnd} y1={18} y2={row.height} className="grid-bar" />
        {lanes.tab && <TabLane row={row} songIndex={songIndex} laneTop={row.laneOffsets.tab ?? 0} />}
        {lanes.letter && <LetterLane row={row} laneTop={row.laneOffsets.letter ?? 0} />}
      </svg>

      {row.bars.map((bar) => {
        const inLoop = !!loopRange && bar.barNumber >= loopRange.start && bar.barNumber <= loopRange.end;
        const section = songIndex.sectionStartBars.has(bar.barNumber) ? songIndex.sectionNameForBar.get(bar.barNumber) : undefined;
        return (
          <div
            key={bar.barNumber}
            className={`bar-labels${inLoop ? " in-loop" : ""}`}
            style={{ left: bar.x, width: bar.width }}
            onMouseDown={(e) => onBarMouseDown?.(bar.barNumber, e.shiftKey)}
            onMouseEnter={() => onBarMouseEnter?.(bar.barNumber)}
            role={onBarMouseDown ? "button" : undefined}
            title="Click, shift-click or drag across bars to set the loop range"
          >
            <span className="bar-number">{bar.barNumber}</span>
            {section && <span className="section-name">{section}</span>}
          </div>
        );
      })}

      {lanes.teacher && (
        <div className="lane lane-teacher" style={{ top: row.laneOffsets.teacher ?? 0, left: row.x0 }}>
          {row.notes.map((nb) => (
            <TeacherNote key={`${nb.note.string}-${nb.note.startTick}`} note={nb.note} x={nb.x - row.x0} />
          ))}
        </div>
      )}
    </div>
  );
}

export function Sheet({ song, layout, songIndex, lanes, onReady, loopRange, onBarMouseDown, onBarMouseEnter }: SheetProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const cursorRef = useRef<HTMLDivElement | null>(null);
  const canvasesRef = useRef<Map<number, HTMLCanvasElement>>(new Map());

  const registerCanvas = (rowIndex: number, el: HTMLCanvasElement | null) => {
    if (el) canvasesRef.current.set(rowIndex, el);
    else canvasesRef.current.delete(rowIndex);
  };

  useEffect(() => {
    if (containerRef.current && cursorRef.current) {
      onReady({
        container: containerRef.current,
        cursor: cursorRef.current,
        getRowCanvas: (i) => canvasesRef.current.get(i) ?? null,
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout]);

  return (
    <div ref={containerRef} className="sheet-scroll" tabIndex={0} role="region" aria-label={`Sheet: ${song.header.title}`}>
      <div className="sheet-inner" style={{ height: layout.totalHeight, width: layout.width }}>
        {layout.rows.map((row) => (
          <RowView
            key={row.index}
            row={row}
            width={layout.width}
            time={song.header.time}
            songIndex={songIndex}
            lanes={lanes}
            registerCanvas={registerCanvas}
            loopRange={loopRange}
            onBarMouseDown={onBarMouseDown}
            onBarMouseEnter={onBarMouseEnter}
          />
        ))}
        <div ref={cursorRef} className="playback-cursor" />
      </div>
    </div>
  );
}
