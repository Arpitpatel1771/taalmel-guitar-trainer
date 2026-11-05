import { describe, expect, it } from "vitest";
import {
  addBars, addNote, addSection, checkInto, copyNotes, createHistory, cutShort, deleteNotes, duplicateBars, emptyDoc, findConflicts,
  moveNotes, moveToString, noteMidi, pasteNotes, positionsFor, pushHistory, redo, removeLastBars, removeSection, renameSection, resizeNotes,
  ringUntilNext, setHeader, setInto, setLength, setOffsetMs, setSection, setTime, setYoutube, shiftStrings, toggleModifier,
  transposeOctave, undo, canUndo, canRedo, HISTORY_CAP, SNAP_TICKS, snapTick, lengthTicks, positionText, playOptions, placeNextAt,
  addAtPlayhead, noteName,
} from "./index.js";
import type { EdDoc } from "./index.js";

function base(): EdDoc {
  return emptyDoc({ title: "T" });
}
function add(doc: EdDoc, tick: number, midi: number, dur = 480, string?: 1 | 2 | 3 | 4 | 5 | 6) {
  const r = addNote(doc, { startTick: tick, midi, durationTicks: dur, string });
  expect(r.refused, r.message).toBeFalsy();
  return r;
}

describe("snapping", () => {
  it("snaps relative to the bar start", () => {
    expect(snapTick(3840 + 250, SNAP_TICKS["1/16"], 3840)).toBe(3840 + 240);
    expect(snapTick(3840 + 170, SNAP_TICKS["1/16T"], 3840)).toBe(3840 + 160);
    expect(snapTick(500, SNAP_TICKS["1/8T"], 3840)).toBe(640);
    expect(snapTick(100, SNAP_TICKS["1/4"], 3840)).toBe(0);
    expect(snapTick(70, SNAP_TICKS.off, 3840)).toBe(60);
  });
  it("lengths", () => {
    expect(lengthTicks("1/8")).toBe(480);
    expect(lengthTicks("1/4", true)).toBe(1440);
    expect(lengthTicks("1")).toBe(3840);
  });
});

describe("pitch and strings", () => {
  it("positionsFor respects the capo and fret range", () => {
    expect(positionsFor(64, 0)[0]).toEqual({ string: 1, fret: 0 });
    expect(positionsFor(64, 0).length).toBe(6);
    expect(positionsFor(64, 2).every((p) => p.fret <= 22)).toBe(true);
    expect(positionsFor(30, 0)).toEqual([]);
    expect(positionsFor(64 + 24, 0)).toEqual([{ string: 1, fret: 24 }]);
    expect(positionsFor(64 + 24, 2)).toEqual([{ string: 1, fret: 22 }]);
    expect(positionsFor(64 + 25, 2)).toEqual([]);
  });
  it("new note with no context takes the lowest fret", () => {
    const d = add(base(), 0, 64).doc;
    expect(d.notes[0]).toMatchObject({ string: 1, fret: 0 });
  });
  it("new note stays near the previous note's fret", () => {
    let d = add(base(), 0, 64 + 7).doc; // fret 7 on string 1? lowest fret is string 1 fret 7
    d = add(d, 480, 64 + 5).doc;
    expect(d.notes[1]!.fret).toBe(5);
  });
  it("a chord goes on different strings", () => {
    let d = add(base(), 0, 64).doc;
    d = add(d, 0, 64).doc;
    expect(d.notes.map((n) => n.string)).toEqual([1, 2]);
    expect(d.notes[1]!.fret).toBe(5);
    expect(findConflicts(d)).toEqual([]);
  });
  it("reports a conflict when no string is free", () => {
    let d = base();
    const midi = 40; // only string 6 fret 0
    d = add(d, 0, midi).doc;
    const r = add(d, 0, midi);
    expect(r.message).toContain("No free string");
    expect(findConflicts(r.doc).length).toBe(2);
  });
  it("refuses a pitch off the guitar", () => {
    expect(addNote(base(), { startTick: 0, midi: 20, durationTicks: 480 }).refused).toBe(true);
  });
  it("moveToString keeps pitch and refuses bad frets or taken strings", () => {
    let d = add(base(), 0, 64).doc;
    const id = d.notes[0]!.id;
    const r = moveToString(d, id, 2);
    expect(r.doc.notes[0]).toMatchObject({ string: 2, fret: 5 });
    expect(noteMidi(r.doc, r.doc.notes[0]!)).toBe(64);
    expect(moveToString(d, id, 6).doc.notes[0]).toMatchObject({ string: 6, fret: 24 });
    expect(moveToString(r.doc, r.doc.notes[0]!.id, 6).refused).toBeFalsy();
    d = add(r.doc, 0, 64, 480, 1).doc;
    expect(moveToString(d, d.notes.find((n) => n.string === 1)!.id, 2).refused).toBe(true);
    expect(shiftStrings(d, [d.notes[0]!.id], -5).refused).toBe(true);
  });
  it("playOptions marks taken strings", () => {
    let d = add(base(), 0, 64).doc;
    d = add(d, 0, 64).doc; // second note on string 2
    const opts = playOptions(d, d.notes[1]!.id);
    expect(opts.find((o) => o.string === 1)!.taken).toBe(true);
    expect(opts.find((o) => o.string === 2)!.current).toBe(true);
  });
  it("soundingName helper works", () => {
    expect(noteName(73)).toBe("C#5");
    expect(noteName(73, true)).toBe("Db5");
  });
});

