import { describe, expect, it } from "vitest";
import { chordKey } from "../index";
import {
  OPTION_COUNT,
  QUESTIONS_PER_ROUND,
  allChords,
  buildQuestion,
  generateRound,
  openChords,
  poolChords,
  quizKey,
  quizName,
  quizVoicing,
  recordResults,
  seededRng,
  type QuizChord,
  type QuizKind,
  type QuizPool,
} from "./quiz";

const MINE: QuizChord[] = [
  { rootPc: 0, typeId: "maj", spelling: "sharp" },
  { rootPc: 9, typeId: "m", spelling: "sharp" },
];

describe("seededRng", () => {
  it("is deterministic and in [0,1)", () => {
    const a = seededRng(5);
    const b = seededRng(5);
    for (let i = 0; i < 50; i++) {
      const x = a();
      expect(x).toBe(b());
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThan(1);
    }
    expect(seededRng(1)()).not.toBe(seededRng(2)());
  });
});

describe("pools", () => {
  it("open pool is the open chords", () => {
    const p = poolChords("open", MINE);
    expect(p.length).toBeGreaterThan(5);
    expect(p.map(quizKey)).toEqual(openChords().map(quizKey));
  });
  it("mine uses marked chords, falling back to open when empty", () => {
    expect(poolChords("mine", MINE).map(quizKey)).toEqual(MINE.map(quizKey));
    expect(poolChords("mine", []).map(quizKey)).toEqual(openChords().map(quizKey));
  });
  it("everything covers all roots with a voicing and no slash chords", () => {
    const p = poolChords("all", []);
    expect(p.length).toBeGreaterThan(openChords().length);
    expect(p.some((c) => "slash" in c)).toBe(false);
    expect(new Set(p.map(quizKey)).size).toBe(p.length);
    expect(p.every((c) => quizVoicing(c) !== undefined)).toBe(true);
  });
});

describe("questions", () => {
  const kinds: QuizKind[] = ["name", "find"];
  const pools: QuizPool[] = ["mine", "open", "all"];
  for (const kind of kinds) {
    for (const pool of pools) {
      it(`${kind} / ${pool}: 10 questions, 4 unique options incl. the answer`, () => {
        for (let seed = 1; seed <= 20; seed++) {
          const chords = poolChords(pool, MINE);
          const round = generateRound(kind, chords, seededRng(seed));
          expect(round).toHaveLength(QUESTIONS_PER_ROUND);
          const poolKeys = new Set(chords.map(quizKey));
          for (const q of round) {
            expect(q.kind).toBe(kind);
            expect(q.options).toHaveLength(OPTION_COUNT);
            expect(new Set(q.options.map(quizKey)).size).toBe(OPTION_COUNT);
            expect(new Set(q.options.map(quizName)).size).toBe(OPTION_COUNT);
            expect(quizKey(q.options[q.correctIndex])).toBe(quizKey(q.answer));
            expect(poolKeys.has(quizKey(q.answer))).toBe(true);
            expect(q.options.every((o) => quizVoicing(o) !== undefined)).toBe(true);
          }
        }
      });
    }
  }

  it("has no enharmonic duplicate of the answer (keys are spelling independent)", () => {
    const q = buildQuestion("name", { rootPc: 1, typeId: "maj", spelling: "flat" }, [], seededRng(3));
    const keys = q.options.map(quizKey);
    expect(keys.filter((k) => k === chordKey(1, "maj"))).toHaveLength(1);
  });

  it("is reproducible for a seed", () => {
    const pool = poolChords("open", []);
    expect(generateRound("name", pool, seededRng(9))).toEqual(generateRound("name", pool, seededRng(9)));
  });

  it("does not repeat answers until the pool is used up", () => {
    const pool = poolChords("open", []);
    expect(pool.length).toBeGreaterThanOrEqual(10);
    const round = generateRound("name", pool, seededRng(4));
    expect(new Set(round.map((q) => quizKey(q.answer))).size).toBe(10);
  });

  it("works with a one-chord pool and an empty pool", () => {
    const round = generateRound("find", [MINE[0]], seededRng(1));
    expect(round).toHaveLength(10);
    expect(round.every((q) => q.options.length === 4)).toBe(true);
    expect(generateRound("find", [], seededRng(1))).toEqual([]);
  });

  it("distractors are plausible: usually share the root, or type with a near root", () => {
    const answer: QuizChord = { rootPc: 7, typeId: "maj", spelling: "sharp" };
    let plausible = 0;
    let total = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const q = buildQuestion("name", answer, [], seededRng(seed));
      for (const o of q.options) {
        if (quizKey(o) === quizKey(answer) || "slash" in o) continue;
        total++;
        const d = Math.min(Math.abs(o.rootPc - 7), 12 - Math.abs(o.rootPc - 7));
        if (o.rootPc === 7 || (o.typeId === "maj" && d <= 2)) plausible++;
      }
    }
    expect(plausible / total).toBeGreaterThan(0.5);
  });

  it("allChords includes slash chords with voicings", () => {
    expect(allChords().some((c) => "slash" in c)).toBe(true);
    const slash = { slash: "D/F#" };
    const q = buildQuestion("find", slash, [slash], seededRng(2));
    expect(q.options).toHaveLength(4);
    expect(quizKey(q.options[q.correctIndex])).toBe("slash:D/F#");
  });
});

describe("recordResults", () => {
  it("adds seen and correct without mutating", () => {
    const before = { "0:maj": { seen: 2, correct: 1 } };
    const after = recordResults(before, [
      { key: "0:maj", correct: true },
      { key: "9:m", correct: false },
      { key: "9:m", correct: true },
    ]);
    expect(after).toEqual({ "0:maj": { seen: 3, correct: 2 }, "9:m": { seen: 2, correct: 1 } });
    expect(before).toEqual({ "0:maj": { seen: 2, correct: 1 } });
  });
});
