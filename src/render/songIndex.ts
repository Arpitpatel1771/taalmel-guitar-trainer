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
    prevNote: (note: Note) => prevByKey.get(noteKey(note)),
  };
}
