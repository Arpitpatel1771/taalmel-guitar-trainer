// Renders a song's sheet from a precomputed Layout (spec 8.1-8.3). Pure
// presentational component: all positions come from `layout`, all note-glyph
// decisions come from `notation`. Re-rendered only when layout/song/lanes
// change (the caller debounces relayout itself, per spec 8.1).

import { useEffect, useRef } from "react";
import type { LaneId, Note, Song } from "../model";
import type { Layout, Row } from "../layout";
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

function noteTop(stringIndex: number): number {
  return TAB_LANE_TOP + stringIndex * TAB_STRING_GAP;
}

function TabNote({ note, prev, x, width }: { note: Note; prev: Note | undefined; x: number; width: number }) {
  const glyph = tabGlyph(note, prev);
  const top = noteTop(note.string - 1);
  return (
    <div
      className={`tab-note${note.uncertain ? " uncertain" : ""}`}
      style={{ left: x, top, width: Math.max(width, 14) }}
    >
      {note.meta.strum && (
        // Positioned in the lane's top band, above the whole slot (spec 8.2).
        <span className={`strum-arrow strum-${note.meta.strum}`} style={{ top: 12 - top }}>{note.meta.strum === "up" ? "↑" : "↓"}</span>
      )}
      <span className="duration-bar" style={{ width: Math.max(width, 4) }} />
      <span className="fret-number">{glyph.text}</span>
      {glyph.techniqueLabel && <span className="technique-label">{glyph.techniqueLabel}</span>}
    </div>
  );
}

/** `rank` is the note's position within its slot, highest string first, so a
 * single note sits on the top line and chords stack downward. */
function LetterNote({ note, x, rank }: { note: Note; x: number; rank: number }) {
  const letter = letterOfNote(note);
  const top = 2 + rank * LETTER_LINE_HEIGHT;
  return (
    <div className={`letter-note${note.uncertain ? " uncertain" : ""}`} style={{ left: x, top }}>
      {letter}
    </div>
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
  songIndex,
  lanes,
  registerCanvas,
  loopRange,
  onBarMouseDown,
  onBarMouseEnter,
}: {
  row: Row;
  songIndex: SongIndex;
  lanes: Record<LaneId, boolean>;
  registerCanvas: (rowIndex: number, el: HTMLCanvasElement | null) => void;
  loopRange?: { start: number; end: number } | null;
  onBarMouseDown?: (barNumber: number, shiftKey: boolean) => void;
  onBarMouseEnter?: (barNumber: number) => void;
}) {
  const barsWidth = row.bars.length > 0 ? row.bars[row.bars.length - 1].x + row.bars[row.bars.length - 1].width - row.x0 : 0;

  return (
    <div className="sheet-row" style={{ top: row.y, height: row.height }}>
      {/* Waveform/verdict overlay: painted first (and thus behind the grid
          lines, lanes and notes below it in DOM/paint order -- spec 9.2) so
          notes stay readable on top. Spans the whole row's lane area, not a
          separate reserved strip. */}
      <canvas
        ref={(el) => registerCanvas(row.index, el)}
        className="envelope-canvas"
        style={{ top: 0, left: row.x0, width: barsWidth, height: row.height }}
        width={Math.max(1, Math.round(barsWidth))}
        height={Math.max(1, Math.round(row.height))}
      />

      {row.bars.map((bar) => {
        const inLoop = !!loopRange && bar.barNumber >= loopRange.start && bar.barNumber <= loopRange.end;
        return (
          <div
            key={bar.barNumber}
            className={`bar-labels${inLoop ? " in-loop" : ""}`}
            style={{ left: bar.x, width: bar.width }}
            onMouseDown={(e) => onBarMouseDown?.(bar.barNumber, e.shiftKey)}
            onMouseEnter={() => onBarMouseEnter?.(bar.barNumber)}
            role={onBarMouseDown ? "button" : undefined}
          >
            <span className="bar-number">{bar.barNumber}</span>
            {songIndex.sectionStartBars.has(bar.barNumber) && (
              <span className="section-name">{songIndex.sectionNameForBar.get(bar.barNumber)}</span>
            )}
          </div>
        );
      })}

      <svg className="grid-lines" style={{ left: row.x0, width: barsWidth, height: row.height }}>
        {row.bars.map((bar) =>
          bar.gridXs.map((gx, i) => (
            <line
              key={`${bar.barNumber}-${i}`}
              x1={gx - row.x0}
              x2={gx - row.x0}
              y1={0}
              y2={row.height}
              className={i === 0 ? "bar-line" : "slot-line"}
            />
          )),
        )}
      </svg>

      {lanes.tab && (
        <div className="lane lane-tab" style={{ top: row.laneOffsets.tab ?? 0, left: row.x0 }}>
          {Array.from({ length: STRING_COUNT }, (_, i) => (
            <div key={i} className="string-line" style={{ top: noteTop(i) }} />
          ))}
          {row.notes.map((nb) => (
            <TabNote
              key={`${nb.note.string}-${nb.note.startTick}`}
              note={nb.note}
              prev={songIndex.prevNote(nb.note)}
              x={nb.x - row.x0}
              width={nb.width}
            />
          ))}
        </div>
      )}

      {lanes.letter && (
        <div className="lane lane-letter" style={{ top: row.laneOffsets.letter ?? 0, left: row.x0 }}>
          {row.notes.map((nb) => (
            <LetterNote
              key={`${nb.note.string}-${nb.note.startTick}`}
              note={nb.note}
              x={nb.x - row.x0}
              rank={row.notes.filter((o) => o.note.startTick === nb.note.startTick && o.note.string < nb.note.string).length}
            />
          ))}
        </div>
      )}

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

export function Sheet({ layout, songIndex, lanes, onReady, loopRange, onBarMouseDown, onBarMouseEnter }: SheetProps) {
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
    <div ref={containerRef} className="sheet-scroll">
      <div className="sheet-inner" style={{ height: layout.totalHeight, width: layout.width }}>
        {layout.rows.map((row) => (
          <RowView
            key={row.index}
            row={row}
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
