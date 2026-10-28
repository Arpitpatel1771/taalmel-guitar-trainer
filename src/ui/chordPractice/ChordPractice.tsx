// Practice tab of the Chords screen: switches between the four practice modes
// (chord practice spec "Shared"). The last mode used is a per-device convenience.

import { useState } from "react";
import type { Settings } from "../../model";
import { Segmented } from "../components/Controls";
import type { PickedChord } from "./picked";
import { OneMinuteChanges } from "./OneMinuteChanges";
import { ChordQuiz } from "./ChordQuiz";
import { Progressions } from "./Progressions";
import { MicCheck } from "./MicCheck";
import st from "./ChordPractice.module.css";

export type PracticeMode = "changes" | "quiz" | "progressions" | "mic";

export interface PracticeModeProps {
  settings: Settings;
  onChange: (next: Settings) => void;
  /** Chord (and voicing) to start with, e.g. from "Check with mic" in the library. */
  initial?: { chord: PickedChord; voicingId?: string };
}

const MODE_KEY = "taalmel.chordPracticeMode";

function readMode(): PracticeMode {
  try {
    const m = localStorage.getItem(MODE_KEY);
    if (m === "changes" || m === "quiz" || m === "progressions" || m === "mic") return m;
  } catch {
    // per-device convenience only
  }
  return "changes";
}

export function ChordPractice({
  settings,
  onChange,
  start,
}: {
  settings: Settings;
  onChange: (next: Settings) => void;
  /** Opens a mode directly with a chord (changes whenever the caller sends a new request). */
  start?: { mode: PracticeMode; chord: PickedChord; voicingId?: string; nonce: number };
}) {
  const [mode, setModeState] = useState<PracticeMode>(start?.mode ?? readMode);
  const [lastNonce, setLastNonce] = useState(start?.nonce);
  if (start && start.nonce !== lastNonce) {
    setLastNonce(start.nonce);
    setModeState(start.mode);
  }

  function setMode(m: PracticeMode) {
    setModeState(m);
    try {
      localStorage.setItem(MODE_KEY, m);
    } catch {
      // ignore
    }
  }

  const initial = start && start.mode === mode ? { chord: start.chord, voicingId: start.voicingId } : undefined;
  const props: PracticeModeProps = { settings, onChange, initial };

  return (
    <div className={st.wrap}>
      <div className={st.modeBar}>
        <Segmented
          label="Practice mode"
          value={mode}
          options={[
            { value: "changes", label: "Changes" },
            { value: "quiz", label: "Quiz" },
            { value: "progressions", label: "Progressions" },
            { value: "mic", label: "Mic check" },
          ]}
          onChange={setMode}
        />
      </div>
      {mode === "changes" && <OneMinuteChanges key={`c${start?.nonce ?? 0}`} {...props} />}
      {mode === "quiz" && <ChordQuiz {...props} />}
      {mode === "progressions" && <Progressions {...props} />}
      {mode === "mic" && <MicCheck key={`m${start?.nonce ?? 0}`} {...props} />}
    </div>
  );
}
