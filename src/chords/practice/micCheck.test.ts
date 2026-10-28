import { describe, expect, it } from "vitest";
import type { Voicing } from "../types";
import { midiToFreq } from "../../audio/tuner";
import {
  OK_READINGS,
  SETTLE_MS,
  SILENCE_MS,
  WRONG_MS,
  createCheck,
  currentExpected,
  expectedNotes,
  feed,
  retry,
  skip,
  summary,
  type CheckEvent,
  type CheckState,
} from "./micCheck";

// C major open: x32010
const C: Voicing = {
  id: "C:maj:open-C",
  frets: [null, 3, 2, 0, 1, 0],
  fingers: [null, 3, 2, null, 1, null],
  baseFret: 1,
  source: "open",
};
// Expected: s5 C3 (48), s4 E3 (52), s3 G3 (55), s2 C4 (60), s1 E4 (64)
const f = (midi: number, cents = 0) => midiToFreq(midi, 440) * Math.pow(2, cents / 1200);

/** Feeds samples every 50 ms starting at t; returns state, events, next t. */
function play(s: CheckState, freq: number | null, from: number, ms: number) {
  const events: CheckEvent[] = [];
  let t = from;
  for (; t < from + ms; t += 50) {
    const r = feed(s, freq, t);
    s = r.state;
    events.push(...r.events);
  }
  return { s, events, t };
}

describe("expected notes", () => {
  it("lists notes per string and null for muted", () => {
    const n = expectedNotes(C);
    expect(n[0]).toBeNull();
    expect(n[1]).toMatchObject({ string: 5, name: "C3", fret: 3 });
    expect(n[5]).toMatchObject({ string: 1, name: "E4" });
  });
  it("skips muted strings and starts at the lowest sounding one", () => {
    const s = createCheck(C);
    expect(s.order).toEqual([1, 2, 3, 4, 5]);
    expect(s.results[0]).toBe("muted");
    expect(currentExpected(s)).toMatchObject({ string: 5, name: "C3" });
  });
  it("is done at once for an all-muted voicing", () => {
    expect(createCheck({ ...C, frets: [null, null, null, null, null, null] }).done).toBe(true);
  });
});

describe("feed", () => {
  it("passes a string on exact readings", () => {
    const s = createCheck(C);
    const a = play(s, f(48), 0, SETTLE_MS + 50); // settle, then one reading
    expect(a.events).toEqual([]);
    const b = play(a.s, f(48), a.t, 150);
    expect(b.events[0]).toEqual({ type: "ok", index: 1 });
    expect(b.s.results[1]).toBe("ok");
    expect(currentExpected(b.s)?.string).toBe(4);
  });

  it("accepts slightly sharp within tolerance", () => {
    const a = play(createCheck(C), f(48, 35), 0, 600);
    expect(a.events.some((e) => e.type === "ok")).toBe(true);
  });

  it("rejects just outside tolerance as wrong, not ok", () => {
    const a = play(createCheck(C), f(48, 60), 0, 1000);
    expect(a.events.some((e) => e.type === "ok")).toBe(false);
  });

  it("needs consecutive readings: a null resets the run", () => {
    let s = createCheck(C);
    s = feed(s, null, 0).state;
    s = feed(s, f(48), 300).state;
    s = feed(s, f(48), 320).state;
    s = feed(s, null, 340).state;
    const r = feed(s, f(48), 360);
    expect(r.events).toEqual([]);
  });

  it("ignores readings during the settle period", () => {
    let s = createCheck(C);
    s = feed(s, null, 0).state;
    const a = play(s, f(48), 10, SETTLE_MS - 20);
    expect(a.events).toEqual([]);
  });

  it("reports a stable wrong note with heard, expected and fret, then continues", () => {
    const a = play(createCheck(C), f(50), 0, SETTLE_MS + WRONG_MS + 100); // D3
    const w = a.events.find((e) => e.type === "wrong");
    expect(w).toEqual({ type: "wrong", index: 1, heard: "D3", expected: "C3", fret: 3 });
    expect(a.s.hint).toMatchObject({ kind: "wrong", heard: "D3" });
    // fires once
    expect(a.events.filter((e) => e.type === "wrong")).toHaveLength(1);
    // retry continues: now correct, moves on
    const b = play(a.s, f(48), a.t, 300);
    expect(b.events.some((e) => e.type === "ok")).toBe(true);
    expect(b.s.hint).toBeNull();
    expect(b.s.results[1]).toBe("ok");
  });

  it("does not report a wrong note that flips between pitches", () => {
    let s = createCheck(C);
    const events: CheckEvent[] = [];
    for (let t = 0; t < 2000; t += 50) {
      const r = feed(s, t % 100 === 0 ? f(50) : f(53), t);
      s = r.state;
      events.push(...r.events);
    }
    expect(events.some((e) => e.type === "wrong")).toBe(false);
  });

  it("treats an octave error as wrong", () => {
    const a = play(createCheck(C), f(60), 0, SETTLE_MS + WRONG_MS + 100); // C4 instead of C3
    expect(a.events.find((e) => e.type === "wrong")).toMatchObject({ heard: "C4", expected: "C3" });
    expect(a.events.some((e) => e.type === "ok")).toBe(false);
  });

  it("says nothing clear after the silence timeout, once", () => {
    const a = play(createCheck(C), null, 0, SILENCE_MS + 500);
    expect(a.events.filter((e) => e.type === "nothing")).toHaveLength(1);
    expect(a.s.hint).toEqual({ kind: "nothing" });
    expect(play(createCheck(C), null, 0, SILENCE_MS - 200).events).toEqual([]);
  });

  it("still passes after the nothing message", () => {
    const a = play(createCheck(C), null, 0, SILENCE_MS + 100);
    const b = play(a.s, f(48), a.t, 300);
    expect(b.s.results[1]).toBe("ok");
    expect(b.s.hint).toBeNull();
  });
});

