// Pure editing operations on an EdDoc (specs/5-11-piano-roll.md 3.3-3.6). Each returns an OpResult with
// a new doc; the input is never changed.

import type { NoteMeta, StringNumber, TimeSignature } from "../model/index.js";
import { soundingMidi } from "../notation/index.js";
import { parseYouTubeId } from "../songFormat/youtube.js";
import {
  barIndexOf,
  barLengthTicks,
  capoAtTick,
  compareNotes,
  makeBars,
  withBars,
} from "./doc.js";
import { maxFret, noteMidi } from "./pitch.js";
import { MIN_CUT_TICKS, MIN_NOTE_TICKS } from "./snap.js";
import { chooseString, previousNote } from "./strings.js";
import { checkInto, checkModifier, repairTechniques } from "./techniques.js";
import type { Clip, EdDoc, EdNote, EdSection, IntoKind, ModifierKey, OpResult } from "./types.js";

function refuse(doc: EdDoc, message: string): OpResult {
  return { doc, refused: true, message };
}

/** Sorts notes, drops techniques that stopped applying, and builds the result. */
function finish(doc: EdDoc, ids: number[], messages: string[] = []): OpResult {
  const len = barLengthTicks(doc);
  const end = doc.notes.reduce((m, n) => Math.max(m, n.startTick + n.durationTicks), 0);
  // A note may ring past its bar, so the doc keeps enough bars to hold every note to its end.
  const sorted = { ...withBars(doc, Math.ceil(end / len)), notes: [...doc.notes].sort(compareNotes) };
  const fixed = repairTechniques(sorted);
  if (fixed.dropped > 0) messages.push(`Removed ${fixed.dropped} technique${fixed.dropped === 1 ? "" : "s"} that no longer apply.`);
  const out: OpResult = { doc: fixed.doc, ids };
  if (messages.length > 0) out.message = messages.join(" ");
  return out;
}

function barEnd(doc: EdDoc, startTick: number): number {
  const len = barLengthTicks(doc);
  return (Math.floor(startTick / len) + 1) * len;
}

function pick(doc: EdDoc, ids: readonly number[]): EdNote[] {
  const set = new Set(ids);
  return doc.notes.filter((n) => set.has(n.id));
}

function mapNotes(doc: EdDoc, ids: readonly number[], fn: (n: EdNote) => EdNote): EdDoc {
  const set = new Set(ids);
  return { ...doc, notes: doc.notes.map((n) => (set.has(n.id) ? fn(n) : n)) };
}

// ---------------------------------------------------------------- placing

interface Spec {
  id: number;
  startTick: number;
  midi: number;
  preferString?: StringNumber;
  nearFret?: number;
  durationTicks: number;
  offsetMs: number;
  meta: NoteMeta;
}

type Placed = { ok: true; notes: EdNote[]; conflict: boolean } | { ok: false; message: string };

/** Turns specs into notes: picks strings among those free at each start. */
function place(doc: EdDoc, rest: readonly EdNote[], specs: Spec[]): Placed {
  const taken = new Map<number, Set<number>>();
  const use = (tick: number, s: number) => {
    let set = taken.get(tick);
    if (!set) taken.set(tick, (set = new Set()));
    set.add(s);
  };
  for (const n of rest) use(n.startTick, n.string);
  const out: EdNote[] = [];
  let conflict = false;
  const ordered = [...specs].sort((a, b) => a.startTick - b.startTick || (a.preferString ?? 0) - (b.preferString ?? 0));
  for (const s of ordered) {
    const capo = capoAtTick(doc, s.startTick);
    const choice = chooseString(s.midi, capo, taken.get(s.startTick) ?? new Set(), { preferString: s.preferString, nearFret: s.nearFret });
    if (!choice) return { ok: false, message: "That pitch is out of the guitar's range." };
    if (choice.conflict) conflict = true;
    use(s.startTick, choice.string);
    out.push({
      id: s.id,
      string: choice.string,
      fret: choice.fret,
      startTick: s.startTick,
      durationTicks: Math.max(1, s.durationTicks),
      offsetMs: s.offsetMs,
      meta: structuredClone(s.meta),
    });
  }
  return { ok: true, notes: out, conflict };
}

