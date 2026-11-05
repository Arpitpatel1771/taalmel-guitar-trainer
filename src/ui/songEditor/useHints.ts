// Pitch hints from the video's audio (specs/5-11-piano-roll.md section 5): the stored hints for the
// video, tab-audio capture and the recorder, with the layer toggle the roll draws from.

import { useCallback, useEffect, useRef, useState } from "react";
import { getAudioContext } from "../../audio";
import {
  HintRecorder,
  bucketOf,
  createHintsSaver,
  isTabCaptureSupported,
  loadHints,
  startTabAudioCapture,
  strongestPitch,
  type HintStatus,
  type HintsSaver,
  type VideoHints,
  type VideoState,
} from "../../audio/hints";

export interface HintsHandle {
  supported: boolean;
  /** The heat-map layer is shown. */
  layerOn: boolean;
  hints: VideoHints | null;
  /** Some hints are already stored for this video. */
  hasSaved: boolean;
  recording: boolean;
  status: HintStatus;
  error: string | null;
  /** Changes whenever new frames arrive (redraw while paused). */
  version: number;
  /** Shows the layer (loading what is stored). Resolves true when there is nothing yet and recording is the next step. */
  showLayer(): Promise<boolean>;
  hideLayer(): Promise<void>;
  /** Asks the browser to share this tab's audio and starts recording. */
  startRecording(): Promise<void>;
  /** The clearest pitch heard at a video time (stored or live), or null. */
  pitchAt(videoSec: number): number | null;
  close(): Promise<void>;
}

export function useHints(opts: { videoId: string | undefined; getVideoState: () => VideoState; ownSoundsAudible: () => boolean }): HintsHandle {
  const { videoId } = opts;
  const o = useRef(opts);
  o.current = opts;
  const [layerOn, setLayerOn] = useState(false);
  const [hints, setHints] = useState<VideoHints | null>(null);
  const [recording, setRecording] = useState(false);
  const [status, setStatus] = useState<HintStatus>("stopped");
  const [error, setError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const recorder = useRef<HintRecorder | null>(null);
  const saver = useRef<HintsSaver | null>(null);
  const hintsRef = useRef<VideoHints | null>(null);
  const unsub = useRef<(() => void)[]>([]);
  const lastBump = useRef(0);

  const stopRecording = useCallback(async (): Promise<void> => {
    unsub.current.forEach((u) => u());
    unsub.current = [];
    recorder.current?.stop();
    recorder.current = null;
    setRecording(false);
    setStatus("stopped");
    try {
      await saver.current?.flush();
    } catch {
      /* storage unavailable: hints stay in memory */
    }
    saver.current?.dispose();
    saver.current = null;
  }, []);

  // A different video: drop everything.
  useEffect(() => {
    return () => {
      void stopRecording();
      hintsRef.current = null;
      setHints(null);
      setLayerOn(false);
    };
  }, [videoId, stopRecording]);

  const load = useCallback(async (): Promise<VideoHints | null> => {
    if (!videoId) return null;
    if (hintsRef.current?.videoId === videoId) return hintsRef.current;
    const h = await loadHints(videoId).catch(() => null);
    hintsRef.current = h;
    setHints(h);
    return h;
  }, [videoId]);

  const showLayer = useCallback(async (): Promise<boolean> => {
    setError(null);
    const h = await load();
    setLayerOn(true);
    return !h || h.frames.size === 0;
  }, [load]);

  const hideLayer = useCallback(async (): Promise<void> => {
    await stopRecording();
    setLayerOn(false);
    setError(null);
  }, [stopRecording]);

  const startRecording = useCallback(async (): Promise<void> => {
    setError(null);
    if (!videoId) return;
    if (!isTabCaptureSupported()) {
      setError("Pitch hints need Chrome or Edge on a computer.");
      return;
    }
    const cap = await startTabAudioCapture();
    if (!cap.ok) {
      setError(cap.message);
      return;
    }
    const h = await load();
    if (!h) {
      cap.stream.getTracks().forEach((t) => t.stop());
      setError("Couldn't open the saved hints on this device.");
      return;
    }
    await stopRecording();
    const sv = createHintsSaver(h);
    const rec = new HintRecorder({
      stream: cap.stream,
      context: getAudioContext(),
      hints: h,
      getVideoState: () => o.current.getVideoState(),
      ownSoundsAudible: () => o.current.ownSoundsAudible(),
      onUpdate: () => {
        sv.schedule();
        const now = performance.now();
        if (now - lastBump.current > 250) {
          lastBump.current = now;
          setVersion((v) => v + 1);
        }
      },
    });
    unsub.current = [rec.subscribe(setStatus)];
    // The user can stop sharing from the browser's own bar.
    cap.stream.getAudioTracks()[0]?.addEventListener("ended", () => void stopRecording());
    try {
      await rec.start();
    } catch (err) {
      cap.stream.getTracks().forEach((t) => t.stop());
      sv.dispose();
      setError(err instanceof Error ? err.message : "Couldn't start listening to the video.");
      return;
    }
    saver.current = sv;
    recorder.current = rec;
    setRecording(true);
    setLayerOn(true);
    setStatus(rec.currentStatus);
  }, [videoId, load, stopRecording]);

  const pitchAt = useCallback((videoSec: number): number | null => {
    const h = hintsRef.current;
    if (!h) return null;
    const b = bucketOf(videoSec);
    for (let d = 0; d <= 4; d++) {
      for (const k of d === 0 ? [0] : [-d, d]) {
        const f = h.frames.get(b + k);
        if (f) {
          const p = strongestPitch(f);
          if (p !== null) return p;
        }
      }
    }
    return null;
  }, []);

  const close = useCallback(async (): Promise<void> => {
    await stopRecording();
  }, [stopRecording]);

  return {
    supported: isTabCaptureSupported(),
    layerOn,
    hints,
    hasSaved: !!hints && hints.frames.size > 0,
    recording,
    status,
    error,
    version,
    showLayer,
    hideLayer,
    startRecording,
    pitchAt,
    close,
  };
}
