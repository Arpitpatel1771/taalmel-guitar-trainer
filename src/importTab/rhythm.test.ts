import { describe, expect, it } from "vitest";
import { guessRhythm, sequentialRhythm, slotsDivideBar } from "./rhythm.js";
import type { NoteEvent, TabBar } from "./types.js";

const T44 = { numerator: 4, denominator: 4 };
const ev = (column: number, bar: number): NoteEvent => ({ column, bar, notes: [{ string: 1, fret: column }] });
const bar = (index: number, s: number, e: number): TabBar => ({ index, block: 0, startColumn: s, endColumn: e, explicit: true });

describe("guessRhythm", () => {
  it("scales columns to the bar and snaps to the grid", () => {
    const out = guessRhythm([ev(0, 0), ev(4, 0), ev(8, 0), ev(12, 0)], [bar(0, 0, 16)], { time: T44, unit: 8 });
    expect(out[0]!.slots).toBe(8);
    expect(out[0]!.events.map((e) => e.slot)).toEqual([1, 3, 5, 7]);
  });

  it("nudges collisions to the next free slot", () => {
    const out = guessRhythm([ev(0, 0), ev(1, 0), ev(2, 0)], [bar(0, 0, 32)], { time: T44, unit: 8 });
    expect(out[0]!.events.map((e) => e.slot)).toEqual([1, 2, 3]);
  });

  it("uses a finer grid when there are more events than slots", () => {
    const evs = Array.from({ length: 12 }, (_, i) => ev(i, 0));
    const out = guessRhythm(evs, [bar(0, 0, 12)], { time: T44, unit: 8 });
    expect(out[0]!.slots).toBe(16);
    expect(new Set(out[0]!.events.map((e) => e.slot)).size).toBe(12);
  });

  it("pulls a clustered tail back inside the bar", () => {
    const out = guessRhythm([ev(15, 0), ev(15.4, 0), ev(15.6, 0)], [bar(0, 0, 16)], { time: T44, unit: 8 });
    expect(out[0]!.events.map((e) => e.slot)).toEqual([6, 7, 8]);
  });

  it("gives silent bars the default grid and keeps bar order", () => {
    const out = guessRhythm([ev(0, 1)], [bar(0, 0, 8), bar(1, 0, 8)], { time: T44, unit: 8 });
    expect(out[0]!.events).toEqual([]);
    expect(out[1]!.events).toHaveLength(1);
  });

  it("rejects a unit that does not divide the bar", () => {
    expect(() => guessRhythm([], [], { time: T44, unit: 7 })).toThrow();
    expect(slotsDivideBar({ numerator: 7, denominator: 8 }, 16)).toBe(true);
  });
});

describe("sequentialRhythm", () => {
  it("fills one event per slot, unit per bar", () => {
    const evs = Array.from({ length: 10 }, (_, i) => ev(i, 0));
    const out = sequentialRhythm(evs, { time: T44, unit: 8 });
    expect(out.map((b) => b.events.length)).toEqual([8, 2]);
    expect(out[1]!.events.map((e) => e.slot)).toEqual([1, 2]);
  });
});
