// "Add a song" (spec 5-11-piano-roll.md section 7): paste a tab or start from scratch (both open
// the song editor), or use the existing Taalmel-text and AI-chat paths (NewSong).

import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ArrowRight, Bot, FileText, Library, Music2, OctagonAlert, PencilLine, Trash2 } from "lucide-react";
import type { Settings } from "../../model";
import { parseYouTubeId } from "../../songFormat";
import { docFromTab, emptyDoc, guessTabTitle, summarizeTab } from "../../songEditor";
import { parseTempo } from "../../importTab/parseTempo";
import { tapTempo } from "../../importTab/tapTempo";
import { deleteEditorDraft, listEditorDrafts, type EditorDraft } from "../../storage/importDrafts";
import { Button, Card, IconTile, Pill } from "../components/kit";
import type { EditorStart } from "../songEditor/editorInit";
import { NewSong } from "./NewSong";
import st from "./AddSong.module.css";
import pg from "../components/page.module.css";

export interface AddSongProps {
  settings: Settings;
  onSaveSong: (text: string) => Promise<{ ok: true; id: string } | { ok: false; message: string }>;
  onSaved: (id: string) => void;
  onCancel: () => void;
  /** Opens the song editor. */
  onOpenEditor: (start: EditorStart) => void;
  /** Opens the shared library; the choice is disabled ("Coming soon") when absent. */
  onOpenSharedLibrary?: () => void;
}

type View = { kind: "choose" } | { kind: "ai" } | { kind: "text" };

const SOURCE_LABEL: Record<EditorDraft["source"], string> = { tab: "from a tab", scratch: "from scratch", song: "editing a saved song" };

const DEFAULT_TAB_BPM = 100;
const MIN_SONG_BPM = 20;
const MAX_SONG_BPM = 999;

/** The whole bpm typed in a BPM field, or null when it is empty or out of range. */
function bpmValue(text: string): number | null {
  const n = Number(text);
  return text.trim() !== "" && Number.isFinite(n) && n >= MIN_SONG_BPM && n <= MAX_SONG_BPM ? Math.round(n) : null;
}

function youtubeProblem(url: string): string | null {
  return url.trim() && !parseYouTubeId(url.trim()) ? "That does not look like a YouTube link." : null;
}

