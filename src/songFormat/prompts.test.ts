import { describe, expect, it } from "vitest";
import type { ParseError } from "../model/index.js";
import { buildImportPrompt, buildRepairPrompt } from "./prompts.js";

describe("buildImportPrompt (spec 11.2)", () => {
  const form = {
    title: "My Song",
    time: { numerator: 4, denominator: 4 },
    bpm: 96,
    unit: 8,
  };

  it("matches the expected prompt for a song without video (snapshot)", () => {
    expect(buildImportPrompt(form)).toMatchSnapshot();
  });

  it("matches the expected prompt for a song with a video link (snapshot)", () => {
    expect(
      buildImportPrompt({ ...form, youtubeUrl: "https://youtu.be/xxxxxxxxxxx", offsetSec: 12.5 }),
    ).toMatchSnapshot();
  });

  it("includes the header values verbatim", () => {
    const prompt = buildImportPrompt(form);
    expect(prompt).toContain("title: My Song");
    expect(prompt).toContain("time: 4/4");
    expect(prompt).toContain("bpm: 96");
    expect(prompt).toContain("unit: 8");
  });

  it("omits youtube/offset header lines when no video is given", () => {
    const prompt = buildImportPrompt(form);
    expect(prompt).not.toContain("youtube:");
  });

  it("includes a fret table generated from notation for frets 0-12 on all 6 strings", () => {
    const prompt = buildImportPrompt(form);
    // Spot-check a few known positions (standard tuning).
    expect(prompt).toContain("E4"); // string 1, fret 0
    expect(prompt).toContain("E2"); // string 6, fret 0
    expect(prompt).toContain("| 12 |"); // fret row up to 12
    expect(prompt).not.toContain("| 13 |"); // table stops at fret 12
  });

  it("instructs the LLM to mark unsure rhythm as uncertain and never invent it", () => {
    const prompt = buildImportPrompt(form);
    expect(prompt).toMatch(/mark EVERY such note uncertain/);
    expect(prompt).toMatch(/Never invent/);
  });

  it("includes the worked example and tab equivalents table", () => {
    const prompt = buildImportPrompt(form);
    expect(prompt).toContain("```song");
    expect(prompt).toContain("3h5p4");
    expect(prompt).toContain("7b9r7");
  });

  it("reminds about the most common errors", () => {
    const prompt = buildImportPrompt(form);
    expect(prompt).toMatch(/global/i);
    expect(prompt).toMatch(/strictly increase/i);
    expect(prompt).toMatch(/fit inside its bar/i);
    expect(prompt).toMatch(/one note per string per slot/i);
  });
});

describe("buildRepairPrompt (spec 11.3)", () => {
  const errors: ParseError[] = [
    { line: 7, bar: 1, slot: 3, token: "1S25", code: "INVALID_FRET", message: "Fret must be 0-24, got 25" },
    { line: 9, code: "NO_SECTIONS", message: "Song must contain at least one section" },
  ];
  const currentText = "title: T\ntime: 4/4\nbpm: 100\nunit: 8\n\n[A]\nBar 1: {1} 1S25\n";

  it("matches the expected repair prompt (snapshot)", () => {
    expect(buildRepairPrompt(errors, currentText)).toMatchSnapshot();
  });

  it("includes each error as Line <n> (bar <b>, slot <s>): <message>. Token: <token>", () => {
    const prompt = buildRepairPrompt(errors, currentText);
    expect(prompt).toContain("Line 7 (bar 1, slot 3): Fret must be 0-24, got 25. Token: 1S25");
  });

  it("omits the bar/slot/token parts when absent from the error", () => {
    const prompt = buildRepairPrompt(errors, currentText);
    expect(prompt).toContain("Line 9: Song must contain at least one section.");
  });

  it("includes the current text so the LLM preserves manual edits", () => {
    const prompt = buildRepairPrompt(errors, currentText);
    expect(prompt).toContain(currentText.trim());
  });

  it("instructs the LLM to fix only these errors and output one song block", () => {
    const prompt = buildRepairPrompt(errors, currentText);
    expect(prompt).toMatch(/Fix only these/);
    expect(prompt).toMatch(/```song/);
  });
});
