import { describe, expect, it } from "vitest";
import { FilterBank, analyzeSignal, midiToFreq, semitoneFrequencies, whitenFrame } from "./bank";
import { HINT_BINS, HINT_FRAME_RATE, HINT_MIDI_MIN } from "./constants";
import { pickOnsets, strongestPitch } from "./detect";
import { RecordingBuffer } from "./recorder";
import { StreamAnalyzer } from "./streamAnalyzer";
import { bucketOf, emptyHints, mergeHints, setFrame } from "./types";
import { computeOnsets, coverageRanges, createVideoSongMapper, framesInRange, uncoveredRanges } from "./query";

const SR = 16000;

function tone(partials: Array<[midi: number, amp: number]>, sec: number, sr = SR, from = 0, into?: Float32Array): Float32Array {
  const out = into ?? new Float32Array(Math.round(sec * sr));
  for (let i = Math.round(from * sr); i < Math.round((from + sec) * sr) && i < out.length; i++) {
    for (const [m, a] of partials) out[i] += a * Math.sin((2 * Math.PI * midiToFreq(m) * i) / sr);
  }
  return out;
}

function lastFrame(samples: Float32Array): Uint8Array {
  const frames = analyzeSignal(samples, SR, HINT_FRAME_RATE);
  return frames[frames.length - 1];
}

const argmax = (f: ArrayLike<number>): number => Array.from(f as ArrayLike<number>).reduce((b, v, i, a) => (v > a[b] ? i : b), 0);

describe("filter bank", () => {
  it("has 49 semitone frequencies from E2", () => {
    const f = semitoneFrequencies();
    expect(f).toHaveLength(HINT_BINS);
    expect(f[0]).toBeCloseTo(82.41, 1);
    expect(f[69 - HINT_MIDI_MIN]).toBeCloseTo(440, 5);
  });

  it("puts a pure A4 in the A4 bin", () => {
    const frame = lastFrame(tone([[69, 0.1]], 0.6));
    expect(argmax(frame) + HINT_MIDI_MIN).toBe(69);
    expect(frame[69 - HINT_MIDI_MIN]).toBeGreaterThan(150);
    expect(strongestPitch(frame)).toBe(69);
  });

  it("reads amplitude about right", () => {
    const amps = new FilterBank(SR).analyze(tone([[69, 0.1]], 0.6));
    expect(amps[69 - HINT_MIDI_MIN]).toBeGreaterThan(0.08);
    expect(amps[69 - HINT_MIDI_MIN]).toBeLessThan(0.12);
  });

  it("shows both notes of a two-tone signal", () => {
    const frame = lastFrame(tone([[57, 0.1], [64, 0.1]], 0.6));
    const bins = [57, 64].map((m) => m - HINT_MIDI_MIN);
    for (const b of bins) expect(frame[b]).toBeGreaterThan(120);
    const others = Array.from(frame).filter((_, i) => !bins.includes(i) && Math.abs(i - bins[0]) > 1 && Math.abs(i - bins[1]) > 1);
    expect(Math.max(...others)).toBeLessThan(Math.min(frame[bins[0]], frame[bins[1]]));
  });

  it("folds harmonics so the fundamental wins over the octave", () => {
    // Fundamental A3 (57) with strong 2nd (A4) and 3rd (E5) harmonics.
    const frame = lastFrame(tone([[57, 0.1], [69, 0.08], [76, 0.06]], 0.6));
    expect(strongestPitch(frame)).toBe(57);
  });

  it("returns null for silence and for unclear frames", () => {
    expect(strongestPitch(lastFrame(new Float32Array(SR / 2)))).toBeNull();
    expect(strongestPitch(new Uint8Array(HINT_BINS).fill(120))).toBeNull();
  });
});

describe("whitening", () => {
  it("subtracts the median and clamps to 0..255", () => {
    const amps = new Float32Array(HINT_BINS).fill(0.001);
    amps[9] = 0.01; // +20 dB over the median
    amps[10] = 1; // +60 dB
    amps[11] = 10;
    const out = whitenFrame(amps);
    expect(out[0]).toBe(0);
    expect(out[9]).toBe(85);
    expect(out[10]).toBe(255);
    expect(out[11]).toBe(255);
    const same = whitenFrame(new Float32Array(HINT_BINS).fill(0.3));
    expect(Array.from(same).every((v) => v === 0)).toBe(true);
  });
});

describe("onsets", () => {
  it("finds the starts of a synthetic note sequence and respects the minimum gap", () => {
    const sig = new Float32Array(SR * 2);
    const starts = [0.3, 0.7, 1.1, 1.5];
    const pitches = [64, 67, 69, 72];
    starts.forEach((s, i) => {
      tone([[pitches[i], 0.1]], 0.3, SR, s, sig);
      // Fade the tail so the note end is not a click.
      for (let n = 0; n < 0.1 * SR; n++) sig[Math.round((s + 0.2) * SR) + n] *= 1 - n / (0.1 * SR);
    });
    const found = pickOnsets(analyzeSignal(sig, SR, HINT_FRAME_RATE), HINT_FRAME_RATE);
    expect(found).toHaveLength(starts.length);
    found.forEach((t, i) => expect(Math.abs(t - starts[i])).toBeLessThan(0.15));
    for (let i = 1; i < found.length; i++) expect(found[i] - found[i - 1]).toBeGreaterThanOrEqual(0.06);
  });

  it("merges flux peaks closer than the minimum gap", () => {
    const frames = [0, 0, 0, 0, 0, 0].map(() => new Uint8Array(HINT_BINS));
    frames[2] = new Uint8Array(HINT_BINS).fill(100);
    frames[3] = new Uint8Array(HINT_BINS).fill(255);
    expect(pickOnsets(frames, 50)).toHaveLength(1);
  });
});

