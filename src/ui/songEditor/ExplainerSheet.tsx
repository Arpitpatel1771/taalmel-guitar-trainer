// What "Pitch hints" needs, shown before the browser's share-this-tab prompt.

import { useEffect, useRef } from "react";
import { Button } from "../components/kit";
import s from "./songEditor.module.css";

export function ExplainerSheet({ onContinue, onCancel }: { onContinue: () => void; onCancel: () => void }) {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    ref.current?.focus();
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onCancel();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);
  return (
    <div className={s.scrim} role="presentation" onClick={onCancel}>
      <div className={s.sheet} role="dialog" aria-modal="true" aria-labelledby="hints-title" onClick={(e) => e.stopPropagation()}>
        <h2 id="hints-title">Let Taalmel listen to the video</h2>
        <p>
          The page can't hear the video directly. So your browser will ask to share <strong>this tab</strong>. Pick this tab and turn on <strong>Share tab audio</strong>.
        </p>
        <ul>
          <li>Only the sound is used. Nothing is recorded as video and nothing leaves your device.</li>
          <li>Hints are saved on this device for this video, so you only need to play each part once.</li>
          <li>Hints record only while your own notes and the metronome are silent. Use "Listen to the video only" to switch them off.</li>
          <li>It works in Chrome and Edge on a computer.</li>
        </ul>
        <div className={s.sheetActions}>
          <Button variant="ghost" onClick={onCancel}>
            Not now
          </Button>
          <button ref={ref} type="button" className={s.primaryBtn} onClick={onContinue}>
            Continue
          </button>
        </div>
      </div>
    </div>
  );
}
