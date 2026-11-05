// Large live level meter for the Recorder screen (spec 5-11-recording-level 1.1):
// shown above the record button so a quiet setup is caught before recording.

import { useInputLevel } from "../../audio";
import { LEVEL_TEXT } from "./levelText";
import st from "./RecorderLevel.module.css";

const SEGMENTS = 20;

export function RecorderLevel({ stream }: { stream: MediaStream }) {
  const level = useInputLevel(stream);
  const text = LEVEL_TEXT[level.state];
  const lit = Math.round((level.bars / 5) * SEGMENTS);
  const showHint = level.state === "tooQuiet" || level.state === "tooLoud";
  return (
    <div className={`${st.level} ${st[text.tone]}`} data-testid="recorder-level" data-state={level.state}>
      <div className={st.row}>
        <div className={st.meter} role="img" aria-label={`Input level: ${text.word}`}>
          {Array.from({ length: SEGMENTS }, (_, i) => (
            <span key={i} className={`${st.seg}${i < lit ? ` ${st.on}` : ""}`} />
          ))}
        </div>
        <span className={st.word}>{text.word}</span>
      </div>
      <p className={st.hint} aria-live="polite">
        {showHint ? text.hint : level.state === "good" ? "Ready to record." : "Play a few notes to check your level."}
      </p>
    </div>
  );
}
