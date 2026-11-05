// Public API of the song editor core (specs/5-11-piano-roll.md). Pure functions over an immutable EdDoc.

export type { Clip, EdBar, EdDoc, EdNote, EdSection, IntoKind, ModifierKey, OpResult, Problem } from "./types.js";
export {
  barIndexOf,
  barLengthTicks,
  bpmOfBar,
  capoAtTick,
  capoOfBar,
  docFromSong,
  emptyDoc,
  noteById,
  notesInBar,
  sectionIndexOfBar,
  totalTicks,
  unitOfBar,
} from "./doc.js";
export { MAX_FRET, ROLL_MAX_MIDI, ROLL_MIN_MIDI, STRINGS, isBlackKey, maxFret, noteLabel, noteMidi, noteName, positionsFor } from "./pitch.js";
export type { Position } from "./pitch.js";
export { LENGTH_VALUES, MIN_CUT_TICKS, MIN_NOTE_TICKS, SNAP_TICKS, lengthTicks, snapTick } from "./snap.js";
export type { LengthId, SnapId } from "./snap.js";
export { chooseString, findConflicts, playOptions, previousNote } from "./strings.js";
export type { Choice, ChooseOptions, PlayOption } from "./strings.js";
export { checkInto, checkModifier, previousOnString } from "./techniques.js";
export {
  addBars,
  addNote,
  addSection,
  copyNotes,
  cutShort,
  deleteNotes,
  duplicateBars,
  moveNotes,
  moveToString,
  pasteNotes,
  removeLastBars,
  removeSection,
  renameSection,
  resizeNotes,
  ringUntilNext,
  setHeader,
  setInto,
  setLength,
  setOffsetMs,
  setSection,
  setTime,
  setVideoOffset,
  setYoutube,
  shiftStrings,
  toggleModifier,
  transposeOctave,
} from "./ops.js";
export type { HeaderPatch, NewNote } from "./ops.js";
export { lineUpOffset } from "./lineUp.js";
export { docToSong, normalizeDoc, saveDoc, serializeDoc, slotsForBar, validateDoc } from "./save.js";
export type { SaveResult } from "./save.js";
export { HISTORY_CAP, canRedo, canUndo, createHistory, pushHistory, redo, undo } from "./history.js";
export type { History } from "./history.js";
export { tabView } from "./tabView.js";
export type { TabCell, TabView, TabViewOptions } from "./tabView.js";
export { addAtPlayhead, placeNextAt } from "./live.js";
export { docFromTab, guessTabTitle, summarizeTab } from "./fromTab.js";
export type { TabDocResult, TabSummary } from "./fromTab.js";
export { positionText } from "./position.js";
