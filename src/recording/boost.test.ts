import { describe, expect, it, vi } from "vitest";
import { effectiveGainDb, gainFactor, routeMediaThroughGain, scalePeaks } from "./boost";
import { buildBoostPlan } from "./media";

describe("buildBoostPlan", () => {
  it("re-encodes Opus for WebM audio and copies nothing else", () => {
    const p = buildBoostPlan({ sourceMime: "audio/webm;codecs=opus", hasVideo: false, gainDb: 9 });
    expect(p.args).toEqual(["-i", "boost-input.webm", "-vn", "-af", "volume=9dB", "-c:a", "libopus", "-b:a", "192k", "boost-output.webm"]);
    expect(p.outputMime).toBe("audio/webm");
  });

  it("copies video and re-encodes AAC for MP4, keeping the container", () => {
    const p = buildBoostPlan({ sourceMime: "video/mp4", hasVideo: true, gainDb: 12.345 });
    expect(p.args).toEqual([
      "-i", "boost-input.mp4", "-c:v", "copy", "-af", "volume=12.35dB", "-c:a", "aac", "-b:a", "192k", "-movflags", "+faststart", "boost-output.mp4",
    ]);
    expect(p.outputMime).toBe("video/mp4");
  });

  it("uses AAC in .m4a for audio-only MP4", () => {
    const p = buildBoostPlan({ sourceMime: "audio/mp4", hasVideo: false, gainDb: 6 });
    expect(p.inputName).toBe("boost-input.m4a");
    expect(p.args).toContain("aac");
    expect(p.args).toContain("-vn");
  });

  it("copies the video of WebM video clips", () => {
    const p = buildBoostPlan({ sourceMime: "video/webm", hasVideo: true, gainDb: 6 });
    expect(p.args).toContain("copy");
    expect(p.args).toContain("libopus");
    expect(p.outputMime).toBe("video/webm");
  });
});

describe("gain helpers", () => {
  it("gainFactor is 1 when off and 10^(dB/20) when on", () => {
    expect(gainFactor(9, false)).toBe(1);
    expect(gainFactor(undefined, true)).toBe(1);
    expect(gainFactor(20, true)).toBeCloseTo(10, 5);
  });

  it("effectiveGainDb follows the toggle", () => {
    expect(effectiveGainDb({ gainDb: 9, boost: true })).toBe(9);
    expect(effectiveGainDb({ gainDb: 9, boost: false })).toBe(0);
    expect(effectiveGainDb({})).toBe(0);
  });

  it("scalePeaks scales and caps at 1", () => {
    expect(scalePeaks([0.1, 0.5], 0)).toEqual([0.1, 0.5]);
    const s = scalePeaks([0.1, 0.5], 6.0206);
    expect(s[0]).toBeCloseTo(0.2, 3);
    expect(s[1]).toBe(1);
  });
});

describe("routeMediaThroughGain", () => {
  function fakeCtx() {
    const gain = { gain: { value: 1, setTargetAtTime: vi.fn() }, connect: vi.fn(), disconnect: vi.fn() };
    const source = { connect: vi.fn(), disconnect: vi.fn() };
    const ctx = { currentTime: 0, destination: {}, createGain: () => gain, createMediaElementSource: vi.fn(() => source) };
    return { ctx: ctx as unknown as AudioContext, gain, source, create: ctx.createMediaElementSource };
  }

  it("wires source -> gain -> destination and updates the gain", () => {
    const { ctx, gain, source } = fakeCtx();
    const el = {} as HTMLMediaElement;
    const p = routeMediaThroughGain(ctx, el, 20);
    expect(gain.gain.value).toBeCloseTo(10, 5);
    expect(source.connect).toHaveBeenCalledWith(gain);
    expect(gain.connect).toHaveBeenCalledWith(ctx.destination);
    p.setGainDb(0);
    expect(gain.gain.setTargetAtTime).toHaveBeenCalledWith(1, 0, 0.01);
  });

  it("creates only one source node per element", () => {
    const { ctx, create } = fakeCtx();
    const el = {} as HTMLMediaElement;
    routeMediaThroughGain(ctx, el).dispose();
    routeMediaThroughGain(ctx, el);
    expect(create).toHaveBeenCalledTimes(1);
  });
});
