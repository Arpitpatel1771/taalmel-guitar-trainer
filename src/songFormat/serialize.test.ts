import { describe, expect, it } from "vitest";
import { parse } from "./parse.js";
import { serialize } from "./serialize.js";

function mustParse(text: string) {
  const r = parse(text);
  if (!r.ok) throw new Error(`fixture failed to parse: ${JSON.stringify(r.errors, null, 2)}`);
  return r.song;
}

describe("serialize: canonical form (spec 5.7)", () => {
  it("produces the exact canonical text for the 5.1 worked example", () => {
    const example = `title: Example Song
time: 4/4
bpm: 94
unit: 8
youtube: https://youtu.be/xxxxxxxxxxx
offset: 12.35

[Intro]
Bar 1: (8) {1} 2S5[2] {3} 1S5 3S7[2] {5} 1S8[4]
Bar 2: (12) {1} 2S5 {2} 2S7 {3} 1S5[4?]

[Verse]
bpm: 100
unit: 16
Bar 3: {1} 1S3 {2} 1S5(hammer) {3} 1S4(pull) {5} 1S3[2>-15]
Bar 4: {1} 2S7 {3} 2S7[2](bend: 2) {5} 2S7[4](bend: 0)
Bar 5: {1} 6S0[4](strum: down) 5S2[4] 4S2[4] {9} 6S0(strum: up, muted)
`;
    const song = mustParse(example);
    const expected = `title: Example Song
time: 4/4
bpm: 94
unit: 8
youtube: https://youtu.be/xxxxxxxxxxx
offset: 12.35

[Intro]
Bar 1: {1} 2S5[2] {3} 1S5 3S7[2] {5} 1S8[4]
Bar 2: (12) {1} 2S5 {2} 2S7 {3} 1S5[4?]

[Verse]
bpm: 100
unit: 16
Bar 3: {1} 1S3 {2} 1S5(hammer) {3} 1S4(pull) {5} 1S3[2>-15]
Bar 4: {1} 2S7 {3} 2S7[2](bend: 2) {5} 2S7[4](bend: 0)
Bar 5: {1} 4S2[4] 5S2[4] 6S0[4](strum: down) {9} 6S0(muted, strum: up)
`;
    expect(serialize(song)).toBe(expected);
  });

  it("header keys are ordered title, time, bpm, unit and omit youtube/offset when absent", () => {
    const song = mustParse("title: T\ntime: 4/4\nbpm: 100\nunit: 8\n\n[A]\nBar 1: {1} 1S0\n");
    const out = serialize(song);
    expect(out.startsWith("title: T\ntime: 4/4\nbpm: 100\nunit: 8\n\n")).toBe(true);
    expect(out).not.toContain("youtube:");
    expect(out).not.toContain("offset:");
  });

  it("(n) is omitted when it equals the effective section unit, present when it differs", () => {
    const song = mustParse(
      "title: T\ntime: 4/4\nbpm: 100\nunit: 8\n\n[A]\nBar 1: (8) {1} 1S0\nBar 2: (16) {1} 1S0\n",
    );
    const out = serialize(song);
    expect(out).toContain("Bar 1: {1} 1S0");
    expect(out).not.toContain("Bar 1: (8)");
    expect(out).toContain("Bar 2: (16) {1} 1S0");
  });

  it("section fields are written in order bpm, unit, only when overriding", () => {
    const song = mustParse(
      "title: T\ntime: 4/4\nbpm: 100\nunit: 8\n\n[A]\nbpm: 120\nunit: 16\nBar 1: {1} 1S0\n",
    );
    const out = serialize(song);
    expect(out).toContain("[A]\nbpm: 120\nunit: 16\nBar 1:");
  });

  it("notes within a slot are ordered by string number ascending", () => {
    const song = mustParse("title: T\ntime: 4/4\nbpm: 100\nunit: 8\n\n[A]\nBar 1: {1} 3S2 1S0 2S1\n");
    const out = serialize(song);
    expect(out).toContain("Bar 1: {1} 1S0 2S1 3S2");
  });

  it("length count uses grid form <k> when a whole number of units", () => {
    const song = mustParse("title: T\ntime: 4/4\nbpm: 100\nunit: 8\n\n[A]\nBar 1: {1} 1S0[3]\n");
    expect(serialize(song)).toContain("1S0[3]");
  });

  it("length count uses <k>X1/<b> fraction form when not a whole number of grid units", () => {
    // 3 sixteenths = 3/16 of a whole note; unit 8 means each slot is an eighth
    // (2/16), so 3 sixteenths does not land on a whole number of slots.
    const song = mustParse("title: T\ntime: 4/4\nbpm: 100\nunit: 8\n\n[A]\nBar 1: {1} 1S0[3X1/16]\n");
    expect(serialize(song)).toContain("1S0[3X1/16]");
  });

  it("offsets are written with an explicit minus for negative, no plus for positive", () => {
    const song = mustParse(
      "title: T\ntime: 4/4\nbpm: 100\nunit: 8\n\n[A]\nBar 1: {1} 1S0[>-15] {2} 1S3[>20]\n",
    );
    const out = serialize(song);
    expect(out).toContain("1S0[>-15]");
    expect(out).toContain("1S3[>20]");
  });

  it("default length (1 unit, no offset, not uncertain) omits the length block entirely", () => {
    const song = mustParse("title: T\ntime: 4/4\nbpm: 100\nunit: 8\n\n[A]\nBar 1: {1} 1S0[1]\n");
    const out = serialize(song);
    expect(out).toContain("Bar 1: {1} 1S0\n");
    expect(out).not.toContain("1S0[");
  });

  it("metadata keys are ordered per the spec 5.6 table regardless of input order", () => {
    const song = mustParse(
      "title: T\ntime: 4/4\nbpm: 100\nunit: 8\n\n[A]\nBar 1: {1} 1S5(strum: up, muted, vibrato)\n",
    );
    const out = serialize(song);
    expect(out).toContain("1S5(vibrato, muted, strum: up)");
  });

  it("bend metadata is written as bend: <semitones>", () => {
    const song = mustParse("title: T\ntime: 4/4\nbpm: 100\nunit: 8\n\n[A]\nBar 1: {1} 2S7 {2} 2S7(bend: 1.5)\n");
    const out = serialize(song);
    expect(out).toContain("2S7(bend: 1.5)");
  });

  it("flat is serialized last in the metadata order", () => {
    // 1S2 -> midi 66 -> F#/Gb, a black key, so flat is valid here.
    const song = mustParse(
      "title: T\ntime: 4/4\nbpm: 100\nunit: 8\n\n[A]\nBar 1: {1} 1S2(flat, vibrato)\n",
    );
    const out = serialize(song);
    expect(out).toContain("1S2(vibrato, flat)");
  });
});
