// Open library tab (spec 2): search, difficulty filter, preview, Add to my songs.

import { useEffect, useMemo, useState } from "react";
import { Check, Eye, Plus, RefreshCw, Search } from "lucide-react";
import type { Settings, SongRecord } from "../../model";
import { parse, type Difficulty, type LibraryEntry } from "./deps";
import { fetchLibrarySong } from "./deps";
import type { StorageAdapter } from "../storageTypes";
import { Button, Card, Chip, Pill } from "../components/kit";
import { useShell } from "../shell/AppShellContext";
import { Dialog } from "./Dialog";
import { SongPreview } from "./SongPreview";
import { addLibraryEntry, updateFromLibrary, updatesFor, useLibraryIndex } from "./libraryData";
import { Ask } from "./AskCommunity";
import st from "./sharing.module.css";

const DIFFS: { id: Difficulty | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "beginner", label: "Beginner" },
  { id: "intermediate", label: "Intermediate" },
  { id: "advanced", label: "Advanced" },
];

export function OpenLibrary({
  storage,
  settings,
  refreshToken,
  onChanged,
  onOpenSong,
  onAsk,
}: {
  storage: StorageAdapter;
  settings: Settings;
  refreshToken: number;
  onChanged: () => void;
  onOpenSong: (id: string) => void;
  onAsk: (prefill: string) => void;
}) {
  const { index, error } = useLibraryIndex();
  const [songs, setSongs] = useState<SongRecord[]>([]);
  const [query, setQuery] = useState("");
  const [diff, setDiff] = useState<Difficulty | "all">("all");
  const [preview, setPreview] = useState<{ entry: LibraryEntry; text: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const { toast } = useShell();

  useEffect(() => {
    void storage.listSongs().then(setSongs, () => {});
  }, [storage, refreshToken]);

  const updates = useMemo(() => updatesFor(songs, index), [songs, index]);
  const linked = useMemo(() => new Map(songs.filter((s) => s.libraryId).map((s) => [s.libraryId!, s])), [songs]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (index?.songs ?? []).filter(
      (e) => (diff === "all" || e.difficulty === diff) && (!q || `${e.title} ${e.artist ?? ""}`.toLowerCase().includes(q)),
    );
  }, [index, query, diff]);

  async function openPreview(entry: LibraryEntry) {
    try {
      setPreview({ entry, text: await fetchLibrarySong(entry) });
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    }
  }

  async function add(entry: LibraryEntry) {
    setBusy(entry.id);
    try {
      const existing = linked.get(entry.id);
      if (existing && updates.has(existing.id)) {
        await updateFromLibrary(storage, existing.id, entry);
        toast(`${entry.title} updated.`);
      } else {
        await addLibraryEntry(storage, entry);
        toast(`${entry.title} added to your songs.`);
      }
      onChanged();
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), "error");
    } finally {
      setBusy(null);
    }
  }

  const previewSong = useMemo(() => {
    if (!preview) return null;
    const p = parse(preview.text);
    return p.ok ? p.song : null;
  }, [preview]);

  return (
    <div className={st.stack}>
      <div className={st.toolbar}>
        <div className={st.search}>
          <Search size={15} className={st.searchIcon} />
          <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search the open library" aria-label="Search the open library" />
        </div>
        <div className={st.chips} role="group" aria-label="Difficulty">
          {DIFFS.map((d) => (
            <Chip key={d.id} on={diff === d.id} onClick={() => setDiff(d.id)}>
              {d.label}
            </Chip>
          ))}
        </div>
      </div>
      <p className={st.muted}>Public-domain songs that come with Taalmel. Add a copy to practise it and edit it.</p>

      {error && <div className="notice notice-error">Could not load the open library: {error}</div>}
      {!index && !error && <p className={st.muted}>Loading…</p>}

      {index && visible.length === 0 && (
        <Card className={st.emptyCard}>
          <p className={st.cardTitle}>Nothing in the open library matches.</p>
          <p className={st.muted}>It only holds public-domain songs. For anything else, ask the community: someone may share their version privately.</p>
          <Ask onAsk={() => onAsk(query)} />
        </Card>
      )}

      <ul className={st.grid}>
        {visible.map((e) => {
          const mine = linked.get(e.id);
          const hasUpdate = !!mine && updates.has(mine.id);
          return (
            <li key={e.id}>
              <Card className={st.songCard}>
                <div className={st.cardHead}>
                  <div>
                    <p className={st.cardTitle}>{e.title}</p>
                    <p className={st.muted}>{e.artist ?? e.credit ?? "Traditional"}</p>
                  </div>
                  {e.difficulty && <Pill>{e.difficulty}</Pill>}
                </div>
                <div className={st.row}>
                  <Button icon={<Eye size={15} />} onClick={() => void openPreview(e)}>
                    Preview
                  </Button>
                  {mine && !hasUpdate ? (
                    <Button variant="ghost" icon={<Check size={15} />} onClick={() => onOpenSong(mine.id)}>
                      In my songs
                    </Button>
                  ) : (
                    <Button
                      variant="primary"
                      icon={hasUpdate ? <RefreshCw size={15} /> : <Plus size={15} />}
                      disabled={busy === e.id}
                      onClick={() => void add(e)}
                    >
                      {hasUpdate ? "Update" : "Add to my songs"}
                    </Button>
                  )}
                  {hasUpdate && <Pill className={st.badge}>Update available</Pill>}
                </div>
              </Card>
            </li>
          );
        })}
      </ul>

      {preview && (
        <Dialog title={preview.entry.title} onClose={() => setPreview(null)} wide>
          {previewSong ? (
            <SongPreview
              song={previewSong}
              settings={settings}
              actions={
                linked.has(preview.entry.id) && !updates.has(linked.get(preview.entry.id)!.id) ? null : (
                  <Button
                    icon={<Plus size={15} />}
                    onClick={() => {
                      void add(preview.entry).then(() => setPreview(null));
                    }}
                  >
                    Add to my songs
                  </Button>
                )
              }
            />
          ) : (
            <div className="notice notice-error">This song could not be read.</div>
          )}
          {preview.entry.credit && <p className={st.muted}>{preview.entry.credit}</p>}
        </Dialog>
      )}
    </div>
  );
}
