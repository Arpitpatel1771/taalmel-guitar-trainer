// Public API of src/audio (spec 4.1, 9; plan "audio" contract).

export { getAudioContext, resumeAudio } from "./context";

export { Metronome, scheduleClick, buildClickSchedule } from "./metronome";

export {
  OnsetDetector,
  DEFAULT_ONSET_CONFIG,
  type OnsetConfig,
  type OnsetSlice,
  type OnsetProcessResult,
} from "./onsetDetector";

export { MicInput, MicError, type MicErrorKind, type EnvelopeBatch } from "./micInput";

export { yin, DEFAULT_YIN_OPTIONS, type YinOptions, type PitchEstimate } from "./yin";
export { PitchDetector, type PitchResult } from "./pitchDetector";
export {
  TUNING_MIDI,
  midiOf,
  freqToMidi,
  pitchClassOfMidi,
  pitchClassOfFreq,
  pitchClassesMatch,
} from "./pitchClass";

export { buildExpectedEvents, Matcher, summarize, type SessionSummary } from "./matcher";

export {
  computeCalibration,
  runLoopbackCalibration,
  runTapCalibration,
  DEFAULT_CALIBRATION_CONFIG,
  type CalibrationConfig,
  type CalibrationResult,
} from "./calibration";
export { readTuner, midiToFreq, centsOff, noteName, foldOctave, median, OPEN_STRING_MIDI, IN_TUNE_CENTS, type TunerReading } from "./tuner";
export { TunerInput } from "./tunerInput";
