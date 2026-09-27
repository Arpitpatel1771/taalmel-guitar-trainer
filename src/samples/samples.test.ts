import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { parse } from "../songFormat";

const dir = new URL(".", import.meta.url);
const files = readdirSync(dir).filter((f) => f.endsWith(".txt"));

describe("example songs", () => {
  it("ships the seven agreed songs", () => {
    expect(files.sort()).toEqual(
      ["amazing-grace", "bella-ciao", "frere-jacques", "greensleeves", "happy-birthday", "ode-to-joy", "twinkle-twinkle"].map((f) => `${f}.txt`),
    );
  });

  for (const f of files) {
    it(`${f} parses without errors`, () => {
      const result = parse(readFileSync(new URL(f, dir), "utf8"));
      if (!result.ok) throw new Error(result.errors.map((e) => `line ${e.line}: ${e.message}`).join("\n"));
      expect(result.ok).toBe(true);
    });
  }
});
