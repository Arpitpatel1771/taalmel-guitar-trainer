import { describe, expect, it } from "vitest";
import { PPQ } from "../../model";
import { SNAP_TICKS, addNote, docFromTab, emptyDoc, noteMidi, type EdDoc } from "../../songEditor";
import { DEFAULT_ZOOM, KEY_W, LANE_H, MAX_ZOOM, applyDrag, drawSpan, fitZoom, gridHeight, hitTest, makeGeom, midiAtY, noteRect, notesInBox, rowTop, stringAtY, tickToX, xToTick } from "./rollGeometry";

const E4 = 64;
function docWith(...notes: { start: number; midi: number; len: number }[]): EdDoc {
  let doc = emptyDoc({ title: "T" });
  for (const n of notes) doc = addNote(doc, { startTick: n.start, midi: n.midi, durationTicks: n.len }).doc;
  return doc;
}

describe("roll geometry", () => {
  const g = makeGeom(16, 16, "pitch");

  it("maps ticks and pixels both ways", () => {
    expect(tickToX(g, PPQ / 4)).toBe(16);
    expect(xToTick(g, 16)).toBe(PPQ / 4);
    expect(KEY_W).toBe(60);
  });

  it("maps rows to pitches and lanes to strings", () => {
    expect(midiAtY(g, rowTop(g, E4) + 3)).toBe(E4);
    expect(midiAtY(g, -50)).toBe(88);
    expect(midiAtY(g, 99999)).toBe(40);
    expect(stringAtY(0)).toBe(1);
    expect(stringAtY(LANE_H * 5 + 1)).toBe(6);
    expect(stringAtY(99999)).toBe(6);
    expect(gridHeight(g)).toBe(49 * 16);
    expect(gridHeight(makeGeom(16, 16, "strings"))).toBe(6 * LANE_H);
  });

  it("finds the note under a point and its resize edge", () => {
    const doc = docWith({ start: 0, midi: E4, len: PPQ });
    const r = noteRect(g, doc, doc.notes[0]!);
    expect(hitTest(g, doc, r.x + 4, r.y + 3)).toEqual({ id: 1, zone: "body" });
    expect(hitTest(g, doc, r.x + r.w - 2, r.y + 3)).toEqual({ id: 1, zone: "resize" });
    expect(hitTest(g, doc, r.x + r.w + 20, r.y + 3)).toBeNull();
    expect(hitTest(g, doc, r.x + 4, r.y + 40)).toBeNull();
  });

  it("box selects every touched note", () => {
    const doc = docWith({ start: 0, midi: E4, len: PPQ }, { start: PPQ * 2, midi: E4 + 2, len: PPQ });
    const first = noteRect(g, doc, doc.notes[0]!);
    expect(notesInBox(g, doc, { x: 0, y: first.y - 2, w: 30, h: 6 })).toEqual([1]);
    expect(notesInBox(g, doc, { x: 0, y: 0, w: 5000, h: 5000 })).toEqual([1, 2]);
  });
});

describe("drag translation", () => {
  const g = makeGeom(16, 16, "pitch");
  const snap = SNAP_TICKS["1/16"];
  const base = docWith({ start: 0, midi: E4, len: PPQ / 2 });

  it("moves in time, snapped", () => {
    const r = applyDrag(base, g, { mode: "move", ids: [1], anchorId: 1, dxPx: 16 * 2 + 5, dyPx: 0, snapTicks: snap, free: false });
    expect(r.doc.notes[0]!.startTick).toBe(snap * 2);
  });

  it("alt moves without snapping", () => {
    const r = applyDrag(base, g, { mode: "move", ids: [1], anchorId: 1, dxPx: 5, dyPx: 0, snapTicks: snap, free: true });
    expect(r.doc.notes[0]!.startTick).toBe(Math.round(5 / g.pxPerTick));
  });

  it("moves pitch by rows (up is higher)", () => {
    const r = applyDrag(base, g, { mode: "move", ids: [1], anchorId: 1, dxPx: 0, dyPx: -32, snapTicks: snap, free: false });
    expect(noteMidi(r.doc, r.doc.notes[0]!)).toBe(E4 + 2);
  });

  it("changes string in the strings view at the same pitch", () => {
    const sg = makeGeom(16, 16, "strings");
    const note = base.notes[0]!;
    const r = applyDrag(base, sg, { mode: "move", ids: [1], anchorId: 1, dxPx: 0, dyPx: LANE_H, snapTicks: snap, free: false });
    expect(r.doc.notes[0]!.string).toBe(note.string + 1);
    expect(noteMidi(r.doc, r.doc.notes[0]!)).toBe(E4);
  });

  it("resizes from the right edge, snapped, with no bar-end limit", () => {
    const r = applyDrag(base, g, { mode: "resize", ids: [1], anchorId: 1, dxPx: 16 * 2, dyPx: 0, snapTicks: snap, free: false });
    expect(r.doc.notes[0]!.durationTicks).toBe(PPQ / 2 + snap * 2);
    const far = applyDrag(base, g, { mode: "resize", ids: [1], anchorId: 1, dxPx: 16 * 100, dyPx: 0, snapTicks: snap, free: false });
    expect(far.doc.notes[0]!.durationTicks).toBeGreaterThan(PPQ * 4);
  });

  it("moves a chord together onto different strings", () => {
    const parsed = docFromTab("e|--0----3----|\nB|--1----0----|\nG|--0----0----|\nD|--2----0----|\nA|--3----2----|\nE|-------3----|");
    if (!parsed.ok) throw new Error("fixture");
    const ids = parsed.doc.notes.map((n) => n.id);
    const r = applyDrag(parsed.doc, g, { mode: "move", ids, anchorId: ids[0]!, dxPx: 0, dyPx: -16, snapTicks: snap, free: false });
    const keys = r.doc.notes.map((n) => `${n.startTick}:${n.string}`);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("draw span", () => {
  const g = makeGeom(16, 16, "pitch");
  const doc = emptyDoc({ title: "T" });
  it("click uses the default length at the snapped start", () => {
    expect(drawSpan(g, doc, 36, 36, SNAP_TICKS["1/16"], PPQ / 2, false)).toEqual({ startTick: 480, durationTicks: PPQ / 2 });
  });
  it("drag sets the length, at least one snap step", () => {
    expect(drawSpan(g, doc, 0, 32, SNAP_TICKS["1/16"], PPQ / 2, true)).toEqual({ startTick: 0, durationTicks: 480 });
    expect(drawSpan(g, doc, 0, 1, SNAP_TICKS["1/16"], PPQ / 2, true).durationTicks).toBe(SNAP_TICKS["1/16"]);
  });
});

describe("opening zoom", () => {
  const S16 = PPQ / 4;
  it("keeps the default for an empty song or one with long notes", () => {
    expect(fitZoom(emptyDoc({ title: "T" }))).toBe(DEFAULT_ZOOM);
    expect(fitZoom(docWith({ start: 0, midi: E4, len: PPQ }))).toBe(DEFAULT_ZOOM);
  });

  it("zooms in so fast runs of 1/32 notes are about 30 px wide", () => {
    const run = Array.from({ length: 12 }, (_, i) => ({ start: (i * S16) / 2, midi: E4 + (i % 3), len: S16 / 2 }));
    const zoom = fitZoom(docWith(...run));
    expect(zoom * 0.5).toBeGreaterThanOrEqual(30);
    expect(zoom).toBeLessThanOrEqual(MAX_ZOOM);
  });
});
