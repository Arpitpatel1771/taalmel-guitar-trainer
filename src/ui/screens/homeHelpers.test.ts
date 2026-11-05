import { describe, expect, it } from "vitest";
import { parse } from "../../songFormat";
import { SAMPLE_SONGS } from "../../samples";
import { detailLine, playStyleFact, previewBars, takeFact, timeOfDayLine } from "./homeHelpers";

const ode = (() => {
  const r = parse(SAMPLE_SONGS.find((s) => s.id === "ode-to-joy")!.text);
  if (!r.ok) throw new Error("sample");
  return r.song;
})();

describe("home helpers", () => {
  it("names the time of day", () => {
    expect(timeOfDayLine(new Date(2026, 10, 5, 19))).toBe("Thursday evening");
    expect(timeOfDayLine(new Date(2026, 10, 5, 8))).toBe("Thursday morning");
    expect(timeOfDayLine(new Date(2026, 10, 6, 14))).toBe("Friday afternoon");
    expect(timeOfDayLine(new Date(2026, 10, 6, 23))).toBe("Friday night");
  });
  it("formats the take fact", () => {
    expect(takeFact({ onTime: 9, total: 12 })).toBe("Last take: 9 of 12 notes on time");
    expect(takeFact(undefined)).toBeNull();
    expect(takeFact({ onTime: 0, total: 0 })).toBeNull();
  });
  it("describes the saved state, never a tempo (practice always starts at the song's tempo)", () => {
    const r = { songId: "x", title: "t", sectionIndex: 0, loop: { startBar: 1, endBar: 8 }, practiceBpm: 96, speed: 80, at: 0 };
    expect(detailLine(null, r)).toBe("bars 1–8 looped");
    expect(detailLine(null, { ...r, loop: { startBar: 3, endBar: 3 } })).toBe("bar 3 looped");
    expect(detailLine(ode, { ...r, loop: null })).not.toMatch(/bpm|%/);
  });
  it("picks a clamped window of bars", () => {
    const total = ode.sections.flatMap((s) => s.bars).length;
    expect(previewBars(ode, { sectionIndex: 0, loop: null }).length).toBe(Math.min(4, total));
    const last = previewBars(ode, { sectionIndex: 0, loop: { startBar: total, endBar: total } });
    expect(last[last.length - 1].number).toBe(total);
    expect(last.length).toBe(Math.min(4, total));
    expect(previewBars(ode, { sectionIndex: 0, loop: { startBar: 2, endBar: 3 } })[0].number).toBe(2);
  });
  it("tells single notes from chords", () => {
    expect(playStyleFact(ode)).toBe("Single notes");
  });
});
