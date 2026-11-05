import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { SAMPLE_SONGS } from "../samples/index.js";
import { parse, serialize } from "../songFormat/index.js";
import { docFromSong, docFromTab, emptyDoc, saveDoc, serializeDoc, addNote, setSection, setLength, docToSong, validateDoc } from "./index.js";

const TABS = join(__dirname, "../../fixtures/tabs");
const VALID = join(__dirname, "../../fixtures/songs/valid");

function roundTrip(text: string) {
  const p = parse(text);
  if (!p.ok) throw new Error("fixture does not parse");
  const doc = docFromSong(p.song);
  const out = serializeDoc(doc);
  const again = parse(out);
  expect(again.ok, out).toBe(true);
  if (again.ok) {
    expect(serialize(again.song)).toBe(out);
    expect(again.song.notes.map((n) => [n.string, n.fret, n.startTick, n.durationTicks, n.offsetMs, n.meta])).toEqual(
      p.song.notes.map((n) => [n.string, n.fret, n.startTick, n.durationTicks, n.offsetMs, n.meta]),
    );
  }
  return { doc, out };
}

describe("round trip", () => {
  for (const s of SAMPLE_SONGS) it(`sample ${s.id}`, () => void roundTrip(s.text));
  for (const f of readdirSync(VALID).filter((x) => x.endsWith(".txt"))) {
    it(`valid song ${f}`, () => void roundTrip(readFileSync(join(VALID, f), "utf8")));
  }
  for (const f of readdirSync(TABS).filter((x) => x.endsWith(".song.txt"))) {
    it(`tab fixture ${f}`, () => void roundTrip(readFileSync(join(TABS, f), "utf8")));
  }
  for (const f of readdirSync(TABS).filter((x) => x.endsWith(".txt") && !x.endsWith(".song.txt"))) {
    it(`docFromTab ${f}`, () => {
      const r = docFromTab(readFileSync(join(TABS, f), "utf8"), { title: "T" });
      if (!r.ok) {
        expect(f.startsWith("malformed")).toBe(true);
        return;
      }
      const saved = saveDoc(r.doc);
      expect(saved.ok).toBe(true);
    });
  }
});

describe("save rules", () => {
  it("uses the section unit when it holds every start and length", () => {
    let doc = emptyDoc({ title: "T" });
    doc = addNote(doc, { startTick: 0, midi: 64, durationTicks: 480 }).doc;
    doc = addNote(doc, { startTick: 960, midi: 64, durationTicks: 480 }).doc;
    const song = docToSong(doc);
    expect(song.sections[0]!.bars[0]!.slots).toBe(16);
  });

  it("picks the coarsest grid otherwise", () => {
    let doc = emptyDoc({ title: "T" });
    doc = addNote(doc, { startTick: 0, midi: 64, durationTicks: 320 }).doc;
    doc = addNote(doc, { startTick: 320, midi: 66, durationTicks: 320 }).doc;
    const song = docToSong(doc);
    expect(song.sections[0]!.bars[0]!.slots).toBe(12);
    expect(saveDoc(doc).ok).toBe(true);
  });

  it("prefers a coarse grid when the unit does not fit", () => {
    let doc = emptyDoc({ title: "T" });
    doc = { ...doc, header: { ...doc.header, unit: 16 } };
    doc = addNote(doc, { startTick: 0, midi: 64, durationTicks: 3840 }).doc;
    expect(docToSong(doc).sections[0]!.bars[0]!.slots).toBe(16);
    doc = addNote(doc, { startTick: 1920, midi: 66, durationTicks: 1920 }).doc;
    expect(docToSong(doc).sections[0]!.bars[0]!.slots).toBe(16);
  });

  it("writes lengths off the grid as kXa/b", () => {
    let doc = emptyDoc({ title: "T" });
    doc = addNote(doc, { startTick: 0, midi: 64, durationTicks: 3840 }).doc;
    doc = addNote(doc, { startTick: 1920, midi: 66, durationTicks: 240 }).doc;
    doc = setLength(doc, [doc.notes[0]!.id], 720).doc; // 3/16, not in a 2-slot grid
    const text = serializeDoc({ ...doc, header: { ...doc.header, unit: 2 } });
    expect(text).toContain("3X1/16");
    expect(parse(text).ok).toBe(true);
  });

  it("drops trailing empty bars but keeps a bar that starts a section", () => {
    let doc = emptyDoc({ title: "T" });
    doc = addNote(doc, { startTick: 0, midi: 64, durationTicks: 480 }).doc;
    expect(docToSong(doc).sections[0]!.bars.length).toBe(1);
    doc = setSection(doc, 0, { bpm: 80 }).doc;
    const withSec = { ...doc, sections: [...doc.sections, { name: "Outro", startBar: 3 }] };
    const song = docToSong(withSec);
    expect(song.sections.map((s) => s.bars.length)).toEqual([3, 1]);
    expect(parse(serializeDoc(withSec)).ok).toBe(true);
  });

  it("blocks save on conflicts and a missing title", () => {
    let doc = emptyDoc({ title: " " });
    doc = addNote(doc, { startTick: 0, midi: 64, durationTicks: 480 }).doc;
    expect(saveDoc(doc).ok).toBe(false);
    doc = { ...doc, header: { ...doc.header, title: "T" }, notes: [...doc.notes, { ...doc.notes[0]!, id: 99, fret: 0 }] };
    const r = saveDoc(doc);
    expect(r.ok).toBe(false);
    expect(validateDoc(doc).some((p) => p.noteId === 99)).toBe(true);
  });

  it("keeps a note that rings past its bar as one note with its full length", () => {
    let doc = emptyDoc({ title: "T" });
    doc = addNote(doc, { startTick: 3600, midi: 64, durationTicks: 240 }).doc;
    doc = setLength(doc, [doc.notes[0]!.id], 960).doc;
    const song = docToSong(doc);
    expect(song.notes).toHaveLength(1);
    expect(song.notes[0]!.durationTicks).toBe(960);
    expect(song.sections[0]!.bars).toHaveLength(2); // the bar it rings into is kept
    const text = serializeDoc(doc);
    const r = parse(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.song.notes[0]!.durationTicks).toBe(960);
    expect(saveDoc(doc).ok).toBe(true);
  });
});