describe("move", () => {
  it("moves in time and keeps the string", () => {
    const d = add(base(), 0, 64).doc;
    const r = moveNotes(d, [d.notes[0]!.id], { dTicks: 480 });
    expect(r.doc.notes[0]).toMatchObject({ startTick: 480, string: 1, fret: 0 });
  });
  it("moves by semitones and reassigns strings", () => {
    const d = add(base(), 0, 64).doc;
    const r = moveNotes(d, [d.notes[0]!.id], { dSemis: -1 });
    expect(r.doc.notes[0]).toMatchObject({ string: 2, fret: 4 });
  });
  it("moves a selection together", () => {
    let d = add(base(), 0, 64).doc;
    d = add(d, 480, 67).doc;
    const r = moveNotes(d, d.notes.map((n) => n.id), { dTicks: 480, dSemis: 2 });
    expect(r.doc.notes.map((n) => n.startTick)).toEqual([480, 960]);
    expect(r.doc.notes.map((n) => noteMidi(r.doc, n))).toEqual([66, 69]);
  });
  it("dodges a taken string", () => {
    let d = add(base(), 0, 64).doc; // string 1
    d = add(d, 480, 64).doc;
    const r = moveNotes(d, [d.notes[1]!.id], { dTicks: -480 });
    expect(r.doc.notes.map((n) => n.string)).toEqual([1, 2]);
    expect(findConflicts(r.doc)).toEqual([]);
  });
  it("keeps the full length across a bar line", () => {
    const d = add(base(), 0, 64, 960).doc;
    const r = moveNotes(d, [d.notes[0]!.id], { dTicks: 3600 });
    expect(r.doc.notes[0]!.durationTicks).toBe(960);
    expect(r.doc.bars).toHaveLength(base().bars.length);
    expect(r.message).toBeUndefined();
  });
  it("adds bars when moved past the end", () => {
    const d = add(base(), 0, 64).doc;
    const r = moveNotes(d, [d.notes[0]!.id], { dTicks: 3840 * 5 });
    expect(r.doc.bars.length).toBe(6);
  });
  it("won't move before tick 0 and refuses out-of-range pitches", () => {
    const d = add(base(), 480, 64).doc;
    expect(moveNotes(d, [d.notes[0]!.id], { dTicks: -5000 }).doc.notes[0]!.startTick).toBe(0);
    expect(moveNotes(d, [d.notes[0]!.id], { dSemis: 40 }).refused).toBe(true);
  });
  it("uses the capo of the new section", () => {
    let d = setHeader(add(base(), 0, 64).doc, {}).doc;
    d = addBars(d, 4).doc;
    d = addSection(d, "B", 4).doc;
    d = setSection(d, 1, { capo: 2 }).doc;
    const r = moveNotes(d, [d.notes[0]!.id], { dTicks: 3840 * 4 });
    expect(noteMidi(r.doc, r.doc.notes[0]!)).toBe(64);
    expect(r.doc.notes[0]!.string).toBe(2);
  });
  it("transposes by octave", () => {
    const d = add(base(), 0, 52).doc;
    const r = transposeOctave(d, [d.notes[0]!.id], 1);
    expect(noteMidi(r.doc, r.doc.notes[0]!)).toBe(64);
    expect(transposeOctave(d, [d.notes[0]!.id], -2).refused).toBe(true);
  });
});

