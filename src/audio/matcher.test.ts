import { describe, expect, it } from "vitest";
import { TempoMap } from "../tempo";
import { PPQ, type ExpectedEvent, type Note, type Song, type TimingTiers } from "../model";
import { buildExpectedEvents, Matcher, summarize } from "./matcher";

const TIERS: TimingTiers = { onTimeMs: 30, closeMs: 80, missWindowMs: 150 };

function note(overrides: Partial<Note> & Pick<Note, "string" | "fret" | "startTick">): Note {
  return {
    durationTicks: 480,
    offsetMs: 0,
    uncertain: false,
    meta: {},
    source: { line: 1, column: 1 },
    ...overrides,
  };
}

/** Hand-built two-bar, 4/4, 120bpm song exercising every matcher case. */
function buildSong(notesInput: Note[]): Song {
  const notes = [...notesInput].sort((a, b) => a.startTick - b.startTick || a.string - b.string);
  const barLen = 4 * PPQ;
  return {
    header: { title: "Test", time: { numerator: 4, denominator: 4 }, bpm: 120, unit: 8 },
    sections: [
      {
        name: "A",
        bpm: 120,
        unit: 8,
        bars: [
          {
            number: 1,
            startTick: 0,
            lengthTicks: barLen,
            slots: 8,
            notes: notes.filter((n) => n.startTick < barLen),
          },
          {
            number: 2,
            startTick: barLen,
            lengthTicks: barLen,
            slots: 8,
            notes: notes.filter((n) => n.startTick >= barLen),
          },
        ],
      },
    ],
    notes,
    totalTicks: barLen * 2,
  };
}

// tick0: single picked note (E4, string 1 open).
const N_OPEN_E = note({ string: 1, fret: 0, startTick: 0 });
// tick480: reached by hammer-on -> must be excluded from expected events.
const N_HAMMER = note({ string: 1, fret: 2, startTick: 480, meta: { connection: { kind: "hammer" } } });
// tick960: chord (two picked notes at the same tick) -> pitch check skipped.
const N_CHORD_A = note({ string: 1, fret: 0, startTick: 960 });
const N_CHORD_B = note({ string: 2, fret: 0, startTick: 960 });
// tick1440: never given an onset -> should end up "missed".
const N_MISSED = note({ string: 3, fret: 2, startTick: 1440 });
// tick1920/2400/2880: matched at varying error to hit off/onTime/close tiers.
const N_OFF = note({ string: 4, fret: 0, startTick: 1920 });
const N_ONTIME = note({ string: 5, fret: 0, startTick: 2400 });
const N_CLOSE = note({ string: 6, fret: 0, startTick: 2880 });

const song = buildSong([N_OPEN_E, N_HAMMER, N_CHORD_A, N_CHORD_B, N_MISSED, N_OFF, N_ONTIME, N_CLOSE]);
const tempo = new TempoMap(song);

describe("buildExpectedEvents", () => {
  it("excludes connection-flag notes and groups same-tick picked notes into one chord event", () => {
    const events = buildExpectedEvents(song, tempo);
    const ticks = events.map((e) => e.tick);

    expect(ticks).toEqual([0, 960, 1440, 1920, 2400, 2880]);
    expect(ticks).not.toContain(480);

    const chordEvent = events.find((e) => e.tick === 960)!;
    expect(chordEvent.notes).toHaveLength(2);
    expect(chordEvent.notes.map((n) => n.string)).toEqual([1, 2]);
  });

  it("computes expected time from ticksToSec plus the offsetMs of the earliest-listed note", () => {
    const withOffset = buildSong([note({ string: 1, fret: 0, startTick: 0, offsetMs: -15 })]);
    const t = new TempoMap(withOffset);
    const events = buildExpectedEvents(withOffset, t);
    expect(events[0].timeSec).toBeCloseTo(t.ticksToSec(0) - 0.015, 6);
  });

  it("produces no event for a tick whose only note is a connection-flag note", () => {
    const onlyHammer = buildSong([
      note({ string: 1, fret: 0, startTick: 0 }),
      note({ string: 1, fret: 2, startTick: 480, meta: { connection: { kind: "hammer" } } }),
    ]);
    const t = new TempoMap(onlyHammer);
    const events = buildExpectedEvents(onlyHammer, t);
    expect(events.map((e) => e.tick)).toEqual([0]);
  });

  it("counts a fresh bend as picked but a same-fret bend as a continuation", () => {
    const song = buildSong([
      note({ string: 2, fret: 7, startTick: 0, meta: { connection: { kind: "bend", semitones: 2 } } }), // from nowhere: picked
      note({ string: 2, fret: 7, startTick: 480, meta: { connection: { kind: "bend", semitones: 0 } } }), // same fret: continuation
      note({ string: 2, fret: 9, startTick: 960, meta: { connection: { kind: "bend", semitones: 1 } } }), // new fret: picked
    ]);
    const events = buildExpectedEvents(song, new TempoMap(song));
    expect(events.map((e) => e.tick)).toEqual([0, 960]);
  });
});