function placeMessages(p: Extract<Placed, { ok: true }>): string[] {
  const m: string[] = [];
  if (p.conflict) m.push("No free string for this note.");
  return m;
}

// ---------------------------------------------------------------- notes

export interface NewNote {
  startTick: number;
  /** Sounding pitch. */
  midi: number;
  durationTicks: number;
  /** Strings view: draw on this lane. Otherwise chosen automatically. */
  string?: StringNumber;
}

/** Adds a note (bars are added when it starts past the last bar). */
export function addNote(doc: EdDoc, note: NewNote): OpResult {
  if (note.startTick < 0 || note.durationTicks < 1) return refuse(doc, "That position is not valid.");
  const work = withBars(doc, barIndexOf(doc, note.startTick) + 1);
  const prev = previousNote(work, note.startTick);
  const p = place(work, work.notes, [
    {
      id: work.nextId,
      startTick: note.startTick,
      midi: note.midi,
      preferString: note.string,
      nearFret: note.string === undefined ? prev?.fret : undefined,
      durationTicks: note.durationTicks,
      offsetMs: 0,
      meta: {},
    },
  ]);
  if (!p.ok) return refuse(doc, p.message);
  return finish({ ...work, notes: [...work.notes, ...p.notes], nextId: work.nextId + 1 }, [work.nextId], placeMessages(p));
}

export function deleteNotes(doc: EdDoc, ids: readonly number[]): OpResult {
  const set = new Set(ids);
  if (!doc.notes.some((n) => set.has(n.id))) return refuse(doc, "Nothing selected.");
  return finish({ ...doc, notes: doc.notes.filter((n) => !set.has(n.id)) }, []);
}

/**
 * Moves notes by whole ticks (already snapped by the caller) and semitones. The pitch is kept
 * relative to the new capo; strings are reassigned (current string first). Notes keep their length
 * when they cross a bar line. Refused when a pitch leaves the guitar's range.
 */
export function moveNotes(doc: EdDoc, ids: readonly number[], d: { dTicks?: number; dSemis?: number }): OpResult {
  const sel = pick(doc, ids);
  if (sel.length === 0) return refuse(doc, "Nothing selected.");
  const dS = Math.round(d.dSemis ?? 0);
  const dT = Math.max(Math.round(d.dTicks ?? 0), -Math.min(...sel.map((n) => n.startTick)));
  const selIds = new Set(sel.map((n) => n.id));
  const work = withBars(doc, barIndexOf(doc, Math.max(...sel.map((n) => n.startTick)) + dT) + 1);
  const rest = work.notes.filter((n) => !selIds.has(n.id));
  const p = place(
    work,
    rest,
    sel.map((n) => ({
      id: n.id,
      startTick: n.startTick + dT,
      midi: noteMidi(doc, n) + dS,
      preferString: n.string,
      durationTicks: n.durationTicks,
      offsetMs: n.offsetMs,
      meta: n.meta,
    })),
  );
  if (!p.ok) return refuse(doc, p.message);
  const same = p.notes.every((m) => {
    const o = doc.notes.find((x) => x.id === m.id)!;
    return o.startTick === m.startTick && o.string === m.string && o.fret === m.fret && o.durationTicks === m.durationTicks;
  });
  if (same) return { doc, ids: [...selIds] };
  return finish({ ...work, notes: [...rest, ...p.notes] }, [...selIds], placeMessages(p));
}

/** Up or down by octaves (+1/-1). */
export function transposeOctave(doc: EdDoc, ids: readonly number[], octaves: number): OpResult {
  return moveNotes(doc, ids, { dSemis: 12 * octaves });
}

