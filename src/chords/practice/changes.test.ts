import { describe, expect, it } from "vitest";
import type { ChordStats } from "../../model";
import { pairKey, perMinute, recordRun } from "./changes";

const empty: ChordStats = { changes: {}, quiz: {} };

describe("changes helpers", () => {
  it("sorts the pair key", () => {
    expect(pairKey("9:maj", "2:maj")).toBe(pairKey("2:maj", "9:maj"));
    expect(pairKey("b", "a")).toBe("a|b");
  });
  it("normalises per minute", () => {
    expect(perMinute(30, 30)).toBe(60);
    expect(perMinute(25, 120)).toBe(12.5);
    expect(perMinute(5, 0)).toBe(0);
  });
  it("first run with changes is a best", () => {
    const r = recordRun(empty, "a|b", { at: "t", count: 20, seconds: 60 });
    expect(r.isBest).toBe(true);
    expect(r.previousBest).toBeNull();
    expect(r.stats.changes["a|b"].best).toBe(20);
  });
  it("keeps best when beaten rate is lower and compares per minute", () => {
    const a = recordRun(empty, "k", { at: "1", count: 20, seconds: 60 }).stats;
    const b = recordRun(a, "k", { at: "2", count: 15, seconds: 60 });
    expect(b.isBest).toBe(false);
    expect(b.stats.changes.k.best).toBe(20);
    const c = recordRun(b.stats, "k", { at: "3", count: 11, seconds: 30 });
    expect(c.isBest).toBe(true);
    expect(c.stats.changes.k.best).toBe(22);
  });
  it("trims history to 20 and does not mutate", () => {
    let s = empty;
    for (let i = 0; i < 25; i++) s = recordRun(s, "k", { at: String(i), count: i, seconds: 60 }).stats;
    expect(s.changes.k.history).toHaveLength(20);
    expect(s.changes.k.history[0].at).toBe("5");
    expect(empty.changes).toEqual({});
  });
});