export function AddSong({ settings, onSaveSong, onSaved, onCancel, onOpenEditor, onOpenSharedLibrary }: AddSongProps) {
  const [view, setView] = useState<View>({ kind: "choose" });
  const [drafts, setDrafts] = useState<EditorDraft[]>([]);

  const [tabText, setTabText] = useState("");
  const [tabTitle, setTabTitle] = useState("");
  const [titleTouched, setTitleTouched] = useState(false);
  const [tabLink, setTabLink] = useState("");
  const [tabError, setTabError] = useState<string | null>(null);
  const [tabBpm, setTabBpm] = useState(String(DEFAULT_TAB_BPM));
  const [bpmTouched, setBpmTouched] = useState(false);
  const taps = useRef<number[]>([]);

  const [scratchTitle, setScratchTitle] = useState("");
  const [scratchLink, setScratchLink] = useState("");
  const [scratchBpm, setScratchBpm] = useState(String(DEFAULT_TAB_BPM));

  useEffect(() => {
    if (view.kind !== "choose") return;
    let cancelled = false;
    listEditorDrafts().then(
      (d) => !cancelled && setDrafts(d),
      () => undefined,
    );
    return () => {
      cancelled = true;
    };
  }, [view.kind]);

  const summary = useMemo(() => (tabText.trim() ? summarizeTab(tabText) : null), [tabText]);

  function onTabChange(text: string) {
    setTabText(text);
    setTabError(null);
    if (!titleTouched) setTabTitle(guessTabTitle(text));
    if (!bpmTouched) setTabBpm(String(parseTempo(text) ?? DEFAULT_TAB_BPM));
  }

  /** Tap button: the tempo comes from the taps; a pause of more than 2.5 s starts over. */
  function onTap() {
    const now = performance.now() / 1000;
    const prev = taps.current[taps.current.length - 1];
    taps.current = prev !== undefined && now - prev > 2.5 ? [now] : [...taps.current, now];
    const r = tapTempo(taps.current);
    if (!r) return;
    const bpm = Math.round(r.bpm);
    if (bpm >= MIN_SONG_BPM && bpm <= MAX_SONG_BPM) {
      setBpmTouched(true);
      setTabBpm(String(bpm));
    }
  }

  async function discard(id: string) {
    await deleteEditorDraft(id).catch(() => undefined);
    setDrafts((d) => d.filter((x) => x.id !== id));
  }

  function openTab() {
    const r = docFromTab(tabText, { title: tabTitle, youtubeUrl: tabLink, bpm: bpmValue(tabBpm) ?? undefined });
    if (!r.ok) {
      setTabError(r.message);
      return;
    }
    onOpenEditor({ kind: "new", doc: r.doc, source: "tab" });
  }

  function openScratch() {
    onOpenEditor({ kind: "new", doc: emptyDoc({ title: scratchTitle.trim() || "Untitled", youtubeUrl: scratchLink.trim() || undefined, bpm: bpmValue(scratchBpm) ?? undefined }), source: "scratch" });
  }

  if (view.kind === "ai" || view.kind === "text") {
    return <NewSong mode={view.kind} settings={settings} onSaveSong={onSaveSong} onSaved={onSaved} onCancel={() => setView({ kind: "choose" })} />;
  }

  const tabLinkProblem = youtubeProblem(tabLink);
  const scratchLinkProblem = youtubeProblem(scratchLink);
  const canOpenTab = !!summary && summary.errors.length === 0 && summary.noteCount > 0 && !tabLinkProblem && bpmValue(tabBpm) !== null;
  const issues = summary ? [...summary.errors.map((m) => ({ m, error: true })), ...summary.warnings.map((m) => ({ m, error: false }))] : [];

  return (
    <div className="screen new-song-screen">
      <header className={pg.head}>
        <div className={pg.headText}>
          <h1 className={pg.title}>Add a song</h1>
          <p className={pg.sub}>Paste a tab or start with a blank page. You then see the song as notes you can drag, fix and listen to.</p>
        </div>
        <div className={pg.actions}>
          <Button variant="ghost" onClick={onCancel}>
            Cancel
          </Button>
        </div>
      </header>

      {drafts.length > 0 && (
        <div className={st.drafts} aria-label="Songs in progress">
          {drafts.map((d) => (
            <Card key={d.id} className={st.draftCard}>
              <div className={st.draftMain}>
                <div className={st.draftTitle}>{d.title || "Untitled song"}</div>
                <div className={st.muted}>
                  In progress, {SOURCE_LABEL[d.source]} · {new Date(d.updatedAt).toLocaleString()}
                </div>
              </div>
              <Button variant="primary" onClick={() => onOpenEditor({ kind: "draft", draft: d })}>
                Continue
              </Button>
              <Button variant="ghost" icon={<Trash2 size={15} />} onClick={() => void discard(d.id)} title="Discard this draft" aria-label={`Discard draft ${d.title || "Untitled song"}`} />
            </Card>
          ))}
        </div>
      )}

      <div className={st.stack}>
        <section className={st.card} aria-label="Paste a tab">
          <div className={st.cardHead}>
            <IconTile>
              <FileText size={22} />
            </IconTile>
            <div>
              <div className={st.cardTitle}>Paste a tab</div>
              <p className={st.hint}>Copy a text tab from a tab site and paste it here. Taalmel reads the notes and spaces them out; you fix the timing in the editor.</p>
            </div>
          </div>
          <textarea className={st.tabBox} value={tabText} onChange={(e) => onTabChange(e.target.value)} placeholder="Paste the tab here" spellCheck={false} aria-label="Tab text" />
          {summary && (
            <div className={st.summary} aria-live="polite">
              {summary.noteCount} {summary.noteCount === 1 ? "note" : "notes"} in {summary.barCount} {summary.barCount === 1 ? "bar" : "bars"}
              {summary.capo ? `, capo ${summary.capo}` : ""}
            </div>
          )}
          {issues.length > 0 && (
            <ul className={st.issues} aria-label="Problems found in the tab">
              {issues.map((i, n) => (
                <li key={n} className={`${st.issue} ${i.error ? st.issueError : st.issueWarn}`}>
                  {i.error ? <OctagonAlert size={15} aria-hidden /> : <AlertTriangle size={15} aria-hidden />}
                  <span>{i.m}</span>
                </li>
              ))}
            </ul>
          )}
          <div className={st.fields}>
            <label className={st.field}>
              Title (optional)
              <input
                type="text"
                value={tabTitle}
                onChange={(e) => {
                  setTitleTouched(true);
                  setTabTitle(e.target.value);
                }}
                placeholder="Untitled"
              />
            </label>
            <label className={st.field}>
              BPM
              <span className={st.bpmRow}>
                <input
                  type="number"
                  min={MIN_SONG_BPM}
                  max={MAX_SONG_BPM}
                  step={1}
                  value={tabBpm}
                  onChange={(e) => {
                    setBpmTouched(true);
                    setTabBpm(e.target.value);
                  }}
                  aria-label="BPM"
                />
                <Button type="button" onClick={onTap} title="Tap the beat of the song to find its tempo">
                  Tap
                </Button>
              </span>
              {bpmValue(tabBpm) === null && <span className={st.muted}>Enter a tempo from {MIN_SONG_BPM} to {MAX_SONG_BPM}.</span>}
            </label>
            <label className={st.field}>
              YouTube link (optional)
              <input type="url" value={tabLink} onChange={(e) => setTabLink(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
              {tabLinkProblem && <span className={st.muted}>{tabLinkProblem}</span>}
            </label>
          </div>
          {tabError && (
            <div className="notice notice-error" role="alert">
              {tabError}
            </div>
          )}
          <div className={st.actions}>
            <span className={st.muted}>The video lets you listen to the real song while you fix the notes.</span>
            <Button variant="primary" className={st.actionsEnd} icon={<ArrowRight size={15} />} disabled={!canOpenTab} onClick={openTab}>
              Open in editor
            </Button>
          </div>
        </section>

        <section className={st.card} aria-label="Start from scratch">
          <div className={st.cardHead}>
            <IconTile>
              <PencilLine size={22} />
            </IconTile>
            <div>
              <div className={st.cardTitle}>Start from scratch</div>
              <p className={st.hint}>No tab? Begin with 4 empty bars (4/4, at the BPM you set) and draw the notes yourself, for example while a video plays.</p>
            </div>
          </div>
          <div className={st.fields}>
            <label className={st.field}>
              Title (optional)
              <input type="text" value={scratchTitle} onChange={(e) => setScratchTitle(e.target.value)} placeholder="Untitled" />
            </label>
            <label className={st.field}>
              BPM
              <input type="number" min={MIN_SONG_BPM} max={MAX_SONG_BPM} step={1} value={scratchBpm} onChange={(e) => setScratchBpm(e.target.value)} aria-label="BPM" />
              {bpmValue(scratchBpm) === null && <span className={st.muted}>Enter a tempo from {MIN_SONG_BPM} to {MAX_SONG_BPM}.</span>}
            </label>
            <label className={st.field}>
              YouTube link (optional)
              <input type="url" value={scratchLink} onChange={(e) => setScratchLink(e.target.value)} placeholder="https://www.youtube.com/watch?v=..." />
              {scratchLinkProblem && <span className={st.muted}>{scratchLinkProblem}</span>}
            </label>
          </div>
          <div className={st.actions}>
            <Button variant="primary" className={st.actionsEnd} icon={<ArrowRight size={15} />} disabled={!!scratchLinkProblem || bpmValue(scratchBpm) === null} onClick={openScratch}>
              Open in editor
            </Button>
          </div>
        </section>
      </div>

      <div className={st.choices}>
        <button type="button" className={st.choice} onClick={() => setView({ kind: "text" })}>
          <IconTile>
            <Music2 size={22} />
          </IconTile>
          <span className={st.choiceText}>
            <span className={st.choiceTitle}>I have Taalmel song text</span>
            <span className={st.choiceBody}>Paste text in Taalmel's song format and check it.</span>
          </span>
        </button>
        <button type="button" className={st.choice} onClick={() => setView({ kind: "ai" })}>
          <IconTile>
            <Bot size={22} />
          </IconTile>
          <span className={st.choiceText}>
            <span className={st.choiceTitle}>Use an AI chat</span>
            <span className={st.choiceBody}>Copy a prompt into your own AI chat, then paste its answer back.</span>
          </span>
        </button>
        <button type="button" className={st.choice} disabled={!onOpenSharedLibrary} onClick={onOpenSharedLibrary} title={onOpenSharedLibrary ? undefined : "The shared library is not available yet"}>
          <IconTile>
            <Library size={22} />
          </IconTile>
          <span className={st.choiceText}>
            <span className={st.choiceTitle}>
              Find it in the shared library {!onOpenSharedLibrary && <Pill>Coming soon</Pill>}
            </span>
            <span className={st.choiceBody}>Songs other people have already transcribed.</span>
          </span>
        </button>
      </div>
    </div>
  );
}