/** Moves each note `dStrings` lanes (positive = toward the bass strings) at the same pitch. All or nothing. */
export function shiftStrings(doc: EdDoc, ids: readonly number[], dStrings: number): OpResult {
  const sel = pick(doc, ids);
  if (sel.length === 0) return refuse(doc, "Nothing selected.");
  if (dStrings === 0) return { doc, ids: sel.map((n) => n.id) };
  const selIds = new Set(sel.map((n) => n.id));
  const used = new Set(doc.notes.filter((n) => !selIds.has(n.id)).map((n) => `${n.startTick}:${n.string}`));
  const moved = new Map<number, EdNote>();
  for (const n of sel) {
    const s = n.string + dStrings;
    if (s < 1 || s > 6) return refuse(doc, "There is no string there.");
    const capo = capoAtTick(doc, n.startTick);
    const fret = soundingMidi(n.string, n.fret, capo) - soundingMidi(s as StringNumber, 0, capo);
    if (fret < 0 || fret > maxFret(capo)) return refuse(doc, `That pitch would need fret ${fret}, outside 0 to ${maxFret(capo)}.`);
    if (used.has(`${n.startTick}:${s}`)) return refuse(doc, "That string is already used at this moment.");
    used.add(`${n.startTick}:${s}`);
    moved.set(n.id, { ...n, string: s as StringNumber, fret });
  }
  return finish({ ...doc, notes: doc.notes.map((n) => moved.get(n.id) ?? n) }, [...selIds]);
}

/** One note to a given string, same pitch (Strings view drag, "Play it on" buttons). */
export function moveToString(doc: EdDoc, id: number, string: StringNumber): OpResult {
  const n = doc.notes.find((x) => x.id === id);
  if (!n) return refuse(doc, "Nothing selected.");
  return shiftStrings(doc, [id], string - n.string);
}

// ---------------------------------------------------------------- lengths and timing

/** Grows or shrinks lengths by `dTicks` (snapped by the caller). Minimum 1/64; a note may grow past its bar. */
export function resizeNotes(doc: EdDoc, ids: readonly number[], dTicks: number): OpResult {
  const sel = pick(doc, ids);
  if (sel.length === 0) return refuse(doc, "Nothing selected.");
  const next = mapNotes(doc, ids, (n) => {
    return { ...n, durationTicks: Math.max(MIN_NOTE_TICKS, n.durationTicks + Math.round(dTicks)) };
  });
  return finish(next, sel.map((n) => n.id));
}

/** Sets an exact length (use `lengthTicks()`); may pass the bar end. */
export function setLength(doc: EdDoc, ids: readonly number[], ticks: number): OpResult {
  const sel = pick(doc, ids);
  if (sel.length === 0 || !(ticks >= 1)) return refuse(doc, "Nothing selected.");
  const next = mapNotes(doc, ids, (n) => ({ ...n, durationTicks: Math.round(ticks) }));
  return finish(next, sel.map((n) => n.id));
}

/** Stretches each note to the next note's start (any string, even in a later bar), or to the end of its bar when none follows. */
export function ringUntilNext(doc: EdDoc, ids: readonly number[]): OpResult {
  const sel = pick(doc, ids);
  if (sel.length === 0) return refuse(doc, "Nothing selected.");
  const next = mapNotes(doc, ids, (n) => {
    let end = Infinity;
    for (const o of doc.notes) if (o.startTick > n.startTick && o.startTick < end) end = o.startTick;
    if (end === Infinity) end = barEnd(doc, n.startTick);
    return { ...n, durationTicks: end - n.startTick };
  });
  return finish(next, sel.map((n) => n.id));
}

/** Halves each note, but never below 1/32 (shorter notes are left alone). */
export function cutShort(doc: EdDoc, ids: readonly number[]): OpResult {
  const sel = pick(doc, ids);
  if (sel.length === 0) return refuse(doc, "Nothing selected.");
  const next = mapNotes(doc, ids, (n) => ({
    ...n,
    durationTicks: n.durationTicks <= MIN_CUT_TICKS ? n.durationTicks : Math.max(MIN_CUT_TICKS, Math.round(n.durationTicks / 2)),
  }));
  return finish(next, sel.map((n) => n.id));
}

/** Fine timing in ms, clamped to -500..500. */
export function setOffsetMs(doc: EdDoc, ids: readonly number[], ms: number): OpResult {
  const sel = pick(doc, ids);
  if (sel.length === 0) return refuse(doc, "Nothing selected.");
  const v = Math.max(-500, Math.min(500, Math.round(ms)));
  return finish(mapNotes(doc, ids, (n) => ({ ...n, offsetMs: v })), sel.map((n) => n.id));
}

// ---------------------------------------------------------------- techniques

