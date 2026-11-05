// String assignment (spec 3.4) and conflict detection.

import type { StringNumber } from "../model/index.js";
import { soundingMidi } from "../notation/index.js";
import { capoAtTick } from "./doc.js";
import { maxFret, positionsFor, type Position } from "./pitch.js";
import type { EdDoc, EdNote } from "./types.js";

export interface ChooseOptions {
  /** Keep this string when it can play the pitch and is free. Otherwise the nearest free string. */
  preferString?: StringNumber;
  /** Without a preferred string: stay near this fret (the previous note's). */
  nearFret?: number;
}

export interface Choice extends Position {
  /** True when no free string can play the pitch; the note shares a string with another. */
  conflict: boolean;
}

/**
 * Picks where to play `midi`. `taken` = strings already used at the same start tick.
 * Returns null when no string can play the pitch at all (out of range).
 */
export function chooseString(midi: number, capo: number, taken: ReadonlySet<number>, opts: ChooseOptions = {}): Choice | null {
  const all = positionsFor(midi, capo);
  if (all.length === 0) return null;
  const free = all.filter((p) => !taken.has(p.string));
  const rank = (a: Position, b: Position): number => {
    if (opts.preferString !== undefined) {
      const d = Math.abs(a.string - opts.preferString) - Math.abs(b.string - opts.preferString);
      if (d !== 0) return d;
    } else if (opts.nearFret !== undefined) {
      const d = Math.abs(a.fret - opts.nearFret) - Math.abs(b.fret - opts.nearFret);
      if (d !== 0) return d;
    }
    return a.fret - b.fret || a.string - b.string;
  };
  if (free.length > 0) return { ...[...free].sort(rank)[0]!, conflict: false };
  return { ...[...all].sort(rank)[0]!, conflict: true };
}

/** The latest note that starts before `tick` (the "previous note" for string context). */
export function previousNote(doc: EdDoc, tick: number, exclude?: ReadonlySet<number>): EdNote | undefined {
  let best: EdNote | undefined;
  for (const n of doc.notes) {
    if (n.startTick >= tick || exclude?.has(n.id)) continue;
    if (!best || n.startTick >= best.startTick) best = n;
  }
  return best;
}

/** Ids of notes that share a string with another note at the same start, or whose fret can't be played. */
export function findConflicts(doc: EdDoc): number[] {
  const seen = new Map<string, number>();
  const out = new Set<number>();
  for (const n of doc.notes) {
    const key = `${n.startTick}:${n.string}`;
    const other = seen.get(key);
    if (other !== undefined) {
      out.add(other);
      out.add(n.id);
    } else seen.set(key, n.id);
    if (n.fret < 0 || n.fret > maxFret(capoAtTick(doc, n.startTick))) out.add(n.id);
  }
  return [...out].sort((a, b) => a - b);
}

export interface PlayOption extends Position {
  /** Another note starts on this string at the same tick. */
  taken: boolean;
  current: boolean;
}

/** The inspector's "Play it on" buttons for one note. */
export function playOptions(doc: EdDoc, id: number): PlayOption[] {
  const n = doc.notes.find((x) => x.id === id);
  if (!n) return [];
  const capo = capoAtTick(doc, n.startTick);
  const midi = soundingMidi(n.string, n.fret, capo);
  const used = new Set<number>(doc.notes.filter((o) => o.id !== id && o.startTick === n.startTick).map((o) => o.string));
  return positionsFor(midi, capo)
    .sort((a, b) => a.string - b.string)
    .map((p) => ({ ...p, taken: used.has(p.string), current: p.string === n.string }));
}
