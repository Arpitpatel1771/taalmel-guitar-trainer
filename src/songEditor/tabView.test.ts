import { describe, expect, it } from "vitest";
import { addNote, emptyDoc, setHeader, setInto, tabView, guessTabTitle, summarizeTab, docFromTab, type EdDoc } from "./index.js";

function build(): EdDoc {
  let d = emptyDoc({ title: "T" });
  d = addNote(d, { startTick: 0, midi: 64, durationTicks: 480 }).doc; // 1S0
  d = addNote(d, { startTick: 0, midi: 55, durationTicks: 480 }).doc; // chord, string 3
  d = addNote(d, { startTick: 960, midi: 64 + 2, durationTicks: 480 }).doc;
  d = addNote(d, { startTick: 1920, midi: 64, durationTicks: 480 }).doc;
  return d;
}

describe("tabView", () => {
  it("puts chords in one column with bar lines", () => {
    const v = tabView(build(), { toBar: 0 });
    expect(v.lines.length).toBe(6);
    expect(v.lines[0]).toMatch(/^e\|-0/);
    expect(v.lines[2]).toMatch(/^G\|-0/);
    expect(v.lines.every((l) => l.endsWith("|"))).toBe(true);
    expect(new Set(v.lines.map((l) => l.length)).size).toBe(1);
  });
  it("maps cells to notes at the right column", () => {
    const d = build();
    const v = tabView(d, { toBar: 0 });
    for (const c of v.cells) {
      const n = d.notes.find((x) => x.id === c.noteId)!;
      expect(v.lines[c.row]!.slice(c.col, c.col + c.length)).toBe(String(n.fret));
      expect(c.row).toBe(n.string - 1);
    }
    expect(v.cells.length).toBe(4);
  });
  it("draws techniques", () => {
    let d = build();
    const last = d.notes.find((n) => n.startTick === 1920)!.id;
    d = setInto(d, [last], { kind: "hammer" }).doc;
    expect(tabView(d, { toBar: 0 }).lines[0]).toContain("h0");
    const second = d.notes.find((n) => n.startTick === 960)!.id;
    d = setInto(d, [second], { kind: "bend", semitones: 1 }).doc;
    expect(tabView(d, { toBar: 0 }).lines[0]).toContain("2b");
  });
  it("shows the capo and wraps systems", () => {
    let d = build();
    d = setHeader(d, { capo: 2 }).doc;
    const v = tabView(d, { barsPerLine: 2 });
    expect(v.lines[0]).toBe("Capo 2");
    expect(v.lines.filter((l) => l.startsWith("e|")).length).toBe(2);
    for (const c of v.cells) expect(v.lines[c.row]!.slice(c.col, c.col + c.length)).toMatch(/^\d+$/);
  });
  it("honours a bar range", () => {
    const v = tabView(build(), { fromBar: 1, toBar: 1 });
    expect(v.cells.length).toBe(0);
    expect(v.lines[0]).toMatch(/^e\|---+\|$/);
  });
});

describe("tab import helpers", () => {
  it("summarizes and builds", () => {
    const tab = ["Capo 2", "e|-0-3-|-5---|", "B|-----|-----|", "G|-----|-----|", "D|-----|-----|", "A|-----|-----|", "E|-----|-----|"].join("\n");
    const s = summarizeTab(tab);
    expect(s).toMatchObject({ noteCount: 3, barCount: 2, capo: 2 });
    const r = docFromTab(tab, { title: "X", youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.doc.header.capo).toBe(2);
      expect(r.doc.header.youtube?.videoId).toBe("dQw4w9WgXcQ");
      expect(r.doc.notes.length).toBe(3);
    }
  });
  it("uses the given bpm for the doc, else 100", () => {
    const tab = ["e|-0-3-|-5---|", "B|-----|-----|", "G|-----|-----|", "D|-----|-----|", "A|-----|-----|", "E|-----|-----|"].join("\n");
    const r = docFromTab(tab, { title: "X", bpm: 128 });
    expect(r.ok && r.doc.header.bpm).toBe(128);
    const d = docFromTab(tab, { title: "X" });
    expect(d.ok && d.doc.header.bpm).toBe(100);
    expect(emptyDoc({ title: "X", bpm: 72 }).header.bpm).toBe(72);
  });
  it("reports tab errors", () => {
    const r = docFromTab("hello", { title: "X" });
    expect(r.ok).toBe(false);
  });
  it("guesses a title", () => {
    expect(guessTabTitle("Karz Theme\n\ne|---|")).toBe("Karz Theme");
    expect(guessTabTitle("e|--0--|")).toBe("");
    expect(guessTabTitle("Tempo: 128\nCapo 2\nKarz Theme\ne|---|")).toBe("Karz Theme");
  });
  it("empty doc defaults", () => {
    const d = emptyDoc({ title: "A", youtubeUrl: "https://youtu.be/dQw4w9WgXcQ" });
    expect(d.bars.length).toBe(4);
    expect(d.header).toMatchObject({ bpm: 100, unit: 16, time: { numerator: 4, denominator: 4 } });
    expect(d.header.youtube?.offsetSec).toBe(0);
  });
});