/**
 * Sets how the notes are reached from the previous note on their string. With several notes,
 * the valid ones change; refused (with the first reason) when none can.
 */
export function setInto(doc: EdDoc, ids: readonly number[], into: IntoKind): OpResult {
  const sel = pick(doc, ids);
  if (sel.length === 0) return refuse(doc, "Nothing selected.");
  const ok = new Set<number>();
  let reason: string | null = null;
  for (const n of sel) {
    const r = checkInto(doc, n.id, into);
    if (r === null) ok.add(n.id);
    else reason ??= r;
  }
  if (ok.size === 0) return refuse(doc, reason ?? "Not possible.");
  const next = mapNotes(doc, [...ok], (n) => {
    const meta = { ...n.meta };
    if (into.kind === "none") delete meta.connection;
    else if (into.kind === "bend") meta.connection = { kind: "bend", semitones: into.semitones };
    else meta.connection = { kind: into.kind };
    return { ...n, meta };
  });
  return finish(next, [...ok], ok.size < sel.length && reason ? [`Skipped some notes: ${reason}`] : []);
}

/** Switches a modifier on (or off when every selected note already has it). Flat only on black keys. */
export function toggleModifier(doc: EdDoc, ids: readonly number[], key: ModifierKey): OpResult {
  const sel = pick(doc, ids);
  if (sel.length === 0) return refuse(doc, "Nothing selected.");
  const turnOff = sel.every((n) => n.meta[key]);
  const ok = turnOff ? sel.map((n) => n.id) : sel.filter((n) => checkModifier(doc, n.id, key) === null).map((n) => n.id);
  if (ok.length === 0) return refuse(doc, checkModifier(doc, sel[0]!.id, key) ?? "Not possible.");
  const next = mapNotes(doc, ok, (n) => {
    const meta = { ...n.meta };
    if (turnOff) delete meta[key];
    else meta[key] = true;
    return { ...n, meta };
  });
  return finish(next, ok);
}

// ---------------------------------------------------------------- copy, paste, duplicate

export function copyNotes(doc: EdDoc, ids: readonly number[]): Clip {
  const sel = pick(doc, ids);
  const first = sel.length ? Math.min(...sel.map((n) => n.startTick)) : 0;
  return {
    notes: sel.map((n) => ({
      dTick: n.startTick - first,
      string: n.string,
      midi: noteMidi(doc, n),
      durationTicks: n.durationTicks,
      offsetMs: n.offsetMs,
      meta: structuredClone(n.meta),
    })),
  };
}

/** Pastes a clip so its first note starts at `tick`. New notes are selected via `ids`. */
export function pasteNotes(doc: EdDoc, clip: Clip, tick: number): OpResult {
  if (clip.notes.length === 0) return refuse(doc, "Nothing to paste.");
  const start = Math.max(0, Math.round(tick));
  const last = Math.max(...clip.notes.map((n) => n.dTick));
  const work = withBars(doc, barIndexOf(doc, start + last) + 1);
  let id = work.nextId;
  const specs: Spec[] = clip.notes.map((n) => ({
    id: id++,
    startTick: start + n.dTick,
    midi: n.midi,
    preferString: n.string,
    durationTicks: n.durationTicks,
    offsetMs: n.offsetMs,
    meta: n.meta,
  }));
  const p = place(work, work.notes, specs);
  if (!p.ok) return refuse(doc, p.message);
  return finish({ ...work, notes: [...work.notes, ...p.notes], nextId: id }, p.notes.map((n) => n.id), placeMessages(p));
}

/**
 * Copies bars `first..last` (0-based, inclusive) into the bars right after them, replacing what is
 * there and adding bars when needed. New notes are returned in `ids`.
 */