describe("lengths and timing", () => {
  it("resizes with a minimum and no bar-end limit", () => {
    const d = add(base(), 3600, 64, 120).doc;
    const id = d.notes[0]!.id;
    const r = resizeNotes(d, [id], 5000).doc;
    expect(r.notes).toHaveLength(1);
    expect(r.notes[0]!.durationTicks).toBe(5120);
    expect(r.bars.length).toBeGreaterThanOrEqual(3);
    expect(resizeNotes(d, [id], -500).doc.notes[0]!.durationTicks).toBe(60);
  });
  it("set length may pass the bar end", () => {
    const d = add(base(), 3600, 64, 120).doc;
    const r = setLength(d, [d.notes[0]!.id], 960);
    expect(r.doc.notes[0]!.durationTicks).toBe(960);
  });
  it("adds bars when a length runs past the last one", () => {
    const d = add(base(), 3840 * 3 + 3600, 64, 120).doc;
    const r = setLength(d, [d.notes[0]!.id], 960);
    expect(r.doc.bars).toHaveLength(5);
    expect(r.doc.notes).toHaveLength(1);
  });
  it("ring until next stops at the next start or the bar end", () => {
    let d = add(base(), 0, 64, 120).doc;
    d = add(d, 960, 66, 120).doc;
    const r = ringUntilNext(d, d.notes.map((n) => n.id));
    expect(r.doc.notes.map((n) => n.durationTicks)).toEqual([960, 3840 - 960]);
  });
  it("cut short halves down to 1/32", () => {
    const d = add(base(), 0, 64, 960).doc;
    const id = d.notes[0]!.id;
    let r = cutShort(d, [id]).doc;
    expect(r.notes[0]!.durationTicks).toBe(480);
    r = cutShort(cutShort(r, [id]).doc, [id]).doc;
    expect(r.notes[0]!.durationTicks).toBe(120);
    expect(cutShort(r, [id]).doc.notes[0]!.durationTicks).toBe(120);
  });
  it("offsetMs is clamped", () => {
    const d = add(base(), 0, 64).doc;
    expect(setOffsetMs(d, [d.notes[0]!.id], 900).doc.notes[0]!.offsetMs).toBe(500);
    expect(setOffsetMs(d, [d.notes[0]!.id], -900).doc.notes[0]!.offsetMs).toBe(-500);
  });
});

describe("techniques", () => {
  function two(): EdDoc {
    let d = add(base(), 0, 64 + 5, 480, 1).doc; // 1S5
    d = add(d, 480, 64 + 3, 480, 1).doc; // 1S3
    return d;
  }
  it("pull needs a lower fret than the previous note", () => {
    const d = two();
    expect(checkInto(d, d.notes[1]!.id, { kind: "pull" })).toBeNull();
    expect(checkInto(d, d.notes[0]!.id, { kind: "pull" })).toMatch(/earlier note/);
    expect(setInto(d, [d.notes[0]!.id], { kind: "pull" }).refused).toBe(true);
    const r = setInto(d, [d.notes[1]!.id], { kind: "pull" });
    expect(r.doc.notes[1]!.meta.connection).toEqual({ kind: "pull" });
    expect(checkInto(d, d.notes[0]!.id, { kind: "hammer" })).toBeNull();
  });
  it("slide needs a different fret", () => {
    let d = two();
    d = moveNotes(d, [d.notes[1]!.id], { dSemis: 2 }).doc;
    expect(checkInto(d, d.notes[1]!.id, { kind: "slide" })).toMatch(/different fret/);
  });
  it("bend semitones are validated", () => {
    const d = two();
    expect(checkInto(d, d.notes[0]!.id, { kind: "bend", semitones: 2.5 })).toBeNull();
    expect(checkInto(d, d.notes[0]!.id, { kind: "bend", semitones: 4.5 })).not.toBeNull();
    expect(checkInto(d, d.notes[0]!.id, { kind: "bend", semitones: 0.3 })).not.toBeNull();
  });
  it("an edit that breaks a pull-off drops it", () => {
    let d = two();
    d = setInto(d, [d.notes[1]!.id], { kind: "pull" }).doc;
    const r = moveNotes(d, [d.notes[1]!.id], { dSemis: 4 });
    expect(r.doc.notes[1]!.meta.connection).toBeUndefined();
    expect(r.message).toMatch(/Removed 1 technique/);
  });
  it("none clears the connection; slide in can't combine", () => {
    let d = two();
    d = setInto(d, [d.notes[1]!.id], { kind: "hammer" }).doc;
    expect(setInto(d, [d.notes[1]!.id], { kind: "none" }).doc.notes[1]!.meta.connection).toBeUndefined();
    expect(toggleModifier(d, [d.notes[1]!.id], "slideIn").refused).toBe(true);
    const s = toggleModifier(two(), [two().notes[1]!.id], "slideIn").doc;
    expect(s.notes[1]!.meta.slideIn).toBe(true);
    expect(checkInto(s, s.notes[1]!.id, { kind: "hammer" })).toMatch(/Slide in/);
  });
  it("toggles modifiers on and off; flat only on black keys", () => {
    const d = add(base(), 0, 64).doc;
    const id = d.notes[0]!.id;
    const v = toggleModifier(d, [id], "vibrato").doc;
    expect(v.notes[0]!.meta.vibrato).toBe(true);
    expect(toggleModifier(v, [id], "vibrato").doc.notes[0]!.meta.vibrato).toBeUndefined();
    expect(toggleModifier(d, [id], "flat").refused).toBe(true);
    const black = add(base(), 0, 66).doc; // F#4
    expect(toggleModifier(black, [black.notes[0]!.id], "flat").doc.notes[0]!.meta.flat).toBe(true);
  });
  it("flat is dropped when the note moves to a natural", () => {
    const black = add(base(), 0, 66).doc;
    const f = toggleModifier(black, [black.notes[0]!.id], "flat").doc;
    expect(moveNotes(f, [f.notes[0]!.id], { dSemis: 1 }).doc.notes[0]!.meta.flat).toBeUndefined();
  });
});

