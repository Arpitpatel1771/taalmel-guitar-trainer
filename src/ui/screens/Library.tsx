// Library screen (spec 11.4, 11.5). Recent-first list; open/delete/export a
// song; export/import the whole library with conflict resolution.
import { useShell } from "../shell/AppShellContext";

import { useEffect, useMemo, useRef, useState } from "react";
import { Download, Dumbbell, MoreHorizontal, Music, Plus, Search, Trash2, Upload } from "lucide-react";
import { parse } from "../../songFormat";
import { Popover } from "../components/Popover";
import dock from "../components/TransportDock.module.css";
import lib from "./Library.module.css";
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
  showPersistBanner,
  onDismissPersistBanner,
  refreshToken,
}: LibraryProps) {
  const [songs, setSongs] = useState<SongRecord[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<LibraryImportPlan | null>(null);
  const [importError, setImportError] = useState<string | null>(null);
  const { toast } = useShell();
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
      toast("Song deleted.");
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function handleExportSong(record: SongRecord) {
    try {
      const { filename, text } = storage.exportSongFile(record);
      downloadFile(filename, text, "text/plain");
      toast(`Exported ${filename}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleExportLibrary() {
    try {
      const { filename, json } = await storage.exportLibrary();
      downloadFile(filename, json, "application/json");
      toast(`Exported ${filename}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function handleImportFile(file: File) {
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
        toast("Song imported.");
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
      toast(
        `Imported ${summary.imported}, replaced ${summary.replaced}, kept both ${summary.keptBoth}, skipped ${summary.skipped}.`,
      );
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<"updated" | "title">("updated");
  const summaries = useMemo(() => new Map((songs ?? []).map((s) => [s.id, summarize(s.text)])), [songs]);
  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = (songs ?? []).filter((s) => !q || s.title.toLowerCase().includes(q));
    return sort === "title"
      ? [...list].sort((a, b) => a.title.localeCompare(b.title))
      : [...list].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [songs, query, sort]);

  return (
    <div className="screen library-screen">
      <div className="screen-header">
        <h2>Library</h2>
        <button className="btn-primary" onClick={onNewSong}>
          <Plus size={16} /> New song
        </button>
      </div>

      {showPersistBanner && (
        <div className="notice notice-info">
          Storage persistence was not granted by the browser. Export your library regularly to avoid losing it.
          <button onClick={onDismissPersistBanner}>Dismiss</button>
        </div>
      )}
      {error && <div className="notice notice-error">{error}</div>}
      {importError && <div className="notice notice-error">Could not import: {importError}</div>}

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

      {songs !== null && songs.length > 0 && (
        <div className={lib.toolbar}>
          <div className={lib.search}>
            <Search size={15} className={lib.searchIcon} />
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search songs" aria-label="Search songs" />
          </div>
          <select value={sort} onChange={(e) => setSort(e.target.value as "updated" | "title")} aria-label="Sort">
            <option value="updated">Recently updated</option>
            <option value="title">Title A–Z</option>
          </select>
          <span className={lib.spacer} />
          <Popover label="Library actions" icon={<MoreHorizontal size={16} />} iconOnly placement="down" width={220}>
            {(close) => (
              <>
                <button className={dock.menuItem} onClick={() => { close(); void handleExportLibrary(); }}>
                  <Download size={15} /> Export library
                </button>
                <button className={dock.menuItem} onClick={() => { close(); fileInputRef.current?.click(); }}>
                  <Upload size={15} /> Import library or song
                </button>
              </>
            )}
          </Popover>
        </div>
      )}

      {songs === null ? (
        <p className={lib.emptyText}>Loading…</p>
      ) : songs.length === 0 ? (
        <div className={lib.empty}>
          <div className={lib.emptyIcon}>
            <Music size={26} />
          </div>
          <h3>No songs yet</h3>
          <p className={lib.emptyText}>
            Turn a photo of your notes into a timed song with any LLM, or warm up with a generated exercise.
          </p>
          <div className={lib.emptyActions}>
            <button className="btn-primary" onClick={onNewSong}>
              <Plus size={16} /> Import from notes
            </button>
            <button onClick={onOpenExercises}>
              <Dumbbell size={16} /> Try an exercise
            </button>
          </div>
          <button className="btn-ghost" onClick={() => fileInputRef.current?.click()}>
            <Upload size={15} /> Import a library or song file
          </button>
        </div>
      ) : visible.length === 0 ? (
        <p className={lib.emptyText}>No songs match "{query}".</p>
      ) : (
        <ul className={lib.grid}>
          {visible.map((s) => {
            const sum = summaries.get(s.id);
            const maxDensity = sum ? Math.max(1, ...sum.density) : 1;
            return (
              <li key={s.id} className={lib.card} onClick={() => onOpenSong(s.id)}>
                <div className={lib.cardTop}>
                  <button className={lib.title} onClick={(e) => { e.stopPropagation(); onOpenSong(s.id); }}>
                    {s.title}
                  </button>
                  <span onClick={(e) => e.stopPropagation()}>
                    <Popover label={`Actions for ${s.title}`} icon={<MoreHorizontal size={16} />} iconOnly placement="down" width={180}>
                      {(close) => (
                        <>
                          <button className={dock.menuItem} onClick={() => { close(); handleExportSong(s); }}>
                            <Download size={15} /> Export .txt
                          </button>
                          <button className={`${dock.menuItem} ${dock.menuDanger}`} onClick={() => { close(); setConfirmDeleteId(s.id); }}>
                            <Trash2 size={15} /> Delete
                          </button>
                        </>
                      )}
                    </Popover>
                  </span>
                </div>
                <div className={lib.meta}>
                  <span className={lib.metaStrong}>{s.bpm} BPM</span>
                  {sum?.time && <span className={lib.metaStrong}>{sum.time}</span>}
                  {sum && sum.bars > 0 && <span>{sum.bars} bars</span>}
                </div>
                {sum && sum.density.length > 0 && (
                  <div className={lib.density} aria-hidden>
                    {sum.density.map((d, i) => (
                      <span key={i} className={lib.densityBar} style={{ height: `${Math.max(8, (d / maxDensity) * 100)}%` }} />
                    ))}
                  </div>
                )}
                <div className={lib.chips}>
                  {sum?.sections.map((name, i) => (
                    <span key={i} className={lib.chip}>{name}</span>
                  ))}
                  {s.hasVideo && <span className={`${lib.chip} ${lib.chipVideo}`}>Video</span>}
                  {sum && !sum.ok && <span className={`${lib.chip} ${lib.chipError}`}>Has errors</span>}
                </div>
                <div className={lib.foot}>Updated {new Date(s.updatedAt).toLocaleDateString()}</div>
                {confirmDeleteId === s.id && (
                  <div className={lib.confirm} onClick={(e) => e.stopPropagation()}>
                    Delete this song?
                    <button className="btn-danger" onClick={() => void handleDelete(s.id)}>Delete</button>
                    <button className="btn-ghost" onClick={() => setConfirmDeleteId(null)}>Cancel</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {pendingImport && (
        <ConflictDialog plan={pendingImport} onConfirm={(d) => void confirmImport(d)} onCancel={() => setPendingImport(null)} />
      )}
    </div>
  );
}

/** Card details derived from the stored text (text is the source of truth). */
function summarize(text: string): { ok: boolean; time: string | null; bars: number; sections: string[]; density: number[] } {
  const r = parse(text);
  if (!r.ok) return { ok: false, time: null, bars: 0, sections: [], density: [] };
  const bars = r.song.sections.flatMap((sec) => sec.bars);
  // Picked-note starts per bar, capped at 48 columns for the density strip.
  const perBar = bars.map((b) => new Set(b.notes.map((n) => n.startTick)).size);
  const step = Math.max(1, Math.ceil(perBar.length / 48));
  const density: number[] = [];
  for (let i = 0; i < perBar.length; i += step) density.push(Math.max(...perBar.slice(i, i + step)));
  return {
    ok: true,
    time: `${r.song.header.time.numerator}/${r.song.header.time.denominator}`,
    bars: bars.length,
    sections: [...new Set(r.song.sections.map((sec) => sec.name))].slice(0, 5),
    density,
  };
}
