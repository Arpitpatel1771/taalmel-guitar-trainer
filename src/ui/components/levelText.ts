// Words, colours and advice for each input level state (spec 5-11-recording-level 1.3).

import type { LevelState } from "../../audio";
import type { MeterTone } from "./kit";

export const LEVEL_TEXT: Record<LevelState, { word: string; tone: MeterTone; hint: string }> = {
  waiting: { word: "Listening", tone: "neutral", hint: "Play something and the level will show here." },
  tooQuiet: {
    word: "Too quiet",
    tone: "warn",
    hint: "Move the mic closer to the guitar, or turn up the input level in your computer's sound settings.",
  },
  good: { word: "Good level", tone: "ok", hint: "The level is good." },
  tooLoud: {
    word: "Too loud",
    tone: "off",
    hint: "Move back a little or turn the input down; loud peaks distort the recording.",
  },
};
