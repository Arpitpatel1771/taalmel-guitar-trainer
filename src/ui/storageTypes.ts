// UI-facing storage contract: mirrors `src/storage`'s exports directly (spec
// 11.4, 11.5) so `import * as storage from "../storage"` can be passed
// anywhere a `StorageAdapter` is expected.

import type { Settings, SongRecord } from "../model";
import type { ApplyImportOptions, ImportPlan, ImportSummary } from "../storage";

export type {
  ApplyImportOptions,
  ConflictDecision,
  ImportPlan,
  ImportSummary,
  LibraryExportFile,
  LibrarySongEntry,
  OnConflict,
} from "../storage";

export interface StorageAdapter {
  listSongs(): Promise<SongRecord[]>;
  getSong(id: string): Promise<SongRecord | undefined>;
  saveSong(text: string, id?: string): Promise<SongRecord>;
  deleteSong(id: string): Promise<void>;

  loadSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  requestPersist(): Promise<boolean>;

  exportLibrary(): Promise<{ filename: string; json: string }>;
  exportSongFile(record: SongRecord): { filename: string; text: string };
  parseImportFile(filename: string, content: string): Promise<ImportPlan>;
  applyImport(plan: ImportPlan, opts: ApplyImportOptions): Promise<ImportSummary>;
}
