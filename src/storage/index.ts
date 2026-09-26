// Public API of the storage module (spec 11.4, 11.5). IndexedDB access for
// songs and settings, plus library and single-song export/import.

export { openDb } from "./db.js";
export { listSongs, getSong, saveSong, deleteSong } from "./songs.js";
export { loadSettings, saveSettings, requestPersist } from "./settings.js";
export {
  LIBRARY_FORMAT_VERSION,
  exportLibrary,
  exportSongFile,
  slugify,
  parseImportFile,
  applyImport,
} from "./exportImport.js";
export type {
  ImportPlan,
  ApplyImportOptions,
  ImportSummary,
  ConflictDecision,
  OnConflict,
  LibrarySongEntry,
  LibraryExportFile,
} from "./exportImport.js";
