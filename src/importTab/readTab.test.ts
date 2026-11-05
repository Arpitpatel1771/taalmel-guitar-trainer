import { describe, expect, it } from "vitest";
import { readTab } from "./readTab.js";

const wrap = (e0: string) => {
  const e = `--${e0}--`;
  const d = "-".repeat(e.length);
  return `e|${e}|\nB|${d}|\nG|${d}|\nD|${d}|\nA|${d}|\nE|${d}|\n`;
};
const top = (text: string) => readTab(text).events.flatMap((e) => e.notes.filter((n) => n.string === 1));

describe("readTab techniques", () => {
  it("hammer-on and pull-off go on the destination note", () => {
    const n = top(wrap("-3h5p3-"));
    expect(n.map((x) => [x.fret, x.technique?.connection?.kind])).toEqual([[3, undefined], [5, "hammer"], [3, "pull"]]);
  });

  it("slides use / and \\, leading slide is slide_in, trailing is slide_out", () => {
    const n = top(wrap("-5/7\\5-/9-7/--"));
    expect(n[1]!.technique?.connection).toEqual({ kind: "slide" });
    expect(n[2]!.technique?.connection).toEqual({ kind: "slide" });
    expect(n[3]!.technique).toEqual({ slideIn: true });
    expect(n[4]!.technique).toEqual({ slideOut: true });
  });

  it("bend with target becomes semitones, release becomes bend 0 at the original fret", () => {
    const n = top(wrap("-7b9r7-"));
    expect(n.map((x) => [x.fret, x.technique?.connection])).toEqual([
      [7, undefined],
      [7, { kind: "bend", semitones: 2 }],
      [7, { kind: "bend", semitones: 0 }],
    ]);
  });

  it("bend without target assumes 2 semitones and warns", () => {
    const r = readTab(wrap("-7b---"));
    expect(top(wrap("-7b---"))[1]!.technique?.connection).toEqual({ kind: "bend", semitones: 2 });
    expect(r.warnings.some((w) => w.code === "TAB_BEND_TARGET_MISSING")).toBe(true);
  });

  it("drops an impossible bend with a warning", () => {
    const r = readTab(wrap("-7b15-"));
    expect(r.warnings.some((w) => w.code === "TAB_BEND_RANGE")).toBe(true);
    expect(top(wrap("-7b15-"))).toHaveLength(1);
  });

  it("vibrato and x", () => {
    const n = top(wrap("-9~~-x-7x-"));
    expect(n[0]!.technique).toEqual({ vibrato: true });
    expect(n[1]).toMatchObject({ fret: 0, technique: { muted: true } });
    expect(n[2]).toMatchObject({ fret: 7, technique: { muted: true } });
  });

  it("drops a pull-off that does not go down, with a warning", () => {
    const r = readTab(wrap("-5p7-"));
    expect(r.warnings.map((w) => w.code)).toContain("TAB_PULL_NOT_LOWER");
    expect(top(wrap("-5p7-"))[1]!.technique).toBeUndefined();
  });

  it("slide to the same fret is dropped; slide with no earlier note becomes slide_in", () => {
    expect(readTab(wrap("-5/5-")).warnings.map((w) => w.code)).toContain("TAB_SLIDE_SAME_FRET");
  });

  it("palm-mute line mutes covered notes only", () => {
    const text = `  PM---|\n${wrap("-3-5-7-9-")}`;
    const n = top(text);
    expect(n.map((x) => !!x.technique?.muted)).toEqual([true, true, false, false]);
  });
});