describe("copy, paste, duplicate, bars, sections, header", () => {
  it("copies and pastes at a tick", () => {
    let d = add(base(), 0, 64).doc;
    d = add(d, 480, 67).doc;
    const clip = copyNotes(d, d.notes.map((n) => n.id));
    const r = pasteNotes(d, clip, 3840);
    expect(r.doc.notes.map((n) => n.startTick)).toEqual([0, 480, 3840, 4320]);
    expect(r.ids!.length).toBe(2);
    expect(pasteNotes(d, { notes: [] }, 0).refused).toBe(true);
  });
  it("paste past the end adds bars", () => {
    const d = add(base(), 0, 64).doc;
    expect(pasteNotes(d, copyNotes(d, [d.notes[0]!.id]), 3840 * 6).doc.bars.length).toBe(7);
  });
  it("duplicates bars into the next ones, adding bars", () => {
    let d = add(base(), 3840 * 3, 64).doc;
    const r = duplicateBars(d, [3]);
    expect(r.doc.bars.length).toBe(5);
    expect(r.doc.notes.map((n) => n.startTick)).toEqual([3840 * 3, 3840 * 4]);
    d = add(base(), 0, 64).doc;
    d = add(d, 3840, 60).doc;
    const two = duplicateBars(d, [0]);
    expect(two.doc.notes.map((n) => noteMidi(two.doc, n))).toEqual([64, 64]); // bar 2 replaced
    expect(duplicateBars(d, [0, 1]).doc.notes.length).toBe(4);
    expect(duplicateBars(d, []).refused).toBe(true);
  });
  it("add and remove bars", () => {
    let d = add(base(), 3840 * 3, 64).doc;
    d = addBars(d, 2).doc;
    expect(d.bars.length).toBe(6);
    const r = removeLastBars(d, 3);
    expect(r.doc.bars.length).toBe(3);
    expect(r.doc.notes.length).toBe(0);
    expect(removeLastBars(base(), 10).doc.bars.length).toBe(1);
  });
  it("sections", () => {
    let d = base();
    d = addSection(d, "Chorus", 2).doc;
    expect(addSection(d, "X", 2).refused).toBe(true);
    expect(addSection(d, "X", 0).refused).toBe(true);
    expect(addSection(d, "", 3).refused).toBe(true);
    d = renameSection(d, 1, "Verse ]").doc;
    expect(d.sections[1]!.name).toBe("Verse");
    d = setSection(d, 1, { bpm: 80, capo: 3, unit: 8 }).doc;
    expect(d.sections[1]).toMatchObject({ bpm: 80, capo: 3, unit: 8 });
    expect(setSection(d, 1, { unit: 7 }).refused).toBe(true);
    expect(setSection(d, 1, { capo: 13 }).refused).toBe(true);
    d = setSection(d, 1, { bpm: null, capo: null, unit: null }).doc;
    expect(d.sections[1]).toEqual({ name: "Verse", startBar: 2 });
    expect(removeSection(d, 0).refused).toBe(true);
    expect(removeSection(d, 1).doc.sections.length).toBe(1);
  });
  it("header fields", () => {
    let d = base();
    d = setHeader(d, { title: "Hi", artist: "Me", bpm: 90, capo: 2 }).doc;
    expect(d.header).toMatchObject({ title: "Hi", artist: "Me", bpm: 90, capo: 2 });
    d = setHeader(d, { artist: "", capo: 0 }).doc;
    expect(d.header.artist).toBeUndefined();
    expect(d.header.capo).toBeUndefined();
    expect(setHeader(d, { bpm: 0 }).refused).toBe(true);
    expect(setHeader(d, { capo: 14 }).refused).toBe(true);
    expect(setHeader(d, { unit: 7 }).refused).toBe(true);
  });
  it("time signature change keeps ticks and lengths", () => {
    let d = add(base(), 1920, 64, 1920).doc;
    const r = setTime(d, { numerator: 3, denominator: 4 });
    expect(r.doc.bars.length).toBe(6);
    expect(r.doc.notes[0]!.durationTicks).toBe(1920);
    expect(setTime(d, { numerator: 4, denominator: 3 }).refused).toBe(true);
    d = setTime(base(), { numerator: 6, denominator: 8 }).doc;
    expect(d.header.unit).toBe(16);
  });
  it("youtube link and offset", () => {
    let d = setYoutube(base(), "https://youtu.be/dQw4w9WgXcQ").doc;
    expect(d.header.youtube).toMatchObject({ videoId: "dQw4w9WgXcQ", offsetSec: 0 });
    expect(setYoutube(d, "nope").refused).toBe(true);
    expect(setYoutube(d, null).doc.header.youtube).toBeUndefined();
  });
  it("delete", () => {
    const d = add(base(), 0, 64).doc;
    expect(deleteNotes(d, [d.notes[0]!.id]).doc.notes.length).toBe(0);
    expect(deleteNotes(d, [999]).refused).toBe(true);
  });
});