describe("stream analyzer", () => {
  it("emits frames every 20 ms with context times and finds the pitch", () => {
    const an = new StreamAnalyzer(SR);
    const sig = tone([[64, 0.1]], 1);
    const frames = [];
    for (let i = 0; i < sig.length; i += 1024) {
      const block = sig.slice(i, i + 1024);
      frames.push(...an.push(block, 10 + (i + block.length) / SR));
    }
    expect(frames.length).toBeGreaterThan(30);
    expect(frames[1].endTime - frames[0].endTime).toBeCloseTo(0.02, 5);
    expect(strongestPitch(frames[frames.length - 1].frame)).toBe(64);
  });
});

const frameOf = (v: number): Uint8Array => new Uint8Array(HINT_BINS).fill(v);

describe("buckets", () => {
  it("quantizes video time to 20 ms and replaces re-recorded buckets", () => {
    expect(bucketOf(1.0)).toBe(50);
    expect(bucketOf(1.009)).toBe(50);
    expect(bucketOf(1.011)).toBe(51);
    const h = emptyHints("v");
    const rec = new RecordingBuffer(h);
    rec.add(1.0, frameOf(1));
    rec.breakRun();
    rec.add(1.004, frameOf(9));
    expect(h.frames.size).toBe(1);
    expect(h.frames.get(50)![0]).toBe(9);
  });

  it("fills small timing holes in a run but not across pauses", () => {
    const h = emptyHints("v");
    const rec = new RecordingBuffer(h);
    rec.add(1.0, frameOf(1));
    rec.add(1.06, frameOf(2)); // bucket 53: 51, 52 filled
    expect(Array.from(h.frames.keys()).sort()).toEqual([50, 51, 52, 53]);
    rec.add(5, frameOf(3));
    expect(h.frames.size).toBe(5);
    rec.breakRun();
    rec.add(5.1, frameOf(4));
    expect(h.frames.has(251)).toBe(false);
  });

  it("merges hints and marks chunks dirty", () => {
    const a = emptyHints("v");
    const b = emptyHints("v");
    setFrame(b, 600, frameOf(7));
    mergeHints(a, b);
    expect(a.frames.get(600)![0]).toBe(7);
    expect(Array.from(a.dirtyChunks)).toEqual([1]);
  });
});

describe("queries", () => {
  const hints = emptyHints("v");
  for (let b = 50; b < 100; b++) setFrame(hints, b, frameOf(b));
  for (let b = 500; b < 520; b++) setFrame(hints, b, frameOf(1));

  it("returns frames in a video-time range", () => {
    const r = framesInRange(hints, 1.0, 1.1);
    expect(r.map((f) => f.bucket)).toEqual([50, 51, 52, 53, 54, 55]);
    expect(r[0].timeSec).toBeCloseTo(1.0, 9);
    expect(framesInRange(hints, 3, 4)).toEqual([]);
    expect(framesInRange(hints, 0, 100)).toHaveLength(70);
  });

  it("reports coverage and uncovered gaps", () => {
    const cov = coverageRanges(hints);
    expect(cov).toHaveLength(2);
    expect(cov[0].startSec).toBeCloseTo(0.99, 5);
    expect(cov[0].endSec).toBeCloseTo(1.99, 5);
    const gaps = uncoveredRanges(hints, 0, 12);
    expect(gaps).toHaveLength(3);
    expect(gaps[1].startSec).toBeCloseTo(1.99, 5);
    expect(gaps[1].endSec).toBeCloseTo(9.99, 5);
  });

  it("computes onsets per contiguous run in video seconds", () => {
    const h = emptyHints("v");
    for (let b = 100; b < 130; b++) setFrame(h, b, frameOf(0));
    for (let b = 130; b < 160; b++) setFrame(h, b, frameOf(200));
    const onsets = computeOnsets(h);
    expect(onsets).toHaveLength(1);
    expect(onsets[0]).toBeCloseTo(2.6, 5);
  });
});

describe("video <-> song time", () => {
  const tempo = { ticksToSec: (t: number) => t / 480 / 2, secToTicks: (s: number) => s * 2 * 480 }; // 120 bpm
  it("maps with the bar 1 offset", () => {
    const m = createVideoSongMapper(tempo, 3.5);
    expect(m.ticksToVideo(0)).toBeCloseTo(3.5);
    expect(m.ticksToVideo(960)).toBeCloseTo(4.5);
    expect(m.videoToTicks(4.5)).toBeCloseTo(960);
    expect(m.videoToTicks(m.ticksToVideo(1234))).toBeCloseTo(1234);
    expect(m.videoToTicks(3)).toBeLessThan(0); // before bar 1
  });
});
