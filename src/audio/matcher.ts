// Onset-to-note matching, spec 9.4-9.6.

import type { ExpectedEvent, Note, PitchVerdict, Song, TimingTier, TimingTiers, Verdict } from "../model";
import type { TempoMap } from "../tempo";
import { midiOf, pitchClassesMatch } from "./pitchClass";

/** Below this YIN confidence a matched onset's pitch reads as "unknown". */
const PITCH_CONFIDENCE_THRESHOLD = 0.5;

function isPicked(note: Note): boolean {
  return !note.meta.connection;
}

/**
 * Builds one ExpectedEvent per distinct start tick that has at least one
 * picked note (spec 9.4). Notes reached by hammer/pull/slide/bend are
 * excluded entirely from timing expectations (weak or no attack); if a tick
 * has only such notes, no event is produced for it.
 */
export function buildExpectedEvents(song: Song, tempo: TempoMap): ExpectedEvent[] {
  const groups = new Map<number, Note[]>();
  // A bend is a continuation (not picked) only when it follows a note on the
  // same string at the same fret; a bend "from nowhere" or on a new fret is
  // picked and bent right away, so it has a real attack.
  const lastFret = new Map<number, number>();
  for (const note of song.notes) {
    const prevFret = lastFret.get(note.string);
    lastFret.set(note.string, note.fret);
    const freshBend = note.meta.connection?.kind === "bend" && prevFret !== note.fret;
    if (!isPicked(note) && !freshBend) continue;
    const list = groups.get(note.startTick);
    if (list) {
      list.push(note);
    } else {
      groups.set(note.startTick, [note]);
    }
  }

  const ticks = Array.from(groups.keys()).sort((a, b) => a - b);
  return ticks.map((tick) => {
    const notes = groups.get(tick)!.slice().sort((a, b) => a.string - b.string);
    const timeSec = tempo.ticksToSec(tick) + notes[0].offsetMs / 1000;
    return { tick, timeSec, notes };
  });
}

function classifyTier(absErrorMs: number, tiers: TimingTiers): TimingTier {
  if (absErrorMs <= tiers.onTimeMs) return "onTime";
  if (absErrorMs <= tiers.closeMs) return "close";
  return "off";
}

interface TrackedEvent extends ExpectedEvent {
  matched: boolean;
}

/**
 * Matches onsets (in song seconds, already latency-corrected) against a
 * song's expected events (spec 9.4). One instance is used per playback/loop
 * pass; call `reset()` between passes.
 */
export class Matcher {
  private events: TrackedEvent[];
  private readonly tiers: TimingTiers;
  private list: Verdict[] = [];

  constructor(events: ExpectedEvent[], tiers: TimingTiers) {
    this.events = events.map((e) => ({ ...e, matched: false })).sort((a, b) => a.tick - b.tick);
    this.tiers = tiers;
  }

  /**
   * Records an onset at `songSec`. Matches it to the nearest unmatched
   * expected event within the miss window; if none qualifies, records an
   * "extra" verdict. Always returns (and stores) exactly one verdict.
   */
  addOnset(songSec: number): Verdict {
    const windowSec = this.tiers.missWindowMs / 1000;
    let best: TrackedEvent | null = null;
    let bestDiff = Infinity;
    for (const ev of this.events) {
      if (ev.matched) continue;
      const diff = Math.abs(songSec - ev.timeSec);
      if (diff <= windowSec && diff < bestDiff) {
        best = ev;
        bestDiff = diff;
      }
    }

    let verdict: Verdict;
    if (best) {
      best.matched = true;
      const errorMs = (songSec - best.timeSec) * 1000;
      verdict = {
        kind: "matched",
        expected: best,
        onsetSec: songSec,
        errorMs,
        tier: classifyTier(Math.abs(errorMs), this.tiers),
      };
    } else {
      verdict = { kind: "extra", onsetSec: songSec };
    }

    this.list.push(verdict);
    return verdict;
  }

  /**
   * Call periodically with the current song position. Any unmatched expected
   * event more than the miss window in the past is now "missed"; returns the
   * newly-missed verdicts (also appended to `verdicts()`).
   */
  advance(songSec: number): Verdict[] {
    const windowSec = this.tiers.missWindowMs / 1000;
    const missed: Verdict[] = [];
    for (const ev of this.events) {
      if (ev.matched) continue;
      if (songSec - ev.timeSec > windowSec) {
        ev.matched = true;
        const verdict: Verdict = { kind: "missed", expected: ev };
        missed.push(verdict);
        this.list.push(verdict);
      }
    }
    return missed;
  }

  /**
   * Attaches a pitch verdict to a previously-returned matched verdict (spec
   * 9.5). No-op for missed/extra verdicts. Chord slots (more than one picked
   * note at the expected tick) always read "skipped".
   */
  attachPitch(verdict: Verdict, freq: number | null, confidence: number): void {
    if (verdict.kind !== "matched" || !verdict.expected) return;

    if (verdict.expected.notes.length > 1) {
      verdict.pitch = "skipped";
      return;
    }

    if (freq === null || confidence < PITCH_CONFIDENCE_THRESHOLD) {
      verdict.pitch = "unknown";
      return;
    }

    const note = verdict.expected.notes[0];
    const expectedMidi = midiOf(note.string, note.fret);
    const result: PitchVerdict = pitchClassesMatch(freq, expectedMidi) ? "right" : "wrong";
    verdict.pitch = result;
  }

  /** Clears matched flags and accumulated verdicts for a new loop pass. */
  reset(): void {
    for (const ev of this.events) ev.matched = false;
    this.list = [];
  }

  verdicts(): Verdict[] {
    return this.list;
  }
}

export interface SessionSummary {
  totalExpected: number;
  onTime: number;
  close: number;
  off: number;
  missed: number;
  extra: number;
  /** Mean signed error (onset - expected) in ms across matched onsets; null if none. */
  meanSignedErrorMs: number | null;
  pitch: { right: number; wrong: number; unknown: number; skipped: number };
}

/** Aggregates a matcher's verdicts into the session summary (spec 9.6). */
export function summarize(verdicts: Verdict[]): SessionSummary {
  let onTime = 0;
  let close = 0;
  let off = 0;
  let missed = 0;
  let extra = 0;
  let errSum = 0;
  let errCount = 0;
  const pitch = { right: 0, wrong: 0, unknown: 0, skipped: 0 };
  let totalExpected = 0;

  for (const v of verdicts) {
    if (v.kind === "matched") {
      totalExpected++;
      if (v.tier === "onTime") onTime++;
      else if (v.tier === "close") close++;
      else if (v.tier === "off") off++;
      if (typeof v.errorMs === "number") {
        errSum += v.errorMs;
        errCount++;
      }
      if (v.pitch) pitch[v.pitch]++;
    } else if (v.kind === "missed") {
      totalExpected++;
      missed++;
    } else if (v.kind === "extra") {
      extra++;
    }
  }

  return {
    totalExpected,
    onTime,
    close,
    off,
    missed,
    extra,
    meanSignedErrorMs: errCount > 0 ? errSum / errCount : null,
    pitch,
  };
}
