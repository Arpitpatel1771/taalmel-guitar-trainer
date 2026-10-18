import { describe, expect, it } from "vitest";
import { buildTrimPlan, shiftFlagsIntoRange, windowAround, defaultClipName, extensionFor, formatClipTime, parseClipTime, pickMimeType, safeFileName } from "./media";

describe("recording media helpers", () => {
  it("prefers MP4 and falls back to WebM", () => {
    expect(pickMimeType(true, (t) => t.startsWith("video/mp4"))).toMatch(/^video\/mp4/);
    expect(pickMimeType(true, (t) => t.startsWith("video/webm"))).toBe("video/webm;codecs=vp9,opus");
    expect(pickMimeType(false, (t) => t === "audio/webm;codecs=opus")).toBe("audio/webm;codecs=opus");
    expect(pickMimeType(true, () => false)).toBe("");
  });

  it("maps MIME types to extensions", () => {
    expect(extensionFor("video/mp4;codecs=avc1", true)).toBe("mp4");
    expect(extensionFor("audio/mp4", false)).toBe("m4a");
    expect(extensionFor("video/webm;codecs=vp9,opus", true)).toBe("webm");
    expect(extensionFor("audio/webm;codecs=opus", false)).toBe("webm");
    expect(extensionFor("audio/ogg", false)).toBe("ogg");
  });

  it("builds file-name-safe default names and times", () => {
    expect(defaultClipName(new Date(2026, 9, 6, 9, 5))).toBe("Recording 2026-10-06 09-05");
    expect(safeFileName('a/b:c*?"<>|')).toBe("a-b-c-");
    expect(safeFileName("   ")).toBe("clip");
    expect(formatClipTime(83.44)).toBe("1:23.4");
    expect(formatClipTime(5)).toBe("0:05.0");
  });

  it("parses typed times as m:ss, h:mm:ss or plain seconds", () => {
    expect(parseClipTime("4:17")).toBe(257);
    expect(parseClipTime(" 4:17.5 ")).toBe(257.5);
    expect(parseClipTime("0:05")).toBe(5);
    expect(parseClipTime("1:02:03")).toBe(3723);
    expect(parseClipTime("257")).toBe(257);
    expect(parseClipTime("12.3")).toBe(12.3);
    expect(parseClipTime(":30")).toBeNull();
    expect(parseClipTime("4:75")).toBeNull();
    expect(parseClipTime("1.5:00")).toBeNull();
    expect(parseClipTime("abc")).toBeNull();
    expect(parseClipTime("")).toBeNull();
    expect(parseClipTime("1:2:3:4")).toBeNull();
    // Round-trips with the display format.
    expect(parseClipTime(formatClipTime(257.5))).toBe(257.5);
  });

  it("fast trim stream-copies and keeps the source format", () => {
    const plan = buildTrimPlan({ sourceMime: "video/webm;codecs=vp9", hasVideo: true, startSec: 1.5, endSec: 4, mode: "fast" });
    expect(plan.inputName).toBe("input.webm");
    expect(plan.outputName).toBe("output.webm");
    expect(plan.outputMime).toBe("video/webm");
    expect(plan.args).toEqual(["-ss", "1.500", "-i", "input.webm", "-t", "2.500", "-c", "copy", "-avoid_negative_ts", "make_zero", "output.webm"]);
  });

  it("fast trim of audio-only WebM stays audio/webm", () => {
    const plan = buildTrimPlan({ sourceMime: "audio/webm;codecs=opus", hasVideo: false, startSec: 0, endSec: 1, mode: "fast" });
    expect(plan.outputMime).toBe("audio/webm");
  });

  it("exact trim re-encodes video to H.264/AAC MP4", () => {
    const plan = buildTrimPlan({ sourceMime: "video/webm", hasVideo: true, startSec: 0, endSec: 10, mode: "exact" });
    expect(plan.outputName).toBe("output.mp4");
    expect(plan.outputMime).toBe("video/mp4");
    expect(plan.args).toContain("libx264");
    expect(plan.args.slice(-3)).toEqual(["-movflags", "+faststart", "output.mp4"]);
  });

  it("MP3 output always re-encodes audio-only clips with LAME", () => {
    const plan = buildTrimPlan({ sourceMime: "audio/mp4", hasVideo: false, startSec: 1, endSec: 3, mode: "fast", audioFormat: "mp3" });
    expect(plan.outputName).toBe("output.mp3");
    expect(plan.outputMime).toBe("audio/mpeg");
    expect(plan.args).toEqual(["-ss", "1.000", "-i", "input.m4a", "-t", "2.000", "-vn", "-c:a", "libmp3lame", "-b:a", "192k", "output.mp3"]);
    expect(extensionFor(plan.outputMime, false)).toBe("mp3");
  });

  it("converts the whole clip when no range is given", () => {
    const plan = buildTrimPlan({ sourceMime: "audio/webm", hasVideo: false, mode: "exact", audioFormat: "mp3" });
    expect(plan.args.slice(0, 2)).toEqual(["-i", "input.webm"]);
    expect(plan.args).not.toContain("-ss");
  });

  it("ignores audioFormat for video clips", () => {
    const plan = buildTrimPlan({ sourceMime: "video/mp4", hasVideo: true, startSec: 0, endSec: 1, mode: "exact", audioFormat: "mp3" });
    expect(plan.outputName).toBe("output.mp4");
  });

  it("exact trim of audio-only clips produces AAC .m4a", () => {
    const plan = buildTrimPlan({ sourceMime: "audio/webm;codecs=opus", hasVideo: false, startSec: 2, endSec: 3, mode: "exact" });
    expect(plan.outputName).toBe("output.m4a");
    expect(plan.outputMime).toBe("audio/mp4");
    expect(plan.args).toContain("-vn");
    expect(plan.args).not.toContain("libx264");
  });

  it("windowAround clamps to the clip", () => {
    expect(windowAround(30, 10, 100)).toEqual({ start: 20, end: 40 });
    expect(windowAround(4, 10, 100)).toEqual({ start: 0, end: 14 });
    expect(windowAround(95, 10, 100)).toEqual({ start: 85, end: 100 });
  });

  it("shiftFlagsIntoRange keeps flags in range and re-times them", () => {
    const flags = [
      { id: "a", timeSec: 5, label: "A" },
      { id: "b", timeSec: 20, label: "B" },
      { id: "c", timeSec: 40, label: "C" },
    ];
    expect(shiftFlagsIntoRange(flags, 10, 40)).toEqual([
      { id: "b", timeSec: 10, label: "B" },
      { id: "c", timeSec: 30, label: "C" },
    ]);
  });
});
