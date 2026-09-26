import * as fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { Note, ParseError, Song } from "../model/index.js";
import { ERROR_CODES } from "./errorCodes.js";
import { parse } from "./parse.js";
import { serialize } from "./serialize.js";

const VALID_DIR = fileURLToPath(new URL("../../fixtures/songs/valid", import.meta.url));
const INVALID_DIR = fileURLToPath(new URL("../../fixtures/songs/invalid", import.meta.url));

function readValidFixtures(): { name: string; text: string }[] {
  return fs
    .readdirSync(VALID_DIR)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => ({ name: f, text: fs.readFileSync(`${VALID_DIR}/${f}`, "utf8") }));
}

interface InvalidFixture {
  name: string;
  text: string;
  expected: { errors: { code: string; line: number }[] };
}

function readInvalidFixtures(): InvalidFixture[] {
  return fs
    .readdirSync(INVALID_DIR)
    .filter((f) => f.endsWith(".txt"))
    .sort()
    .map((f) => {
      const base = f.slice(0, -".txt".length);
      const text = fs.readFileSync(`${INVALID_DIR}/${f}`, "utf8");
      const expected = JSON.parse(fs.readFileSync(`${INVALID_DIR}/${base}.expected.json`, "utf8"));
      return { name: f, text, expected };
    });
}

/** Strips `source` (line/column) from every note. Serializing and re-parsing a song
 * necessarily changes note source positions (reformatted text), so the round-trip
 * property is checked with source stripped from both sides. This is the one
 * documented exception to "parse(serialize(parse(t))) deep-equals parse(t))". */
function stripSource(song: Song): Song {
  const strip = (n: Note): Note => ({ ...n, source: { line: -1, column: -1 } });
  return {
    ...song,
    notes: song.notes.map(strip),
    sections: song.sections.map((s) => ({
      ...s,
      bars: s.bars.map((b) => ({ ...b, notes: b.notes.map(strip) })),
    })),
  };
}

describe("valid fixtures parse without error", () => {
  for (const fixture of readValidFixtures()) {
    it(`${fixture.name} parses cleanly`, () => {
      const result = parse(fixture.text);
      if (!result.ok) {
        throw new Error(`${fixture.name} failed to parse: ${JSON.stringify(result.errors, null, 2)}`);
      }
      expect(result.ok).toBe(true);
    });
  }
});

describe("invalid fixtures produce their documented error codes (one per error code)", () => {
  for (const fixture of readInvalidFixtures()) {
    it(`${fixture.name}`, () => {
      const result = parse(fixture.text);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      const actual = result.errors.map((e) => ({ code: e.code, line: e.line }));
      expect(actual).toEqual(fixture.expected.errors);
    });
  }

  it("every non-warning error code has a fixture", () => {
    const covered = new Set(readInvalidFixtures().flatMap((f) => f.expected.errors.map((e: { code: string }) => e.code)));
    const nonWarningCodes = ERROR_CODES.filter((c) => c !== "DUPLICATE_SECTION_NAME");
    for (const code of nonWarningCodes) {
      expect(covered.has(code), `missing invalid fixture for ${code}`).toBe(true);
    }
  });
});

describe("round-trip property: parse(serialize(parse(t))) deep-equals parse(t)", () => {
  // Per spec 5.7. Note.source (line/column) is expected to differ after
  // reserialization since the canonical text is laid out differently from the
  // original (e.g. redundant `(n)` overrides and metadata order are normalized) -
  // see stripSource() above. Everything else must match exactly.
  for (const fixture of readValidFixtures()) {
    it(`${fixture.name}`, () => {
      const first = parse(fixture.text);
      expect(first.ok).toBe(true);
      if (!first.ok) return;

      const serialized = serialize(first.song);
      const second = parse(serialized);
      expect(second.ok).toBe(true);
      if (!second.ok) return;

      expect(stripSource(second.song)).toEqual(stripSource(first.song));
      expect(second.warnings).toEqual(first.warnings);
    });
  }
});

describe("duplicate section names produce a warning, not an error", () => {
  it("DUPLICATE_SECTION_NAME warning", () => {
    const text = fs.readFileSync(`${VALID_DIR}/duplicate-section-name.txt`, "utf8");
    const result = parse(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.warnings).toHaveLength(1);
    const w = result.warnings[0]!;
    expect(w.code).toBe("DUPLICATE_SECTION_NAME");
    expect(w.severity).toBe("warning");
  });
});

describe("additional parser behavior not covered by single-error fixtures", () => {
  it("collects multiple errors within the same stage instead of stopping at the first", () => {
    const text = `title: T
time: 4/4
bpm: 100
unit: 8

[A]
Bar 1: {1} 7S0
Bar 2: {1} 1S25
`;
    const result = parse(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    const codes = result.errors.map((e: ParseError) => e.code);
    expect(codes).toContain("INVALID_STRING");
    expect(codes).toContain("INVALID_FRET");
  });

  it("stops at the syntax stage and does not report structure/semantic errors too", () => {
    // Bar 1 has an unrecognized note token (syntax) AND, if it were parsed, bar
    // numbering would also be wrong (structure) - only the syntax error should
    // be reported.
    const text = `title: T
time: 4/4
bpm: 100
unit: 8

[A]
Bar 1: {1} 1Q0
Bar 3: {1} 1S0
`;
    const result = parse(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]!.code).toBe("MALFORMED_NOTE_TOKEN");
  });

  it("a section falls back to the header bpm/unit when it does not override them", () => {
    const text = `title: T
time: 4/4
bpm: 90
unit: 8

[Intro]
bpm: 110
Bar 1: {1} 1S0

[Outro]
Bar 2: {1} 1S0
`;
    const result = parse(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.sections[0]!.bpm).toBe(110);
    expect(result.song.sections[1]!.bpm).toBe(90);
  });

  it("ignores comment and blank lines", () => {
    const text = `# a comment
title: T

# another comment
time: 4/4
bpm: 100
unit: 8

[A]
# comment inside a section
Bar 1: {1} 1S0
`;
    const result = parse(text);
    expect(result.ok).toBe(true);
  });

  it("connection flag search skips back across bar lines", () => {
    const text = `title: T
time: 4/4
bpm: 100
unit: 8

[A]
Bar 1: {1} 1S5
Bar 2: {1} 1S7(hammer)
`;
    const result = parse(text);
    expect(result.ok).toBe(true);
  });

  it("flat metadata key does not take a value", () => {
    const text = `title: T
time: 4/4
bpm: 100
unit: 8

[A]
Bar 1: {1} 1S2(flat: true)
`;
    const result = parse(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("MALFORMED_METADATA");
  });

  it("parses flat metadata on a black-key fret and sets meta.flat", () => {
    const text = `title: T
time: 4/4
bpm: 100
unit: 8

[A]
Bar 1: {1} 1S2(flat)
`;
    const result = parse(text);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.song.notes[0]!.meta.flat).toBe(true);
  });

  it("rejects flat on a natural note with FLAT_ON_NATURAL", () => {
    const text = `title: T
time: 4/4
bpm: 100
unit: 8

[A]
Bar 1: {1} 1S0(flat)
`;
    const result = parse(text);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.errors[0]!.code).toBe("FLAT_ON_NATURAL");
  });
});
