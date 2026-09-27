// Tuner panel (spec 10.4): nearest-string or locked-string readout with a
// -50..+50 cent needle. Used full-size on the Tuner screen and compact in the
// practice dock. Owns its own mic stream while mounted and started.

import { useEffect, useRef, useState } from "react";
import { Mic, MicOff } from "lucide-react";
import type { StringNumber } from "../../model";
import { getAudioContext, IN_TUNE_CENTS, MicError, readTuner, resumeAudio, TunerInput, type TunerReading } from "../../audio";
import { Segmented, Stepper } from "./Controls";
import styles from "./Tuner.module.css";

type Lock = "auto" | StringNumber;

export function TunerPanel({
  a4Hz,
  onA4Change,
  compact = false,
  autoStart = false,
}: {
  a4Hz: number;
  onA4Change: (hz: number) => void;
  compact?: boolean;
  autoStart?: boolean;
}) {
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [freq, setFreq] = useState<number | null>(null);
  const [level, setLevel] = useState(0);
  const [lock, setLock] = useState<Lock>("auto");
  const inputRef = useRef<TunerInput | null>(null);

  async function start() {
    setError(null);
    try {
      await resumeAudio();
      inputRef.current = await TunerInput.start(getAudioContext(), (f, l) => {
        setFreq(f);
        setLevel(l);
      });
      setRunning(true);
    } catch (err) {
      setError(
        err instanceof MicError
          ? err.kind === "denied"
            ? "Microphone permission was denied."
            : err.kind === "nodevice"
              ? "No microphone was found."
              : err.message
          : err instanceof Error
            ? err.message
            : String(err),
      );
    }
  }

  function stop() {
    inputRef.current?.stop();
    inputRef.current = null;
    setRunning(false);
    setFreq(null);
    setLevel(0);
  }

  useEffect(() => {
    if (autoStart) void start();
    return () => inputRef.current?.stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const reading: TunerReading | null = freq ? readTuner(freq, a4Hz, lock === "auto" ? undefined : lock) : null;
  const cents = reading ? Math.max(-50, Math.min(50, reading.cents)) : 0;
  const inTune = !!reading && Math.abs(reading.cents) <= IN_TUNE_CENTS;

  return (
    <div className={`${styles.tuner}${compact ? ` ${styles.compact}` : ""}`}>
      <div className={`${styles.note}${inTune ? ` ${styles.inTune}` : ""}`} aria-live="polite">
        {reading ? reading.targetName : "–"}
      </div>
      <div className={styles.sub}>
        {!running
          ? "Tuner off"
          : reading
            ? `String ${reading.string} · ${reading.freq.toFixed(1)} Hz · ${reading.cents > 0 ? "+" : ""}${reading.cents.toFixed(0)} cents${inTune ? " · in tune" : reading.cents > 0 ? " · sharp, tune down" : " · flat, tune up"}`
            : "Play a single open string"}
      </div>
      <div className={styles.meter} aria-hidden>
        <div className={styles.scale} />
        <div className={styles.zone} />
        {[-50, -25, 0, 25, 50].map((c) => (
          <span key={c} className={styles.tick} style={{ left: `${50 + c}%` }} />
        ))}
        {reading && <span className={`${styles.needle}${inTune ? ` ${styles.needleIn}` : ""}`} style={{ left: `${50 + cents}%` }} />}
      </div>
      <div className={styles.labels}>
        <span>-50</span>
        <span>flat</span>
        <span>0</span>
        <span>sharp</span>
        <span>+50</span>
      </div>
      {running && (
        <div className={styles.level} aria-hidden>
          <div className={styles.levelFill} style={{ width: `${level * 100}%` }} />
        </div>
      )}
      <Segmented<Lock>
        label="String"
        value={lock}
        options={[
          { value: "auto", label: "Auto" },
          { value: 6, label: "6 E" },
          { value: 5, label: "5 A" },
          { value: 4, label: "4 D" },
          { value: 3, label: "3 G" },
          { value: 2, label: "2 B" },
          { value: 1, label: "1 e" },
        ]}
        onChange={setLock}
      />
      <div className={styles.row}>
        <span className={styles.sub}>A4 =</span>
        <Stepper label="A4 reference (Hz)" value={a4Hz} min={430} max={450} onChange={onA4Change} />
        <span className={styles.sub}>Hz</span>
        {running ? (
          <button onClick={stop}>
            <MicOff size={15} /> Stop
          </button>
        ) : (
          <button className="btn-primary" onClick={() => void start()}>
            <Mic size={15} /> Start tuner
          </button>
        )}
      </div>
      {error && <div className="notice notice-error">{error}</div>}
    </div>
  );
}
