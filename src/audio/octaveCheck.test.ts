import { describe, expect, it } from "vitest";
import { PPQ, type ExpectedEvent, type Note, type StringNumber, type Verdict } from "../model";
import { soundingMidi } from "../notation";
import { Matcher } from "./matcher";
import { renderPluck } from "./guitarSynth";
import { midiToFreq } from "./tuner";
import { yinWithCheck } from "./yin";

const SR = 48000;
const SLICE = 2048;
const TIERS = { onTimeMs: 30, closeMs: 80, missWindowMs: 150 };

function note(string: StringNumber, fret: number): Note {
  return { string, fret, startTick: 0, durationTicks: PPQ, offsetMs: 0, meta: {}, source: { line: 1, column: 1 } };
}

/** The 2048-sample slice the worklet would deliver: starts 10 ms after the onset. */
function slice(samples: Float32Array): Float32Array {
  const start = Math.round(0.01 * SR);
  return samples.slice(start, start + SLICE);
}

/** Plucked tone with an optional boosted 2nd harmonic (the classic YIN octave trap). */
function tone(freq: number, secondHarmonic = 0): Float32Array {
  const s = slice(renderPluck(freq, SR));
  if (secondHarmonic === 0) return s;
  const peak = Math.max(...Array.from(s, Math.abs));
  for (let i = 0; i < s.length; i++) s[i] += secondHarmonic * peak * Math.sin((2 * Math.PI * 2 * freq * (i + 480)) / SR);
  return s;
}

function judge(string: StringNumber, fret: number, samples: Float32Array, a4Hz = 440): Verdict {
  const midi = soundingMidi(string, fret, 0);
  const n = note(string, fret);
  const ev: ExpectedEvent = { tick: 0, timeSec: 1, notes: [n], capo: 0 };
  const m = new Matcher([ev], TIERS);
  const verdict = m.addOnset(1);
  const { result, check } = yinWithCheck(samples, SR, midiToFreq(midi, a4Hz));
  m.attachPitch(verdict, result?.freq ?? null, result?.confidence ?? 0, { a4Hz, check });
  return verdict;
}

const cases: [StringNumber, number][] = [];
for (const s of [1, 2, 3, 4, 5, 6] as StringNumber[]) for (const f of [0, 5, 12]) cases.push([s, f]);

describe("octave check (spec 5-11-ui-redesign 6.2)", () => {
  for (const [s, f] of cases) {
    const midi = soundingMidi(s, f, 0);
    const label = `string ${s} fret ${f}`;

    it(`${label}: right note is right`, () => {
      const v = judge(s, f, tone(midiToFreq(midi)));
      expect(v.pitch).toBe("right");
      expect(v.playedMidi).toBeUndefined();
    });

    it(`${label}: an octave up is wrong`, () => {
      if (midi + 12 > 84) return; // above ~1 kHz YIN itself folds back (search range tops out at 1400 Hz)
      const v = judge(s, f, tone(midiToFreq(midi + 12)));
      expect(v.pitch).toBe("wrong");
      expect(v.playedMidi).toBe(midi + 12);
    });

    it(`${label}: an octave down is wrong`, () => {
      if (midi - 12 < 40 - 0.5) return; // below the detector's 70 Hz floor
      const v = judge(s, f, tone(midiToFreq(midi - 12)));
      expect(v.pitch).toBe("wrong");
      expect(v.playedMidi).toBe(midi - 12);
    });

    it(`${label}: neighbouring semitone is wrong`, () => {
      for (const d of [-1, 1]) {
        const v = judge(s, f, tone(midiToFreq(midi + d)));
        expect(v.pitch).toBe("wrong");
        expect(v.playedMidi).toBe(midi + d);
      }
    });

    it(`${label}: strong 2nd harmonic stays right`, () => {
      for (const h of [0.5, 1.0, 1.5]) {
        expect(judge(s, f, tone(midiToFreq(midi), h)).pitch).toBe("right");
      }
    });
  }

  it("honours a non-440 A4 reference", () => {
    const midi = soundingMidi(6, 0, 0);
    expect(judge(6, 0, tone(midiToFreq(midi, 432)), 432).pitch).toBe("right");
    expect(judge(6, 0, tone(midiToFreq(midi, 432)), 440).pitch).toBe("right"); // ~32 cents sharp-flat, still within 50
  });

  it("low confidence is unknown, chords are skipped", () => {
    const n1 = note(6, 0);
    const n2 = note(5, 2);
    const m = new Matcher([{ tick: 0, timeSec: 1, notes: [n1], capo: 0 }], TIERS);
    const v = m.addOnset(1);
    m.attachPitch(v, 82.41, 0.2);
    expect(v.pitch).toBe("unknown");
    const mc = new Matcher([{ tick: 0, timeSec: 1, notes: [n1, n2], capo: 0 }], TIERS);
    const vc = mc.addOnset(1);
    mc.attachPitch(vc, 82.41, 0.9);
    expect(vc.pitch).toBe("skipped");
  });
});