export function duplicateBars(doc: EdDoc, barIndexes: readonly number[]): OpResult {
  const valid = barIndexes.filter((b) => b >= 0 && b < doc.bars.length);
  if (valid.length === 0) return refuse(doc, "Select a bar first.");
  const first = Math.min(...valid);
  const last = Math.max(...valid);
  const count = last - first + 1;
  const len = barLengthTicks(doc);
  const work = withBars(doc, last + 1 + count);
  const destFrom = (last + 1) * len;
  const destTo = destFrom + count * len;
  const rest = work.notes.filter((n) => n.startTick < destFrom || n.startTick >= destTo);
  let id = work.nextId;
  const src = work.notes.filter((n) => n.startTick >= first * len && n.startTick < (last + 1) * len);
  const shift = count * len;
  const specs: Spec[] = src.map((n) => ({
    id: id++,
    startTick: n.startTick + shift,
    midi: noteMidi(work, n),
    preferString: n.string,
    durationTicks: n.durationTicks,
    offsetMs: n.offsetMs,
    meta: n.meta,
  }));
  const p = place(work, rest, specs);
  if (!p.ok) return refuse(doc, p.message);
  return finish({ ...work, notes: [...rest, ...p.notes], nextId: id }, p.notes.map((n) => n.id), placeMessages(p));
}

// ---------------------------------------------------------------- bars

export function addBars(doc: EdDoc, count: number): OpResult {
  const n = Math.floor(count);
  if (n < 1) return refuse(doc, "Add at least one bar.");
  return { doc: withBars(doc, doc.bars.length + n) };
}

/** Removes bars from the end (at least one stays), together with the notes in them. */
export function removeLastBars(doc: EdDoc, count: number): OpResult {
  const keep = Math.max(1, doc.bars.length - Math.floor(count));
  if (keep === doc.bars.length) return refuse(doc, "The song needs at least one bar.");
  const cut = keep * barLengthTicks(doc);
  return finish(
    {
      ...doc,
      bars: doc.bars.slice(0, keep),
      sections: doc.sections.filter((s, i) => i === 0 || s.startBar < keep),
      notes: doc.notes.filter((n) => n.startTick < cut),
    },
    [],
  );
}

// ---------------------------------------------------------------- sections

function cleanName(name: string): string {
  return name.replace(/[\]\r\n]/g, "").trim();
}

/** Starts a new section at bar `atBar` (0-based, not the first bar). */
export function addSection(doc: EdDoc, name: string, atBar: number): OpResult {
  const clean = cleanName(name);
  if (!clean) return refuse(doc, "A section needs a name.");
  if (atBar < 1 || atBar >= doc.bars.length) return refuse(doc, "A new section starts at bar 2 or later, inside the song.");
  if (doc.sections.some((s) => s.startBar === atBar)) return refuse(doc, "A section already starts at that bar.");
  const sections = [...doc.sections, { name: clean, startBar: atBar }].sort((a, b) => a.startBar - b.startBar);
  return finish({ ...doc, sections }, []);
}

/** Removes a section (its bars join the one before). The first section can't be removed. */
export function removeSection(doc: EdDoc, index: number): OpResult {
  if (index <= 0 || index >= doc.sections.length) return refuse(doc, "The first section can't be removed; rename it instead.");
  return finish({ ...doc, sections: doc.sections.filter((_, i) => i !== index) }, []);
}

export function renameSection(doc: EdDoc, index: number, name: string): OpResult {
  const clean = cleanName(name);
  if (!doc.sections[index]) return refuse(doc, "No such section.");
  if (!clean) return refuse(doc, "A section needs a name.");
  return finish({ ...doc, sections: doc.sections.map((s, i) => (i === index ? { ...s, name: clean } : s)) }, []);
}

/** Overrides for one section; `null` clears an override. Frets keep their numbers when the capo changes. */
export function setSection(doc: EdDoc, index: number, patch: { bpm?: number | null; unit?: number | null; capo?: number | null }): OpResult {
  const sec = doc.sections[index];
  if (!sec) return refuse(doc, "No such section.");
  const next: EdSection = { ...sec };
  if (patch.bpm !== undefined) {
    if (patch.bpm === null) delete next.bpm;
    else if (patch.bpm > 0 && patch.bpm <= 999) next.bpm = patch.bpm;
    else return refuse(doc, "Tempo must be between 1 and 999.");
  }
  if (patch.unit !== undefined) {
    if (patch.unit === null) delete next.unit;
    else if (Number.isInteger(patch.unit) && patch.unit >= 1 && barLengthTicks(doc) % patch.unit === 0) next.unit = patch.unit;
    else return refuse(doc, "That grid doesn't divide the bar.");
  }
  if (patch.capo !== undefined) {
    if (patch.capo === null) delete next.capo;
    else if (Number.isInteger(patch.capo) && patch.capo >= 0 && patch.capo <= 12) next.capo = patch.capo;
    else return refuse(doc, "Capo must be 0 to 12.");
  }
  return finish({ ...doc, sections: doc.sections.map((s, i) => (i === index ? next : s)) }, []);
}