describe("readTab structure", () => {
  it("merges notes in one column into a chord", () => {
    const r = readTab("e|--0--|\nB|--1--|\nG|--0--|\nD|--2--|\nA|--3--|\nE|-----|\n");
    expect(r.events).toHaveLength(1);
    expect(r.events[0]!.notes.map((n) => n.string)).toEqual([1, 2, 3, 4, 5]);
  });

  it("reads multi-digit frets", () => {
    expect(top(wrap("-12-15-")).map((n) => n.fret)).toEqual([12, 15]);
  });

  it("splits bars at bar lines and indexes them", () => {
    const r = readTab(`e|-1-2-|-3-4-|\nB|-----|-----|\nG|-----|-----|\nD|-----|-----|\nA|-----|-----|\nE|-----|-----|\n`);
    expect(r.bars).toHaveLength(2);
    expect(r.events.map((e) => e.bar)).toEqual([0, 0, 1, 1]);
  });

  it("one bar per block when there are no bar lines", () => {
    const r = readTab("e---0--3--\nB---------\nG---------\nD---------\nA---------\nE---------\n");
    expect(r.bars).toHaveLength(1);
    expect(r.bars[0]!.explicit).toBe(false);
  });

  it("reports uneven lengths with line and column", () => {
    const r = readTab("e|--0--|\nB|--0-|\nG|--0--|\nD|--0--|\nA|--0--|\nE|--0--|\n");
    expect(r.errors[0]).toMatchObject({ line: 2, code: "TAB_LINE_LENGTH" });
    expect(r.errors[0]!.column).toBeDefined();
  });

  it("reports a block with the wrong number of lines", () => {
    const r = readTab("e|--0--|\nB|--0--|\nG|--0--|\n");
    expect(r.errors[0]).toMatchObject({ line: 1, code: "TAB_BLOCK_SIZE" });
  });

  it("reports frets above 24 with line and column", () => {
    const r = readTab(wrap("-30-"));
    expect(r.errors[0]).toMatchObject({ line: 1, column: 6, code: "TAB_FRET_RANGE" });
  });

  it("errors when no tab is found", () => {
    expect(readTab("just some lyrics").errors[0]!.code).toBe("TAB_NOT_FOUND");
  });
});

describe("readTab noise and metadata", () => {
  it("reads capo lines", () => {
    expect(readTab(`Capo 4\n${wrap("-1-")}`).capo).toBe(4);
    expect(readTab(`Capo: 2nd fret\n${wrap("-1-")}`).capo).toBe(2);
    expect(readTab(`no capo\n${wrap("-1-")}`).capo).toBeUndefined();
    expect(readTab(`capo 15\n${wrap("-1-")}`).warnings.map((w) => w.code)).toContain("TAB_CAPO_RANGE");
  });

  it("warns once about repeats", () => {
    const r = readTab(`Chorus x2\n${wrap("-1-")}`);
    expect(r.warnings.find((w) => w.code === "TAB_REPEAT")!.message).toBe("Repeats aren't expanded; copy the bars if needed");
    expect(r.sectionNames[0]!.name).toBe("Chorus");
  });

  it("keeps headings as section suggestions", () => {
    const r = readTab(`[Intro]\n${wrap("-1-")}\nVERSE 1\n${wrap("-2-")}`);
    expect(r.sectionNames.map((s) => [s.name, s.barIndex])).toEqual([["Intro", 0], ["Verse 1", 1]]);
  });

  it("warns for non-standard tuning from a header or from labels", () => {
    expect(readTab(`Tuning: Drop D\n${wrap("-1-")}`).warnings[0]!.code).toBe("TAB_TUNING_NONSTANDARD");
    expect(readTab(`D A D G B E\n${wrap("-1-")}`).warnings[0]!.code).toBe("TAB_TUNING_NONSTANDARD");
    expect(readTab(`Standard tuning\n${wrap("-1-")}`).warnings).toEqual([]);
    expect(readTab(`Tuning: E A D G B E\n${wrap("-1-")}`).warnings).toEqual([]);
  });

  it("ignores lyrics and chord names", () => {
    const r = readTab(`Am   G\nHello darling-baby\n${wrap("-1-")}`);
    expect(r.errors).toEqual([]);
    expect(r.warnings).toEqual([]);
  });
});

describe("readTab trailing text after the closing bar", () => {
  const block = (suffix: string) => {
    const d = "-".repeat(7);
    return `e|--3----|${suffix}\nB|${d}|\nG|${d}|\nD|${d}|\nA|${d}|\nE|${d}|\n`;
  };
  it("reads the tab and warns about a repeat mark", () => {
    const r = readTab(block("  x2"));
    expect(r.errors).toEqual([]);
    expect(r.events).toHaveLength(1);
    expect(r.warnings.map((w) => w.code)).toEqual(["TAB_REPEAT"]);
  });
  it("reads the tab and warns about a performance note", () => {
    const r = readTab(block(" (let ring)"));
    expect(r.errors).toEqual([]);
    expect(r.events).toHaveLength(1);
    expect(r.warnings[0]).toMatchObject({ code: "TAB_TRAILING_TEXT", line: 1 });
  });
  it("does not treat trailing dashes or notes as text", () => {
    const r = readTab("e|--3--|--\nB|-----|--\nG|-----|--\nD|-----|--\nA|-----|--\nE|-----|--\n");
    expect(r.warnings).toEqual([]);
  });
});
