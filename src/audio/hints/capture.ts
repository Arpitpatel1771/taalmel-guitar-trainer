// Tab-audio capture (specs/5-11-piano-roll.md section 5.1). The page cannot read the embedded
// YouTube player's audio, but Chromium can share the tab's own audio through getDisplayMedia.

export type CaptureFailure = "unsupported" | "denied" | "no-audio";

export type CaptureResult = { ok: true; stream: MediaStream } | { ok: false; reason: CaptureFailure; message: string };

/** True when this browser can share a tab's audio (Chromium with getDisplayMedia). */
export function isTabCaptureSupported(): boolean {
  if (typeof navigator === "undefined" || !navigator.mediaDevices || typeof navigator.mediaDevices.getDisplayMedia !== "function") return false;
  const ua = navigator.userAgent;
  // Chromium-based (Chrome, Edge, Opera); Firefox and Safari have getDisplayMedia but no tab audio.
  return /Chrome\/|Chromium\/|Edg\//.test(ua) && !/Firefox\//.test(ua);
}

const MESSAGES: Record<CaptureFailure, string> = {
  unsupported: "Pitch hints need Chrome or Edge on a computer.",
  denied: "Sharing was cancelled, so hints are off.",
  "no-audio": "No audio was shared. Choose this tab and tick \"Share tab audio\".",
};

const fail = (reason: CaptureFailure): CaptureResult => ({ ok: false, reason, message: MESSAGES[reason] });

/**
 * Asks the user to share this tab with audio. The video track is stopped at once; the result
 * holds an audio-only stream, or a typed failure.
 */
export async function startTabAudioCapture(): Promise<CaptureResult> {
  if (!isTabCaptureSupported()) return fail("unsupported");
  let stream: MediaStream;
  try {
    const constraints = { video: true, audio: true, preferCurrentTab: true, selfBrowserSurface: "include", systemAudio: "exclude" };
    stream = await navigator.mediaDevices.getDisplayMedia(constraints as DisplayMediaStreamOptions);
  } catch (err) {
    const name = err instanceof DOMException ? err.name : "";
    if (name === "NotSupportedError" || name === "TypeError") return fail("unsupported");
    return fail("denied");
  }
  stream.getVideoTracks().forEach((t) => {
    t.stop();
    stream.removeTrack(t);
  });
  if (stream.getAudioTracks().length === 0) {
    stream.getTracks().forEach((t) => t.stop());
    return fail("no-audio");
  }
  return { ok: true, stream };
}

/** Stops every track of a capture stream. */
export function stopCapture(stream: MediaStream): void {
  stream.getTracks().forEach((t) => t.stop());
}