describe("Matcher", () => {
  it("classifies matched onsets into on-time / close / off, and leaves the untouched event to be missed", () => {
    const events = buildExpectedEvents(song, tempo);
    const matcher = new Matcher(events, TIERS);

    const onTimeVerdict = matcher.addOnset(tempo.ticksToSec(0)); // 0ms error
    const chordVerdict = matcher.addOnset(tempo.ticksToSec(960) + 0.01); // 10ms
    const offVerdict = matcher.addOnset(tempo.ticksToSec(1920) + 0.1); // 100ms -> off
    const onTime2 = matcher.addOnset(tempo.ticksToSec(2400) + 0.005); // 5ms
    const closeVerdict = matcher.addOnset(tempo.ticksToSec(2880) + 0.05); // 50ms -> close
    const extraVerdict = matcher.addOnset(5.0); // nothing expected anywhere near here

    expect(onTimeVerdict).toMatchObject({ kind: "matched", tier: "onTime" });
    expect(chordVerdict.kind).toBe("matched");
    expect(chordVerdict.tier).toBe("onTime");
    expect(chordVerdict.expected!.notes).toHaveLength(2);
    expect(offVerdict).toMatchObject({ kind: "matched", tier: "off" });
    expect(onTime2).toMatchObject({ kind: "matched", tier: "onTime" });
    expect(closeVerdict).toMatchObject({ kind: "matched", tier: "close" });
    expect(extraVerdict.kind).toBe("extra");
    expect(extraVerdict.expected).toBeUndefined();

    const missedNow = matcher.advance(tempo.ticksToSec(1440) + 0.2);
    expect(missedNow).toHaveLength(1);
    expect(missedNow[0].kind).toBe("missed");
    expect(missedNow[0].expected!.tick).toBe(1440);

    expect(matcher.verdicts()).toHaveLength(7);
  });

  it("skips pitch checking for chord slots but attaches right/wrong/unknown for single-note slots", () => {
    const events = buildExpectedEvents(song, tempo);
    const matcher = new Matcher(events, TIERS);

    const single = matcher.addOnset(tempo.ticksToSec(0)); // expects E4 (string 1 open, midi 64)
    const chord = matcher.addOnset(tempo.ticksToSec(960) + 0.01);
    const wrongPitchOnset = matcher.addOnset(tempo.ticksToSec(2400) + 0.005); // expects A2 (string 5 open, midi 45)
    const lowConfidenceOnset = matcher.addOnset(tempo.ticksToSec(2880) + 0.05);

    matcher.attachPitch(single, 329.63, 0.9); // E4 -> right
    matcher.attachPitch(chord, 329.63, 0.9); // chord -> always skipped
    matcher.attachPitch(wrongPitchOnset, 329.63, 0.9); // E4, wrong pitch class vs expected A -> wrong
    matcher.attachPitch(lowConfidenceOnset, 220, 0.1); // confidence too low -> unknown

    expect(single.pitch).toBe("right");
    expect(chord.pitch).toBe("skipped");
    expect(wrongPitchOnset.pitch).toBe("wrong");
    expect(lowConfidenceOnset.pitch).toBe("unknown");
  });

  it("matches each onset to the nearest unmatched event within the miss window, at most once each", () => {
    const events: ExpectedEvent[] = [
      { tick: 0, timeSec: 1.0, notes: [note({ string: 1, fret: 0, startTick: 0 })] },
      { tick: 480, timeSec: 1.2, notes: [note({ string: 1, fret: 2, startTick: 480 })] },
    ];
    const matcher = new Matcher(events, TIERS);

    const v1 = matcher.addOnset(1.19); // closer to the 1.2s event
    expect(v1.expected!.tick).toBe(480);

    // The 1.0s event is still unmatched, so this onset must bind to it
    // rather than re-claiming the already-used 1.2s event.
    const v2 = matcher.addOnset(1.02);
    expect(v2.expected!.tick).toBe(0);
  });

  it("classifies tier boundaries at the exact threshold values", () => {
    const mkEvents = (): ExpectedEvent[] => [
      { tick: 0, timeSec: 0, notes: [note({ string: 1, fret: 0, startTick: 0 })] },
    ];

    expect(new Matcher(mkEvents(), TIERS).addOnset(0.03).tier).toBe("onTime"); // 30ms
    expect(new Matcher(mkEvents(), TIERS).addOnset(0.0301).tier).toBe("close"); // 30.1ms
    expect(new Matcher(mkEvents(), TIERS).addOnset(0.08).tier).toBe("close"); // 80ms
    expect(new Matcher(mkEvents(), TIERS).addOnset(0.0801).tier).toBe("off"); // 80.1ms
  });

  it("resets matched flags and accumulated verdicts between loop passes", () => {
    const events = buildExpectedEvents(song, tempo);
    const matcher = new Matcher(events, TIERS);

    matcher.addOnset(tempo.ticksToSec(0));
    expect(matcher.verdicts()).toHaveLength(1);

    matcher.reset();
    expect(matcher.verdicts()).toHaveLength(0);

    const again = matcher.addOnset(tempo.ticksToSec(0));
    expect(again.kind).toBe("matched");
  });
});

