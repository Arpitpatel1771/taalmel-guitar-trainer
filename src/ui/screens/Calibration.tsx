// Calibration screen (spec 9.7). Reachable from Settings and from the
// "not calibrated" notice. Storage-agnostic: the parent supplies the current
// calibration and receives the new one to persist.

import { useState } from "react";
import type { Calibration } from "../../model";
import {
  MicError,
  MicInput,
  getAudioContext,
  resumeAudio,
  runLoopbackCalibration,
  runTapCalibration,
} from "../../audio";

export interface CalibrationScreenProps {
  calibration: Calibration | null;
  onSave: (c: Calibration) => void;
  onBack: () => void;
}

type Status =
  | { kind: "idle" }
  | { kind: "running"; method: "loopback" | "tap" }
  | { kind: "failed"; message: string; offerTap: boolean }
  | { kind: "success"; latencyMs: number; detected: number; method: "loopback" | "tap" };

export function CalibrationScreen({ calibration, onSave, onBack }: CalibrationScreenProps) {
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  async function run(method: "loopback" | "tap") {
    setStatus({ kind: "running", method });
    try {
      await resumeAudio();
      const ctx = getAudioContext();
      const mic = await MicInput.start(ctx);
      try {
        const result =
          method === "loopback" ? await runLoopbackCalibration(ctx, mic) : await runTapCalibration(ctx, mic);
        if (result.ok) {
          setStatus({ kind: "success", latencyMs: result.latencyMs, detected: result.detected, method });
        } else {
          setStatus({ kind: "failed", message: result.reason, offerTap: method === "loopback" });
        }
      } finally {
        mic.stop();
      }
    } catch (err) {
      if (err instanceof MicError) {
        setStatus({
          kind: "failed",
          message:
            err.kind === "denied"
              ? "Microphone permission was denied."
              : err.kind === "nodevice"
                ? "No microphone was found."
                : err.message,
          offerTap: false,
        });
      } else {
        setStatus({ kind: "failed", message: err instanceof Error ? err.message : String(err), offerTap: false });
      }
    }
  }

  function save() {
    if (status.kind !== "success") return;
    onSave({ latencyMs: status.latencyMs, method: status.method, measuredAt: new Date().toISOString() });
  }

  return (
    <div className="screen calibration-screen">
      <div className="screen-header">
        <h2>Calibration</h2>
        <button onClick={onBack}>Back</button>
      </div>

      {calibration && (
        <p className="current-calibration">
          Current: {calibration.latencyMs.toFixed(1)} ms ({calibration.method}), measured{" "}
          {new Date(calibration.measuredAt).toLocaleString()}
        </p>
      )}

      <section className="calibration-method">
        <h3>Speaker loopback (recommended)</h3>
        <p>Turn your speakers on, stay quiet, and press start. The app plays 8 clicks and listens for them.</p>
        <button disabled={status.kind === "running"} onClick={() => void run("loopback")}>
          {status.kind === "running" && status.method === "loopback" ? "Listening…" : "Start speaker calibration"}
        </button>
      </section>

      <section className="calibration-method">
        <h3>Tap fallback (headphones)</h3>
        <p>Wear headphones, mute a string, and pluck it on each of the 8 clicks. Less accurate: it includes your own timing.</p>
        <button disabled={status.kind === "running"} onClick={() => void run("tap")}>
          {status.kind === "running" && status.method === "tap" ? "Listening…" : "Start tap calibration"}
        </button>
      </section>

      {status.kind === "failed" && (
        <div className="calibration-result error">
          <p>{status.message}</p>
          {status.offerTap && <p>Try the tap method instead if you're on headphones.</p>}
        </div>
      )}

      {status.kind === "success" && (
        <div className="calibration-result success">
          <p>
            Detected {status.detected} of 8 clicks. Latency: {status.latencyMs.toFixed(1)} ms.
          </p>
          <button className="btn-primary" onClick={save}>
            Save calibration
          </button>
        </div>
      )}
    </div>
  );
}
