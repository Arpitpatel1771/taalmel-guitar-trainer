// Technique ("into this note") rules from the song format (specs/26-9-claude.md 5.6).

import { soundingMidi } from "../notation/index.js";
import { capoAtTick } from "./doc.js";
import { isBlackKey } from "./pitch.js";
import type { EdDoc, EdNote, IntoKind, ModifierKey } from "./types.js";

/** The earlier-starting note on the same string closest before `note` (searching back across bars). */
export function previousOnString(doc: EdDoc, note: EdNote): EdNote | undefined {
  let best: EdNote | undefined;
  for (const n of doc.notes) {
    if (n.string !== note.string || n.id === note.id || n.startTick >= note.startTick) continue;
    if (!best || n.startTick > best.startTick) best = n;
  }
  return best;
}

/** Why `into` is not allowed on `note` given its string's previous note, or null when it is fine. */
export function intoProblem(prev: EdNote | undefined, note: EdNote, into: IntoKind): string | null {
  if (into.kind === "none") return null;
  if (into.kind === "bend") {
    const s = into.semitones;
    if (!(s >= 0 && s <= 4 && Number.isInteger(s * 2))) return "A bend is 0 to 4 semitones, in steps of 0.5.";
    return null;
  }
  if (into.kind === "hammer") return null;
  if (!prev) return into.kind === "pull" ? "A pull-off needs an earlier note on this string." : "A slide needs an earlier note on this string.";
  if (into.kind === "pull" && note.fret >= prev.fret) return `A pull-off goes to a lower fret than the previous note on this string (fret ${prev.fret}).`;
  if (into.kind === "slide" && note.fret === prev.fret) return `A slide goes to a different fret than the previous note on this string (fret ${prev.fret}).`;
  return null;
}

/** Why `into` can't be set on this note (reason for a disabled button), or null when valid. */
export function checkInto(doc: EdDoc, id: number, into: IntoKind): string | null {
  const note = doc.notes.find((n) => n.id === id);
  if (!note) return "That note no longer exists.";
  if (into.kind !== "none" && note.meta.slideIn) return "Slide in can't be combined with a hammer-on, pull-off, slide or bend. Turn it off first.";
  return intoProblem(previousOnString(doc, note), note, into);
}

/** Why a modifier can't be switched on for this note, or null. */
export function checkModifier(doc: EdDoc, id: number, key: ModifierKey): string | null {
  const note = doc.notes.find((n) => n.id === id);
  if (!note) return "That note no longer exists.";
  if (key === "slideIn" && note.meta.connection) return "Slide in can't be combined with a hammer-on, pull-off, slide or bend.";
  if (key === "flat" && !isBlackKey(soundingMidi(note.string, note.fret, capoAtTick(doc, note.startTick)))) return "Only black-key notes can be spelled as a flat.";
  return null;
}

/**
 * Drops techniques that an edit made invalid (a pull-off whose previous fret is no longer higher,
 * a flat on a note that is no longer a black key). Returns the same doc when nothing changed.
 */
export function repairTechniques(doc: EdDoc): { doc: EdDoc; dropped: number } {
  let dropped = 0;
  const notes = doc.notes.map((n) => {
    let meta = n.meta;
    const conn = meta.connection;
    if (conn && (conn.kind === "pull" || conn.kind === "slide") && intoProblem(previousOnString(doc, n), n, { kind: conn.kind })) {
      meta = { ...meta };
      delete meta.connection;
      dropped++;
    }
    if (meta.flat && !isBlackKey(soundingMidi(n.string, n.fret, capoAtTick(doc, n.startTick)))) {
      meta = { ...meta };
      delete meta.flat;
      dropped++;
    }
    return meta === n.meta ? n : { ...n, meta };
  });
  return dropped === 0 ? { doc, dropped } : { doc: { ...doc, notes }, dropped };
}