describe("skip and retry", () => {
  it("skip marks skipped and moves on", () => {
    const r = skip(createCheck(C));
    expect(r.events[0]).toEqual({ type: "skipped", index: 1 });
    expect(r.state.results[1]).toBe("skipped");
    expect(currentExpected(r.state)?.string).toBe(4);
  });

  it("skip after a wrong-note message records wrong", () => {
    const a = play(createCheck(C), f(50), 0, SETTLE_MS + WRONG_MS + 100);
    expect(skip(a.s).state.results[1]).toBe("wrong");
  });

  it("retry clears the message and restarts the silence timer", () => {
    const a = play(createCheck(C), null, 0, SILENCE_MS + 100);
    const r = retry(a.s);
    expect(r.hint).toBeNull();
    const b = play(r, null, a.t, SILENCE_MS - 500);
    expect(b.events).toEqual([]);
    const c = play(b.s, null, b.t, 1000);
    expect(c.events.some((e) => e.type === "nothing")).toBe(true);
  });
});

describe("whole chord", () => {
  it("finishes after all sounding strings and summarises", () => {
    let s = createCheck(C);
    let t = 0;
    const all: CheckEvent[] = [];
    for (const midi of [48, 52, 55, 60, 64]) {
      const r = play(s, f(midi), t, SETTLE_MS + 300);
      s = r.s;
      t = r.t;
      all.push(...r.events);
    }
    expect(all.filter((e) => e.type === "ok")).toHaveLength(5);
    expect(all.at(-1)).toEqual({ type: "done" });
    expect(s.done).toBe(true);
    expect(summary(s).map((x) => x.result)).toEqual(["muted", "ok", "ok", "ok", "ok", "ok"]);
    expect(feed(s, f(48), t).events).toEqual([]);
  });

  it("mixes results in the summary", () => {
    let s = skip(createCheck(C)).state; // s5 skipped
    for (let i = 0; i < 4; i++) s = skip(s).state;
    expect(s.done).toBe(true);
    expect(summary(s).map((x) => x.result)).toEqual(["muted", "skipped", "skipped", "skipped", "skipped", "skipped"]);
  });

  it("honours a4Hz", () => {
    const a = play(createCheck(C, 432), midiToFreq(48, 432), 0, 600);
    expect(a.events.some((e) => e.type === "ok")).toBe(true);
    expect(OK_READINGS).toBe(3);
  });
});
