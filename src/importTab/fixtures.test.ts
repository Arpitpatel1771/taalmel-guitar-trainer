import { readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildSongText, guessRhythm, readTab, sectionsFromSuggestions } from "./index.js";

const DIR = join(__dirname, "../../fixtures/tabs");
const update = process.env["UPDATE_GOLDEN"] === "1";

function golden(path: string, value: string) {
  if (update || !existsSync(path)) writeFileSync(path, value);
  expect(value).toBe(readFileSync(path, "utf8"));
}

const files = readdirSync(DIR).filter((f) => f.endsWith(".txt") && !f.endsWith(".song.txt"));

describe("tab fixtures", () => {
  for (const f of files) {
    const name = f.replace(/\.txt$/, "");
    it(`${name}: reader output matches golden`, () => {
      const result = readTab(readFileSync(join(DIR, f), "utf8"));
      golden(join(DIR, `${name}.expected.json`), JSON.stringify(result, null, 2) + "\n");
    });

    it(`${name}: builds valid song text when the tab has no errors`, () => {
      const result = readTab(readFileSync(join(DIR, f), "utf8"));
      if (result.errors.length > 0) {
        expect(name.startsWith("malformed")).toBe(true);
        return;
      }
      const bars = guessRhythm(result.events, result.bars, { time: { numerator: 4, denominator: 4 }, unit: 8 });
      const built = buildSongText(
        { title: name, time: { numerator: 4, denominator: 4 }, bpm: 90, unit: 8, capo: result.capo },
        bars,
        sectionsFromSuggestions(result.sectionNames),
      );
      expect(built.ok, JSON.stringify(built)).toBe(true);
      if (built.ok) golden(join(DIR, `${name}.song.txt`), built.text);
    });
  }
});
