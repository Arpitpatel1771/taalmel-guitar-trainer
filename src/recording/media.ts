// Pure helpers for recording formats, file names and ffmpeg trim arguments.

import type { ClipFlag } from "./clipStore";

/** MediaRecorder formats in preference order: MP4 first (plays everywhere), WebM as fallback. */
const VIDEO_TYPES = [
  "video/mp4;codecs=avc1.42E01E,mp4a.40.2",
  "video/mp4;codecs=avc1,mp4a.40.2",
  "video/mp4",
  "video/webm;codecs=vp9,opus",
  "video/webm;codecs=vp8,opus",
  "video/webm",
];
const AUDIO_TYPES = ["audio/mp4;codecs=mp4a.40.2", "audio/mp4", "audio/webm;codecs=opus", "audio/webm", "audio/ogg;codecs=opus"];

/** First supported MIME type, or "" to let the browser pick its default. */
export function pickMimeType(video: boolean, isSupported: (type: string) => boolean): string {
  return (video ? VIDEO_TYPES : AUDIO_TYPES).find(isSupported) ?? "";
}

/** File extension (without dot) for a recorded or trimmed clip. */
export function extensionFor(mimeType: string, hasVideo: boolean): string {
  const base = mimeType.split(";")[0].trim().toLowerCase();
  if (base.endsWith("/mp4")) return hasVideo ? "mp4" : "m4a";
  if (base.endsWith("/ogg")) return "ogg";
  if (base === "audio/mpeg" || base === "audio/mp3") return "mp3";
  return "webm";
}

export function mimeForExtension(ext: string, hasVideo: boolean): string {
  switch (ext) {
    case "mp4":
      return "video/mp4";
    case "m4a":
      return "audio/mp4";
    case "ogg":
      return "audio/ogg";
    case "mp3":
      return "audio/mpeg";
    default:
      return hasVideo ? "video/webm" : "audio/webm";
  }
}

/** "Recording 2026-10-16 14-03" style default clip name (safe as a file name). */
export function defaultClipName(date: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `Recording ${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ${p(date.getHours())}-${p(date.getMinutes())}`;
}

/** Strips characters that aren't allowed in file names on common OSes. */
export function safeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]+/g, "-").trim() || "clip";
}

/** 83.4 -> "1:23.4" */
export function formatClipTime(sec: number): string {
  const s = Math.max(0, sec);
  const m = Math.floor(s / 60);
  const rest = s - m * 60;
  return `${m}:${rest < 10 ? "0" : ""}${rest.toFixed(1)}`;
}

/**
 * Parses a typed time: "4:17", "4:17.5", "1:02:03" (h:m:s) or plain seconds
 * "257". Returns null if it isn't a valid time.
 */
export function parseClipTime(text: string): number | null {
  const parts = text.trim().split(":");
  if (parts.length > 3 || parts.some((p) => !/^\d*\.?\d*$/.test(p.trim()) || p.trim() === "" || p.trim() === ".")) return null;
  const nums = parts.map((p) => Number(p.trim()));
  // Every part but the first is a 0-59 minutes/seconds field.
  if (nums.slice(1).some((n) => n >= 60)) return null;
  if (nums.slice(0, -1).some((n) => !Number.isInteger(n))) return null;
  return nums.reduce((acc, n) => acc * 60 + n, 0);
}

/** The span `padSec` either side of `timeSec`, clamped to the clip. */
export function windowAround(timeSec: number, padSec: number, durationSec: number): { start: number; end: number } {
  return { start: Math.max(0, timeSec - padSec), end: Math.min(durationSec, timeSec + padSec) };
}

/** Flags inside [start, end], re-timed so they stay put on a clip trimmed to that range. */
export function shiftFlagsIntoRange(flags: ClipFlag[], start: number, end: number): ClipFlag[] {
  return flags.filter((f) => f.timeSec >= start && f.timeSec <= end).map((f) => ({ ...f, timeSec: f.timeSec - start }));
}

export type TrimMode = "fast" | "exact";
/** Output for audio-only clips: AAC in .m4a, or MP3 (always re-encoded). */
export type AudioFormat = "m4a" | "mp3";

export interface TrimPlan {
  args: string[];
  inputName: string;
  outputName: string;
  outputMime: string;
}

/**
 * ffmpeg arguments for a trim. "fast" stream-copies (instant, lossless, but
 * the start snaps to the keyframe before `startSec`) and keeps the source
 * format; "exact" re-encodes to H.264/AAC MP4 (or AAC .m4a for audio-only),
 * which is frame-accurate and plays everywhere. Audio-only clips with
 * `audioFormat: "mp3"` always re-encode to 192 kbps MP3, whatever `mode` is.
 * Omitting startSec/endSec converts the whole clip.
 */
export function buildTrimPlan(opts: {
  sourceMime: string;
  hasVideo: boolean;
  startSec?: number;
  endSec?: number;
  mode: TrimMode;
  audioFormat?: AudioFormat;
}): TrimPlan {
  const { sourceMime, hasVideo } = opts;
  const mp3 = !hasVideo && opts.audioFormat === "mp3";
  const mode = mp3 ? "exact" : opts.mode;
  const inExt = extensionFor(sourceMime, hasVideo);
  const outExt = mp3 ? "mp3" : mode === "fast" ? inExt : hasVideo ? "mp4" : "m4a";
  const inputName = `input.${inExt}`;
  const outputName = `output.${outExt}`;
  let seek = ["-i", inputName];
  if (opts.startSec !== undefined && opts.endSec !== undefined) {
    const start = Math.max(0, opts.startSec);
    const duration = Math.max(0.01, opts.endSec - start);
    seek = ["-ss", start.toFixed(3), "-i", inputName, "-t", duration.toFixed(3)];
  }
  const mp4Flags = outExt === "mp4" || outExt === "m4a" ? ["-movflags", "+faststart"] : [];

  let codec: string[];
  if (mode === "fast") {
    codec = ["-c", "copy", "-avoid_negative_ts", "make_zero"];
  } else if (hasVideo) {
    codec = [
      // libx264 + yuv420p need even dimensions.
      "-vf", "scale=trunc(iw/2)*2:trunc(ih/2)*2",
      "-c:v", "libx264", "-preset", "ultrafast", "-crf", "23", "-pix_fmt", "yuv420p",
      "-c:a", "aac", "-b:a", "192k",
    ];
  } else if (mp3) {
    codec = ["-vn", "-c:a", "libmp3lame", "-b:a", "192k"];
  } else {
    codec = ["-vn", "-c:a", "aac", "-b:a", "192k"];
  }
  return { args: [...seek, ...codec, ...mp4Flags, outputName], inputName, outputName, outputMime: mimeForExtension(outExt, hasVideo) };
}
