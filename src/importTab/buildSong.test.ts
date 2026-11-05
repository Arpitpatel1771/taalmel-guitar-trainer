import { describe, expect, it } from "vitest";
import { parse } from "../songFormat/parse.js";
import { buildSongText, sectionsFromSuggestions } from "./buildSong.js";
import type { TimedBar } from "./types.js";

const T44 = { numerator: 4, denominator: 4 };
const bars: TimedBar[] = [
  { slots: 8, events: [{ slot: 1, notes: [{ string: 1, fret: 3 }, { string: 2, fret: 0, technique: { muted: true } }] }, { slot: 5, lengthSlots: 2, notes: [{ string: 1, fret: 5, technique: { connection: { kind: "hammer" } } }] }] },
  { slots: 16, events: [{ slot: 3, notes: [{ string: 1, fret: 3, technique: { connection: { kind: "pull" } } }] }] },
];

describe("buildSongText", () => {
  it("produces canonical text that parses with zero errors", () => {
    const r = buildSongText({ title: "T", artist: "A", time: T44, bpm: 90, unit: 8, capo: 2 }, bars);
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.text).toBe(`title: T
artist: A
time: 4/4
bpm: 90
unit: 8
capo: 2

[Song]
Bar 1: {1} 1S3 2S0(muted) {5} 1S5[2](hammer)
Bar 2: (16) {3} 1S3(pull)
`);
    expect(parse(r.text).ok).toBe(true);
  });

  it("writes youtube and offset, and splits sections", () => {
    const r = buildSongText(
      { title: "T", time: T44, bpm: 90, unit: 8, youtube: "https://youtu.be/dQw4w9WgXcQ", offsetSec: 1.5 },
      bars,
      sectionsFromSuggestions([{ name: "Verse", barIndex: 1 }]),
    );
    if (!r.ok) throw new Error(JSON.stringify(r.errors));
    expect(r.text).toContain("youtube: https://youtu.be/dQw4w9WgXcQ\noffset: 1.5");
    expect(r.song.sections.map((s) => s.name)).toEqual(["Song", "Verse"]);
  });

  it("returns errors instead of invalid text", () => {
    expect(buildSongText({ title: "T", time: T44, bpm: 90, unit: 8, youtube: "nope" }, bars).ok).toBe(false);
    expect(buildSongText({ title: "T", time: T44, bpm: 90, unit: 8, capo: 12 }, [{ slots: 8, events: [{ slot: 1, notes: [{ string: 1, fret: 20 }] }] }]).ok).toBe(false);
    expect(buildSongText({ title: "", time: T44, bpm: 90, unit: 8 }, bars).ok).toBe(false);
    expect(buildSongText({ title: "T", time: T44, bpm: 90, unit: 8 }, [{ slots: 7, events: [] }]).ok).toBe(false);
  });
});
