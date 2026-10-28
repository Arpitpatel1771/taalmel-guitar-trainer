// String-by-string mic check as a pure state machine (chord practice spec
// section 4). Fed (freq | null, timestamp) samples; no audio or UI here.

import type { Voicing } from "../types";
import { OPEN_STRING_MIDI, centsOff, freqToMidi, midiToFreq, noteName } from "../../audio/tuner";
import type { StringNumber } from "../../model";

/** A reading within this many cents of the expected note counts as right. */
export const TOLERANCE_CENTS = 40;
/** Consecutive right readings (or OK_MS of them) needed to pass a string. */
export const OK_READINGS = 3;
export const OK_MS = 150;
/** A stable wrong note for this long shows the wrong-note message. */
export const WRONG_MS = 400;
/** No stable pitch for this long shows the "nothing clear" message. */
export const SILENCE_MS = 4000;
/** Readings this soon after moving to a string are ignored (previous note ringing). */
export const SETTLE_MS = 250;

export type StringResult = "pending" | "ok" | "wrong" | "skipped" | "muted";

export interface MicHint {
  kind: "wrong" | "nothing";
  /** For "wrong": heard note name, expected note name and the fret to check. */
  heard?: string;
  expected?: string;
  fret?: number;
}

export interface CheckState {
  a4Hz: number;
  /** Fret per string, index 0 = string 6. */
  frets: (number | null)[];
  /** Indices (0 = string 6) of sounding strings, low to high. */
  order: number[];
  /** Position in `order`; === order.length when done. */
  pos: number;
  results: StringResult[];
  done: boolean;
  hint: MicHint | null;
  // attempt tracking
  attemptStart: number | null;
  lastStableAt: number | null;
  okRun: number;
  okStart: number | null;
  wrongMidi: number | null;
  wrongStart: number | null;
}

export type CheckEvent =
  | { type: "ok"; index: number }
  | { type: "wrong"; index: number; heard: string; expected: string; fret: number }
  | { type: "nothing"; index: number }
  | { type: "skipped"; index: number }
  | { type: "done" };

export interface FeedResult {
  state: CheckState;
  events: CheckEvent[];
}

export function expectedMidi(index: number, fret: number): number {
  return OPEN_STRING_MIDI[(6 - index) as StringNumber] + fret;
}

/** Expected note per string (index 0 = string 6); null for muted. */
export function expectedNotes(voicing: Voicing): ({ string: number; midi: number; name: string; fret: number } | null)[] {
  return voicing.frets.map((fret, i) =>
    fret === null ? null : { string: 6 - i, midi: expectedMidi(i, fret), name: noteName(expectedMidi(i, fret)), fret },
  );
}

function freshAttempt(): Pick<CheckState, "attemptStart" | "lastStableAt" | "okRun" | "okStart" | "wrongMidi" | "wrongStart" | "hint"> {
  return { attemptStart: null, lastStableAt: null, okRun: 0, okStart: null, wrongMidi: null, wrongStart: null, hint: null };
}

export function createCheck(voicing: Voicing, a4Hz = 440): CheckState {
  const frets = [...voicing.frets];
  const order = frets.map((f, i) => (f === null ? -1 : i)).filter((i) => i >= 0);
  return {
    a4Hz,
    frets,
    order,
    pos: 0,
    results: frets.map((f) => (f === null ? "muted" : "pending")),
    done: order.length === 0,
    ...freshAttempt(),
  };
}

/** Index (0 = string 6) of the string being checked, or null when done. */
export function currentString(s: CheckState): number | null {
  return s.done ? null : s.order[s.pos];
}

export function currentExpected(s: CheckState): { string: number; midi: number; name: string; fret: number } | null {
  const i = currentString(s);
  return i === null ? null : { string: 6 - i, midi: expectedMidi(i, s.frets[i]!), name: noteName(expectedMidi(i, s.frets[i]!)), fret: s.frets[i]! };
}

function advance(s: CheckState, result: StringResult, events: CheckEvent[]): CheckState {
  const index = s.order[s.pos];
  const results = [...s.results];
  results[index] = result;
  const pos = s.pos + 1;
  const done = pos >= s.order.length;
  if (done) events.push({ type: "done" });
  return { ...s, results, pos, done, ...freshAttempt() };
}

export function feed(state: CheckState, freq: number | null, tMs: number): FeedResult {
  const events: CheckEvent[] = [];
  if (state.done) return { state, events };
  let s = state;
  if (s.attemptStart === null) s = { ...s, attemptStart: tMs, lastStableAt: tMs };
  const index = s.order[s.pos];
  const target = expectedMidi(index, s.frets[index]!);

  if (tMs - s.attemptStart! < SETTLE_MS) return { state: s, events };

  if (freq === null || !(freq > 0)) {
    s = { ...s, okRun: 0, okStart: null, wrongMidi: null, wrongStart: null };
  } else if (Math.abs(centsOff(freq, midiToFreq(target, s.a4Hz))) <= TOLERANCE_CENTS) {
    const okStart = s.okRun === 0 || s.okStart === null ? tMs : s.okStart;
    const okRun = s.okRun + 1;
    s = { ...s, okRun, okStart, wrongMidi: null, wrongStart: null, lastStableAt: tMs };
    if (okRun >= OK_READINGS || tMs - okStart >= OK_MS) {
      events.push({ type: "ok", index });
      return { state: advance(s, "ok", events), events };
    }
  } else {
    const heard = Math.round(freqToMidi(freq, s.a4Hz));
    const same = s.wrongMidi === heard && s.wrongStart !== null;
    const wrongStart = same ? s.wrongStart! : tMs;
    s = { ...s, okRun: 0, okStart: null, wrongMidi: heard, wrongStart };
    if (tMs - wrongStart >= WRONG_MS) {
      s = { ...s, lastStableAt: tMs };
      const already = s.hint?.kind === "wrong" && s.hint.heard === noteName(heard);
      if (!already) {
        const hint: MicHint = { kind: "wrong", heard: noteName(heard), expected: noteName(target), fret: s.frets[index]! };
        s = { ...s, hint };
        events.push({ type: "wrong", index, heard: hint.heard!, expected: hint.expected!, fret: hint.fret! });
      }
    }
  }

  if (s.hint?.kind !== "nothing" && s.hint?.kind !== "wrong" && tMs - s.lastStableAt! >= SILENCE_MS) {
    s = { ...s, hint: { kind: "nothing" } };
    events.push({ type: "nothing", index });
  }
  return { state: s, events };
}

/** Skip the current string (wrong if a wrong-note message was showing, else skipped). */
export function skip(state: CheckState): FeedResult {
  const events: CheckEvent[] = [];
  if (state.done) return { state, events };
  events.push({ type: "skipped", index: state.order[state.pos] });
  const next = advance(state, state.hint?.kind === "wrong" ? "wrong" : "skipped", events);
  return { state: next, events };
}

/** Clear the message and timers for the current string and listen again. */
export function retry(state: CheckState): CheckState {
  return state.done ? state : { ...state, ...freshAttempt() };
}

export interface CheckSummary {
  index: number;
  string: number;
  expected: string | null;
  result: StringResult;
}

export function summary(state: CheckState): CheckSummary[] {
  return state.frets.map((f, i) => ({
    index: i,
    string: 6 - i,
    expected: f === null ? null : noteName(expectedMidi(i, f)),
    result: state.results[i],
  }));
}
