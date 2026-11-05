// Small derived indices over a Song used only for rendering (section-name
// labels per bar, and "previous note on this same string" lookups for tab
// technique labels, spec 8.2/8.3). Kept in `render` since these are display
// concerns, not part of the pure `model`/`notation` contracts.

import type { Note, Song } from "../model";

export interface SongIndex {
  /** Section name for a given (global) bar number. */
  sectionNameForBar: Map<number, string>;
  /** Bar numbers where a new section starts (for drawing the section label). */
  sectionStartBars: Set<number>;
  /** Capo to show as a badge above a bar: the song's first bar and every section
   * start whose capo differs from the previous section's. Empty when the song
   * never uses a capo (a "No capo" badge on every plain song would be noise). */
  capoBadgeForBar: Map<number, number>;
  /** The previous note on the same string (by start tick), if any. */
  prevNote(note: Note): Note | undefined;
}

function noteKey(note: Note): string {
  return `${note.string}:${note.startTick}`;
}

export function buildSongIndex(song: Song): SongIndex {
  const sectionNameForBar = new Map<number, string>();
  const sectionStartBars = new Set<number>();
  for (const section of song.sections) {
    if (section.bars.length === 0) continue;
    sectionStartBars.add(section.bars[0].number);
    for (const bar of section.bars) {
      sectionNameForBar.set(bar.number, section.name);
    }
  }

  const capoBadgeForBar = new Map<number, number>();
  const usesCapo = song.sections.some((s) => s.bars.some((b) => b.capo > 0));
  if (usesCapo) {
    let prevCapo: number | null = null;
    for (const section of song.sections) {
      const first = section.bars[0];
      if (!first) continue;
      if (prevCapo === null || first.capo !== prevCapo) capoBadgeForBar.set(first.number, first.capo);
      prevCapo = section.bars[section.bars.length - 1].capo;
    }
  }

  const byString = new Map<number, Note[]>();
  for (const note of song.notes) {
    const arr = byString.get(note.string);
    if (arr) arr.push(note);
    else byString.set(note.string, [note]);
  }
  const prevByKey = new Map<string, Note | undefined>();
  for (const arr of byString.values()) {
    arr.sort((a, b) => a.startTick - b.startTick);
    for (let i = 0; i < arr.length; i++) {
      prevByKey.set(noteKey(arr[i]), i > 0 ? arr[i - 1] : undefined);
    }
  }

  return {
    sectionNameForBar,
    sectionStartBars,
    capoBadgeForBar,
    prevNote: (note: Note) => prevByKey.get(noteKey(note)),
  };
}

/** The capo the player will reach at the next bar boundary, when it differs from
 * the capo of the bar at `tick`; null otherwise. `loop` makes the last bar of a
 * loop look ahead to the loop's first bar (the wrap), not the next bar of the song. */
export function upcomingCapoChange(
  song: Song,
  tick: number,
  loop?: { startTick: number; endTick: number } | null,
): number | null {
  const bars = song.sections.flatMap((s) => s.bars);
  const idx = bars.findIndex((b) => tick >= b.startTick && tick < b.startTick + b.lengthTicks);
  if (idx < 0) return null;
  const cur = bars[idx];
  const wraps = !!loop && cur.startTick + cur.lengthTicks >= loop.endTick;
  const next = wraps ? bars.find((b) => b.startTick === loop!.startTick) : bars[idx + 1];
  return next && next.capo !== cur.capo ? next.capo : null;
}
