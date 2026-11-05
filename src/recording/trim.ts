// Trimming with ffmpeg.wasm. The ~30 MB core is fetched only on the first
// trim (dynamic import + lazy load), never on app start.

import { buildTrimPlan, extensionFor } from "./media";
import type { FFmpeg } from "@ffmpeg/ffmpeg";

let ffmpegPromise: Promise<FFmpeg> | null = null;
let loadListeners = new Set<(fraction: number | null) => void>();

/** Give up on a download that makes no progress for this long (a dead connection), so the UI can offer Retry. */
const STALL_TIMEOUT_MS = 30_000;
/** Give up if the engine downloaded but never finished starting. */
const START_TIMEOUT_MS = 60_000;

/** Downloads `url` with progress; rejects if no bytes arrive for STALL_TIMEOUT_MS. */
async function fetchWithProgress(url: string, onFraction: (f: number | null) => void): Promise<Blob> {
  const abort = new AbortController();
  let stall = setTimeout(() => abort.abort(), STALL_TIMEOUT_MS);
  const bump = () => {
    clearTimeout(stall);
    stall = setTimeout(() => abort.abort(), STALL_TIMEOUT_MS);
  };
  try {
    const res = await fetch(url, { signal: abort.signal });
    if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);
    const total = Number(res.headers.get("Content-Length")) || 0;
    const reader = res.body.getReader();
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bump();
      chunks.push(value as Uint8Array<ArrayBuffer>);
      received += value.byteLength;
      onFraction(total > 0 ? Math.min(1, received / total) : null);
    }
    return new Blob(chunks, { type: "application/wasm" });
  } catch (err) {
    throw abort.signal.aborted ? new Error("The download stalled. Check your connection and retry.") : err;
  } finally {
    clearTimeout(stall);
  }
}

function withTimeout<T>(p: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(message)), ms);
    p.then(
      (v) => (clearTimeout(t), resolve(v)),
      (e) => (clearTimeout(t), reject(e))
    );
  });
}

/**
 * Loads ffmpeg.wasm once. The 32 MB wasm is fetched here (not inside
 * ffmpeg.load) so callers get download progress and a stall error instead of
 * an endless "loading". The browser's HTTP cache makes later loads fast.
 */
function loadFfmpeg(onProgress?: (fraction: number | null) => void): Promise<FFmpeg> {
  if (onProgress) loadListeners.add(onProgress);
  if (!ffmpegPromise) {
    const report = (f: number | null) => loadListeners.forEach((cb) => cb(f));
    ffmpegPromise = (async () => {
      const [{ FFmpeg }, { default: coreURL }, { default: wasmURL }] = await Promise.all([
        import("@ffmpeg/ffmpeg"),
        import("@ffmpeg/core?url"),
        import("@ffmpeg/core/wasm?url"),
      ]);
      const wasmBlobURL = URL.createObjectURL(await fetchWithProgress(wasmURL, report));
      try {
        const ffmpeg = new FFmpeg();
        await withTimeout(ffmpeg.load({ coreURL, wasmURL: wasmBlobURL }), START_TIMEOUT_MS, "The trimmer failed to start. Retry.");
        return ffmpeg;
      } finally {
        URL.revokeObjectURL(wasmBlobURL);
      }
    })()
      .catch((err) => {
        ffmpegPromise = null; // allow a retry after e.g. a network failure
        throw err;
      })
      .finally(() => {
        loadListeners = new Set();
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
  const ffmpeg = await loadFfmpeg((f) => onProgress?.("loading", f));
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