describe("history, position, live", () => {
  it("undo and redo with a cap", () => {
    let h = createHistory(0);
    for (let i = 1; i <= HISTORY_CAP + 10; i++) h = pushHistory(h, i);
    expect(h.past.length).toBe(HISTORY_CAP);
    expect(pushHistory(h, h.present)).toBe(h);
    h = undo(h);
    expect(h.present).toBe(HISTORY_CAP + 9);
    expect(canRedo(h)).toBe(true);
    h = redo(h);
    expect(h.present).toBe(HISTORY_CAP + 10);
    h = pushHistory(undo(h), -1);
    expect(canRedo(h)).toBe(false);
    expect(canUndo(createHistory(1))).toBe(false);
    expect(undo(createHistory(1)).present).toBe(1);
  });
  it("position text", () => {
    const d = base();
    expect(positionText(d, 3840 * 2 + 960 + 240)).toBe("Bar 3, beat 2 + 1/16");
    expect(positionText(d, 0)).toBe("Bar 1, beat 1");
    expect(positionText(d, 320)).toBe("Bar 1, beat 1 + 1/12");
    expect(positionText(setTime(d, { numerator: 6, denominator: 8 }).doc, 480 * 4)).toBe("Bar 1, beat 5");
  });
  it("placeNextAt moves the next note to the tap", () => {
    let d = add(base(), 0, 64).doc;
    d = add(d, 480, 66).doc;
    d = add(d, 960, 68).doc;
    const r = placeNextAt(d, 300, SNAP_TICKS["1/16"]);
    expect(r.doc.notes.map((n) => n.startTick)).toEqual([0, 240, 960]);
    expect(r.ids).toEqual([d.notes[1]!.id]);
  });
  it("placeNextAt handles chords, exact hits and the end", () => {
    let d = add(base(), 960, 64).doc;
    d = add(d, 960, 64).doc;
    const moved = placeNextAt(d, 960, 240);
    expect(moved.doc.notes.map((n) => n.startTick)).toEqual([960, 960]);
    const later = placeNextAt(d, 600, 240);
    expect(later.doc.notes.map((n) => n.startTick)).toEqual([720, 720]);
    expect(new Set(later.doc.notes.map((n) => n.string)).size).toBe(2);
    expect(placeNextAt(d, 5000, 240).refused).toBe(true);
    expect(placeNextAt(d, 1200, 240, 400).doc.notes[0]!.startTick).toBe(1200);
  });
  it("addAtPlayhead snaps and extends", () => {
    const r = addAtPlayhead(base(), 3840 * 4 + 250, 64, 480, 240);
    expect(r.doc.notes[0]!.startTick).toBe(3840 * 4 + 240);
    expect(r.doc.bars.length).toBe(5);
  });
});
