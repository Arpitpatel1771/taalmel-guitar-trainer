// Calibration screen (spec 9.7). Reachable from Settings and from the
// "not calibrated" notice. Storage-agnostic: the parent supplies the current
// calibration and receives the new one to persist.

import { useState } from "react";
import { CircleAlert, CircleCheck, Headphones, Speaker } from "lucide-react";
import cal from "./Calibration.module.css";
import pg from "../components/page.module.css";
import { Button, Card, IconTile } from "../components/kit";
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
  const [method, setMethod] = useState<"loopback" | "tap">("loopback");
  const [clicks, setClicks] = useState(0);
  const [level, setLevel] = useState(0);

  async function run(method: "loopback" | "tap") {
    setStatus({ kind: "running", method });
    setClicks(0);
    try {
      await resumeAudio();
      const ctx = getAudioContext();
      const mic = await MicInput.start(ctx);
      // Live level meter + click progress (8 clicks, 1 s apart, starting ~0.2 s in).
      mic.onEnvelope((p) => {
        const peak = p.rms.reduce((m, v) => Math.max(m, v), 0);
        const db = 20 * Math.log10(Math.max(peak, 1e-6));
        setLevel(Math.max(0, Math.min(1, (db + 60) / 60)));
      });
      const started = performance.now();
      const timer = window.setInterval(() => setClicks(Math.min(8, Math.floor((performance.now() - started - 200) / 1000) + 1)), 100);
      try {
        const result =
          method === "loopback" ? await runLoopbackCalibration(ctx, mic) : await runTapCalibration(ctx, mic);
        if (result.ok) {
          setStatus({ kind: "success", latencyMs: result.latencyMs, detected: result.detected, method });
        } else {
          setStatus({ kind: "failed", message: result.reason, offerTap: method === "loopback" });
        }
      } finally {
        window.clearInterval(timer);
        setLevel(0);
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

  const running = status.kind === "running";

  return (
    <div className="screen">
      <header className={pg.head}>
        <div className={pg.headText}>
          <h1 className={pg.title}>Calibration</h1>
          <p className={pg.sub}>Your speakers and microphone add a small delay. Measuring it once lets Taalmel judge your timing fairly.</p>
        </div>
        <div className={pg.actions}>
          <Button variant="ghost" onClick={onBack}>
            Done
          </Button>
        </div>
      </header>

      <div className={cal.wrap}>
        <p className={cal.current}>
          {calibration
            ? `Current: ${calibration.latencyMs.toFixed(1)} ms (${calibration.method === "loopback" ? "speakers" : "tap"}), measured ${new Date(calibration.measuredAt).toLocaleString()}.`
            : "Not calibrated yet: mic timing may look late until you do this once."}
        </p>

        <div className={cal.methods} role="radiogroup" aria-label="Calibration method">
          <button
            role="radio"
            aria-checked={method === "loopback"}
            disabled={running}
            className={`${cal.method}${method === "loopback" ? ` ${cal.methodOn}` : ""}`}
            onClick={() => setMethod("loopback")}
          >
            <IconTile size={36}><Speaker size={18} /></IconTile>
            <span className={cal.methodName}>Speakers (recommended)</span>
            <span className={cal.methodDesc}>Speakers on, stay quiet. The app plays 8 clicks and listens for them.</span>
          </button>
          <button
            role="radio"
            aria-checked={method === "tap"}
            disabled={running}
            className={`${cal.method}${method === "tap" ? ` ${cal.methodOn}` : ""}`}
            onClick={() => setMethod("tap")}
          >
            <IconTile size={36}><Headphones size={18} /></IconTile>
            <span className={cal.methodName}>Headphones (tap)</span>
            <span className={cal.methodDesc}>Pluck a muted string on each of 8 clicks. Less accurate: includes your own timing.</span>
          </button>
        </div>

        <Card className={cal.stage}>
          {status.kind === "idle" && (
            <>
              <p className={cal.caption}>{method === "loopback" ? "Turn your speakers up and keep the room quiet." : "Put on headphones and mute a string with your fretting hand."}</p>
              <Button variant="primary" size="lg" className={cal.start} onClick={() => void run(method)}>
                Start
              </Button>
            </>
          )}
          {running && (
            <>
              <div className={cal.dots} aria-label={`Click ${clicks} of 8`}>
                {Array.from({ length: 8 }, (_, i) => (
                  <span key={i} className={`${cal.dot}${i < clicks ? ` ${cal.dotOn}` : ""}`} />
                ))}
              </div>
              <div className={cal.meter} aria-hidden>
                <div className={cal.meterFill} style={{ width: `${level * 100}%` }} />
              </div>
              <p className={cal.caption}>{status.method === "tap" ? "Pluck on every click…" : "Listening… stay quiet"}</p>
            </>
          )}
          {status.kind === "success" && (
            <>
              <span className={cal.good}>
                <CircleCheck size={18} /> Good: heard {status.detected} of 8 clicks
              </span>
              <div className={cal.big}>{status.latencyMs.toFixed(1)} ms</div>
              <div className={cal.row}>
                <Button variant="primary" onClick={save}>
                  Save calibration
                </Button>
                <Button onClick={() => void run(method)}>Retry</Button>
              </div>
            </>
          )}
          {status.kind === "failed" && (
            <>
              <span className={cal.bad}>
                <CircleAlert size={18} /> Calibration failed
              </span>
              <p className={cal.caption}>{status.message}</p>
              {status.offerTap && <p className={cal.caption}>On headphones? Switch to the tap method.</p>}
              <div className={cal.row}>
                <Button variant="primary" onClick={() => void run(method)}>
                  Retry
                </Button>
                {status.offerTap && (
                  <Button onClick={() => { setMethod("tap"); setStatus({ kind: "idle" }); }}>Use tap method</Button>
                )}
              </div>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
