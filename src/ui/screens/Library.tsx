// Library screen (spec 11.4, 11.5). Recent-first list; open/delete/export a
// song; export/import the whole library with conflict resolution.

import { useEffect, useRef, useState } from "react";
import type { SongRecord } from "../../model";
import type { StorageAdapter } from "../storageTypes";
import { ConflictDialog, type ConflictDialogDecisions, type LibraryImportPlan } from "../components/ConflictDialog";

export interface LibraryProps {
  storage: StorageAdapter;
  onOpenSong: (id: string) => void;
  onNewSong: () => void;
  onOpenExercises: () => void;
  onOpenSettings: () => void;
  showPersistBanner: boolean;
  onDismissPersistBanner: () => void;
  refreshToken: number;
}

function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export function Library({
  storage,
  onOpenSong,
  onNewSong,
  onOpenExercises,
  onOpenSettings,
  showPersistBanner,
  onDismissPersistBanner,
  refreshToken,
}: LibraryProps) {
  const [songs, setSongs] = useState<SongRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<LibraryImportPlan | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const [importNotice, setImportNotice] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  async function refresh() {
    try {
      const list = await storage.listSongs();
      setSongs(list);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  useEffect(() => {
    void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshToken]);

  async function handleDelete(id: string) {
    try {
      await storage.deleteSong(id);
      setConfirmDeleteId(null);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleExportSong(record: SongRecord) {
    try {
      const { filename, text } = storage.exportSongFile(record);
      downloadFile(filename, text, "text/plain");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleExportLibrary() {
    try {
      const { filename, json } = await storage.exportLibrary();
      downloadFile(filename, json, "application/json");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleImportFile(file: File) {
    setImportNotice(null);
    const content = await file.text();
    let plan;
    try {
      plan = await storage.parseImportFile(file.name, content);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
      return;
    }
    if (plan.kind === "error") {
      setImportError(plan.message);
      return;
    }
    setImportError(null);
    if (plan.kind === "song") {
      try {
        await storage.applyImport(plan, { onConflict: "skip", importSettings: false });
        setImportNotice("Song imported.");
        await refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
      return;
    }
    setPendingImport(plan);
  }

  async function confirmImport(decisions: ConflictDialogDecisions) {
    if (!pendingImport) return;
    try {
      const onConflict = (id: string) => decisions.perSong[id] ?? "skip";
      const summary = await storage.applyImport(pendingImport, {
        onConflict,
        importSettings: decisions.importSettings,
      });
      setPendingImport(null);
      setImportNotice(
        `Imported ${summary.imported}, replaced ${summary.replaced}, kept both ${summary.keptBoth}, skipped ${summary.skipped}.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="screen library-screen">
      <div className="screen-header">
        <h2>Taalmel</h2>
        <div className="library-actions">
          <button className="btn-primary" onClick={onNewSong}>
            New song from notes
          </button>
          <button onClick={onOpenExercises}>Exercises</button>
          <button onClick={onOpenSettings}>Settings</button>
        </div>
      </div>

      {showPersistBanner && (
        <div className="notice notice-info">
          Storage persistence was not granted by the browser. Export your library regularly to avoid losing it.
          <button onClick={onDismissPersistBanner}>Dismiss</button>
        </div>
      )}

      {error && <div className="notice notice-error">{error}</div>}
      {importError && <div className="notice notice-error">Could not import: {importError}</div>}
      {importNotice && <div className="notice notice-info">{importNotice}</div>}

      <div className="library-import-export">
        <button onClick={() => void handleExportLibrary()}>Export library</button>
        <button onClick={() => fileInputRef.current?.click()}>Import library or song</button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".json,.txt"
          style={{ display: "none" }}
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
            e.target.value = "";
          }}
        />
      </div>

      {songs === null ? (
        <p>Loading…</p>
      ) : songs.length === 0 ? (
        <p className="empty-library">No songs yet. Start with "New song from notes" or the Exercises screen.</p>
      ) : (
        <ul className="song-list">
          {songs.map((s) => (
            <li key={s.id} className="song-row">
              <button className="song-title" onClick={() => onOpenSong(s.id)}>
                {s.title}
              </button>
              <span className="song-meta">
                {s.bpm} BPM{s.hasVideo ? " · video" : ""} · updated {new Date(s.updatedAt).toLocaleDateString()}
              </span>
              <span className="song-row-actions">
                <button onClick={() => handleExportSong(s)}>Export .txt</button>
                {confirmDeleteId === s.id ? (
                  <>
                    <button className="btn-danger" onClick={() => void handleDelete(s.id)}>
                      Confirm delete
                    </button>
                    <button onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                  </>
                ) : (
                  <button onClick={() => setConfirmDeleteId(s.id)}>Delete</button>
                )}
              </span>
            </li>
          ))}
        </ul>
      )}

      {pendingImport && (
        <ConflictDialog plan={pendingImport} onConfirm={(d) => void confirmImport(d)} onCancel={() => setPendingImport(null)} />
      )}
    </div>
  );
}