describe("summarize", () => {
  it("aggregates tier counts, missed/extra, mean signed error, and pitch tallies", () => {
    const events = buildExpectedEvents(song, tempo);
    const matcher = new Matcher(events, TIERS);

    const a = matcher.addOnset(tempo.ticksToSec(0)); // 0ms, onTime
    const b = matcher.addOnset(tempo.ticksToSec(960) + 0.01); // 10ms, onTime, chord
    matcher.addOnset(tempo.ticksToSec(1920) + 0.1); // 100ms, off
    matcher.addOnset(tempo.ticksToSec(2400) + 0.005); // 5ms, onTime
    matcher.addOnset(tempo.ticksToSec(2880) + 0.05); // 50ms, close
    matcher.addOnset(5.0); // extra
    matcher.advance(tempo.ticksToSec(1440) + 0.2); // missed

    matcher.attachPitch(a, 329.63, 0.9); // right
    matcher.attachPitch(b, 329.63, 0.9); // skipped (chord)

    const summary = summarize(matcher.verdicts());

    expect(summary.onTime).toBe(3);
    expect(summary.close).toBe(1);
    expect(summary.off).toBe(1);
    expect(summary.missed).toBe(1);
    expect(summary.extra).toBe(1);
    expect(summary.totalExpected).toBe(6);
    expect(summary.meanSignedErrorMs).toBeCloseTo((0 + 10 + 100 + 5 + 50) / 5, 1);
    expect(summary.pitch).toEqual({ right: 1, wrong: 0, unknown: 0, skipped: 1 });
  });

  it("returns meanSignedErrorMs null when there are no matched onsets", () => {
    const summary = summarize([{ kind: "missed" }, { kind: "extra", onsetSec: 1 }]);
    expect(summary.meanSignedErrorMs).toBeNull();
    expect(summary.missed).toBe(1);
    expect(summary.extra).toBe(1);
  });
});