// ---------------------------------------------------------------- header

export interface HeaderPatch {
  title?: string;
  /** Empty or null removes the artist. */
  artist?: string | null;
  bpm?: number;
  /** null or 0 = no capo. */
  capo?: number | null;
  unit?: number;
}

export function setHeader(doc: EdDoc, patch: HeaderPatch): OpResult {
  const header = { ...doc.header };
  if (patch.title !== undefined) header.title = patch.title;
  if (patch.artist !== undefined) {
    const a = patch.artist?.trim();
    if (a) header.artist = a;
    else delete header.artist;
  }
  if (patch.bpm !== undefined) {
    if (!(patch.bpm > 0 && patch.bpm <= 999)) return refuse(doc, "Tempo must be between 1 and 999.");
    header.bpm = patch.bpm;
  }
  if (patch.capo !== undefined) {
    const c = patch.capo ?? 0;
    if (!Number.isInteger(c) || c < 0 || c > 12) return refuse(doc, "Capo must be 0 to 12.");
    if (c === 0) delete header.capo;
    else header.capo = c;
  }
  if (patch.unit !== undefined) {
    if (!Number.isInteger(patch.unit) || patch.unit < 1 || barLengthTicks(doc) % patch.unit !== 0) return refuse(doc, "That grid doesn't divide the bar.");
    header.unit = patch.unit;
  }
  return finish({ ...doc, header }, []);
}

/** Changes the time signature. Notes keep their ticks and lengths; bars are added when a note now runs past the last one. */
export function setTime(doc: EdDoc, time: TimeSignature): OpResult {
  if (![1, 2, 4, 8, 16, 32].includes(time.denominator) || !Number.isInteger(time.numerator) || time.numerator < 1 || time.numerator > 32) {
    return refuse(doc, "That time signature is not supported.");
  }
  const oldTotal = doc.bars.length * barLengthTicks(doc);
  const probe: EdDoc = { ...doc, header: { ...doc.header, time } };
  const len = barLengthTicks(probe);
  const count = Math.max(1, Math.ceil(oldTotal / len));
  const fits = (u: number) => Number.isInteger(u) && u >= 1 && len % u === 0;
  const unit = fits(doc.header.unit) ? doc.header.unit : fits(8) ? 8 : time.numerator;
  const sections: EdSection[] = [];
  for (const s of doc.sections) {
    if (s.startBar >= count || sections.some((x) => x.startBar === s.startBar)) continue;
    const c = { ...s };
    if (c.unit !== undefined && !fits(c.unit)) delete c.unit;
    sections.push(c);
  }
  const header = { ...doc.header, time, unit };
  const next: EdDoc = { ...doc, header, sections, bars: makeBars(count, len) };
  return finish(next, []);
}

/** Sets or removes the reference video. Resets the bar 1 offset to 0 when the link changes. */
export function setYoutube(doc: EdDoc, url: string | null): OpResult {
  const header = { ...doc.header };
  const t = url?.trim();
  if (!t) {
    delete header.youtube;
    return finish({ ...doc, header }, []);
  }
  const videoId = parseYouTubeId(t);
  if (!videoId) return refuse(doc, "That doesn't look like a valid YouTube link.");
  header.youtube = { url: t, videoId, offsetSec: doc.header.youtube?.videoId === videoId ? doc.header.youtube.offsetSec : 0 };
  return finish({ ...doc, header }, []);
}

/** Moves the "bar 1 is here" flag (seconds into the video, >= 0). Needs a video. */
export function setVideoOffset(doc: EdDoc, offsetSec: number): OpResult {
  if (!doc.header.youtube) return refuse(doc, "Add a YouTube link first.");
  const v = Math.max(0, Math.round(offsetSec * 1000) / 1000);
  return finish({ ...doc, header: { ...doc.header, youtube: { ...doc.header.youtube, offsetSec: v } } }, []);
}
