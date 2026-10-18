// Public API of src/recording: capture, clip storage, trimming and saving.

export { listClips, saveClip, renameClip, updateClipFlags, updateClipPeaks, deleteClip, type ClipRecord, type ClipFlag } from "./clipStore";
export {
  pickMimeType,
  extensionFor,
  defaultClipName,
  safeFileName,
  formatClipTime,
  parseClipTime,
  buildTrimPlan,
  windowAround,
  shiftFlagsIntoRange,
  type TrimMode,
  type AudioFormat,
  type TrimPlan,
} from "./media";
export { ClipRecorder, openInput, stopStream, type RecordingResult } from "./recorder";
export { trimClip, type TrimStage } from "./trim";
export { saveBlobToDisk } from "./saveFile";
export { computeClipPeaks, peaksToColumns, PEAK_BUCKETS } from "./waveform";
