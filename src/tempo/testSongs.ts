// Hand-made Song builders shared by tempo/clock/layout tests. Not part of
// the public module API (songFormat parser is being built concurrently by
// another agent, so tests here never depend on it).

import type { Bar, Note, NoteMeta, Section, Song, StringNumber } from "../model";

export interface SectionSpec {
  name?: string;
  bpm: number;
  unit?: number;
  /** Number of bars in this section, each `barTicks` long. */
  bars: number;
  /** Tick length per bar in this section (defaults to a 4/4 bar: 3840). */
  barTicks?: number;
  /** Slot count per bar (defaults to `unit`). */
  slots?: number;
}

const DEFAULT_BAR_TICKS = 3840;

/** Builds a minimal, valid-shaped Song from a list of section specs. No
 * notes are added; use `addNote` to place notes on specific bars. */
export function makeSong(specs: SectionSpec[]): Song {
  let barNumber = 1;
  let tick = 0;
  const sections: Section[] = [];

  for (const spec of specs) {
    const unit = spec.unit ?? 8;
    const barTicks = spec.barTicks ?? DEFAULT_BAR_TICKS;
    const slots = spec.slots ?? unit;
    const bars: Bar[] = [];
    for (let i = 0; i < spec.bars; i++) {
      bars.push({
        number: barNumber++,
        startTick: tick,
        lengthTicks: barTicks,
        slots,
        notes: [],
      });
      tick += barTicks;
    }
    sections.push({
      name: spec.name ?? `Section ${sections.length + 1}`,
      bpm: spec.bpm,
      unit,
      bars,
    });
  }

  const totalTicks = tick;
  const firstBpm = specs[0]?.bpm ?? 120;
  const firstUnit = specs[0]?.unit ?? 8;

  return {
    header: {
      title: "Test Song",
      time: { numerator: 4, denominator: 4 },
      bpm: firstBpm,
      unit: firstUnit,
    },
    sections,
    notes: [],
    totalTicks,
  };
}

let sourceCounter = 0;

/** Adds a note to the given bar (by 1-based global bar number) at a tick
 * offset from that bar's start, and keeps `song.notes` sorted and in sync.
 * Returns the created Note. */
export function addNote(
  song: Song,
  barNumber: number,
  opts: {
    string: StringNumber;
    fret: number;
    startTickInBar: number;
    durationTicks: number;
    offsetMs?: number;
    uncertain?: boolean;
    meta?: NoteMeta;
  },
): Note {
  const bar = song.sections.flatMap((s) => s.bars).find((b) => b.number === barNumber);
  if (!bar) throw new Error(`No bar ${barNumber} in test song`);
  const note: Note = {
    string: opts.string,
    fret: opts.fret,
    startTick: bar.startTick + opts.startTickInBar,
    durationTicks: opts.durationTicks,
    offsetMs: opts.offsetMs ?? 0,
    uncertain: opts.uncertain ?? false,
    meta: opts.meta ?? {},
    source: { line: ++sourceCounter, column: 1 },
  };
  bar.notes.push(note);
  bar.notes.sort((a, b) => a.startTick - b.startTick || a.string - b.string);
  song.notes.push(note);
  song.notes.sort((a, b) => a.startTick - b.startTick || a.string - b.string);
  return note;
}
