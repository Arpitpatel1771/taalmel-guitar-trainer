// Trimming with ffmpeg.wasm. The ~30 MB core is fetched only on the first
// trim (dynamic import + lazy load), never on app start.

import { buildTrimPlan, extensionFor } from "./media";
import type { FFmpeg } from "@ffmpeg/ffmpeg";

let ffmpegPromise: Promise<FFmpeg> | null = null;

function loadFfmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { default: coreURL }, { default: wasmURL }] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/core?url"),
        import("@ffmpeg/core/wasm?url"),
      ]);
      const ffmpeg = new FFmpeg();
      await ffmpeg.load({ coreURL, wasmURL });
      return ffmpeg;
    })().catch((err) => {
      ffmpegPromise = null; // allow a retry after e.g. a network failure
      throw err;
    });
  }
  return ffmpegPromise;
}

export type TrimStage = "loading" | "trimming";

export async function trimClip(
  source: Blob,
  /** No startSec/endSec = convert the whole clip (e.g. to MP3). */
  opts: Parameters<typeof buildTrimPlan>[0],
  onProgress?: (stage: TrimStage, fraction: number | null) => void
): Promise<{ blob: Blob; mimeType: string }> {
  onProgress?.("loading", null);
  const ffmpeg = await loadFfmpeg();
  const plan = buildTrimPlan(opts);
  const progress = ({ progress }: { progress: number }) =>
    onProgress?.("trimming", Number.isFinite(progress) ? Math.min(1, Math.max(0, progress)) : null);
  ffmpeg.on("progress", progress);
  onProgress?.("trimming", 0);
  try {
    await ffmpeg.writeFile(plan.inputName, new Uint8Array(await source.arrayBuffer()));
    const code = await ffmpeg.exec(plan.args);
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    const data = await ffmpeg.readFile(plan.outputName);
    if (typeof data === "string" || data.byteLength === 0) throw new Error("Trim produced an empty file");
    return { blob: new Blob([data as Uint8Array<ArrayBuffer>], { type: plan.outputMime }), mimeType: plan.outputMime };
  } finally {
    ffmpeg.off("progress", progress);
    await ffmpeg.deleteFile(plan.inputName).catch(() => {});
    await ffmpeg.deleteFile(plan.outputName).catch(() => {});
  }
}

/** Mono float PCM of a clip's audio at `sampleRate` (waveform fallback when the browser can't decode it). */
export async function extractMonoPcm(source: Blob, sourceMime: string, hasVideo: boolean, sampleRate: number): Promise<Float32Array> {
  const ffmpeg = await loadFfmpeg();
  const inputName = `pcm-input.${extensionFor(sourceMime, hasVideo)}`;
  const outputName = "pcm-output.raw";
  try {
    await ffmpeg.writeFile(inputName, new Uint8Array(await source.arrayBuffer()));
    const code = await ffmpeg.exec(["-i", inputName, "-vn", "-ac", "1", "-ar", String(sampleRate), "-f", "f32le", outputName]);
    if (code !== 0) throw new Error(`ffmpeg exited with code ${code}`);
    const data = await ffmpeg.readFile(outputName);
    if (typeof data === "string") throw new Error("Unexpected text output from ffmpeg");
    return new Float32Array(data.buffer, data.byteOffset, Math.floor(data.byteLength / 4));
  } finally {
    await ffmpeg.deleteFile(inputName).catch(() => {});
    await ffmpeg.deleteFile(outputName).catch(() => {});
  }
}
