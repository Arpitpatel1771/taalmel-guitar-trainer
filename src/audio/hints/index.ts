// Public API of src/audio/hints: pitch hints from the video's audio
// (specs/5-11-piano-roll.md section 5).
//
// Wiring: isTabCaptureSupported() -> startTabAudioCapture() (after the explainer sheet) ->
// loadHints(videoId) + createHintsSaver(hints) -> new HintRecorder({ stream, context:
// getAudioContext(), hints, getVideoState, ownSoundsAudible, onUpdate: saver.schedule }) ->
// recorder.start(). Draw with framesInRange / coverageRanges / onsetsInRange and
// createVideoSongMapper(tempoMap, bar1OffsetSec). recorder.stop() and saver.flush() on close.

export { HINT_MIDI_MIN, HINT_MIDI_MAX, HINT_BINS, HINT_FRAME_RATE, HINT_BUCKET_SEC } from "./constants";
export { midiToFreq, semitoneFrequencies, FilterBank, whitenFrame, analyzeSignal, DEFAULT_BANK_OPTIONS, type BankOptions } from "./bank";
export { strongestPitch, pickOnsets, spectralFlux, DEFAULT_PITCH_OPTIONS, DEFAULT_ONSET_OPTIONS, type PitchOptions, type OnsetOptions } from "./detect";
export { StreamAnalyzer, type StreamFrame } from "./streamAnalyzer";
export { emptyHints, bucketOf, bucketTime, setFrame, mergeHints, HINT_CHUNK_BUCKETS, type VideoHints } from "./types";
export {
  framesInRange,
  coverageRanges,
  uncoveredRanges,
  hasFrameAt,
  onsetsInRange,
  computeOnsets,
  createVideoSongMapper,
  type HintFrame,
  type TimeRange,
  type TickSecMap,
  type VideoSongMapper,
} from "./query";
export { isTabCaptureSupported, startTabAudioCapture, stopCapture, type CaptureFailure, type CaptureResult } from "./capture";
export { HintRecorder, RecordingBuffer, type HintStatus, type VideoState, type HintRecorderOptions } from "./recorder";
export { loadHints, saveHints, clearHints, createHintsSaver, type HintsSaver } from "../../storage/hintsStore";
