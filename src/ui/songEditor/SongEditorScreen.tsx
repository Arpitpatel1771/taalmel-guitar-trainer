// The song editor (specs/5-11-piano-roll.md): a piano roll for building and fixing a song, with the
// video, the transport, pitch hints and an inspector. Edits are operations on an EdDoc (src/songEditor).

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Redo2, Undo2 } from "lucide-react";
import { PPQ, type Settings } from "../../model";
import {
  SNAP_TICKS,
  addAtPlayhead,
  addNote,
  barLengthTicks,
  canRedo,
  canUndo,
  copyNotes,
  createHistory,
  deleteNotes,
  duplicateBars,
  findConflicts,
  moveNotes,
  noteById,
  noteMidi,
  pasteNotes,
  placeNextAt,
  pushHistory,
  redo,
  resizeNotes,
  lineUpOffset,
  saveDoc,
  serializeDoc,
  setHeader,
  setVideoOffset,
  setYoutube,
  snapTick,
  undo,
  type Clip,
  type EdDoc,
  type OpResult,
  type Problem,
  type SnapId,
} from "../../songEditor";
import type { StringNumber } from "../../model";
import { deleteEditorDraft, saveEditorDraft, type EditorDraft } from "../../storage/importDrafts";
import { Button } from "../components/kit";
import { EditableText } from "./bits";
import { ExplainerSheet } from "./ExplainerSheet";
import { Inspector } from "./Inspector";
import { ListenRow } from "./ListenRow";
import { RollCanvas, type RollApi, type RollTool } from "./RollCanvas";
import { SongPanel } from "./SongPanel";
import { TabViewPanel } from "./TabViewPanel";
import { ToolRow } from "./ToolRow";
import { buildInit, type EditorStart } from "./editorInit";
import { MAX_ROW, MAX_ZOOM, MIN_ROW, MIN_ZOOM, fitZoom, type RollView } from "./rollGeometry";
import { previewPitch } from "./previewNote";
import { useEditorPlayback } from "./useEditorPlayback";
import { useHints } from "./useHints";
import s from "./songEditor.module.css";

export interface SongEditorScreenProps {
  settings: Settings;
  onSettingsChange?: (next: Settings) => void;
  start: EditorStart;
  /** Saves the song text; songId given = replace that song in place. */
  onSave: (text: string, songId?: string) => Promise<{ ok: true; id: string } | { ok: false; message: string }>;
  onSaved: (id: string) => void;
  /** Leave; the draft stays saved. */
  onExit: () => void;
}

export type { EditorStart } from "./editorInit";

export function SongEditorScreen(props: SongEditorScreenProps) {
  const init = useMemo(() => buildInit(props.start), []); // eslint-disable-line react-hooks/exhaustive-deps
  if (!init.ok) {
    return (
      <div className="screen">
        <div className="notice notice-error" role="alert">
          {init.message}
        </div>
        <div>
          <Button onClick={props.onExit}>Back</Button>
        </div>
      </div>
    );
  }
  return <Editor {...props} init={init} />;
}

type Init = Extract<ReturnType<typeof buildInit>, { ok: true }>;

const SNAP_IDS: SnapId[] = ["1/4", "1/8", "1/16", "1/8T", "1/16T", "off"];
const isSnap = (v: unknown): v is SnapId => SNAP_IDS.includes(v as SnapId);
const ZOOM_STEP = 1.25;

function initialPitchScroll(doc: EdDoc, rowH: number): number {
  const mids = doc.notes.map((n) => noteMidi(doc, n));
  const mid = mids.length ? mids.reduce((a, b) => a + b, 0) / mids.length : 64;
  return Math.max(0, Math.round((88 - mid) * rowH - 150));
}

function Editor({ settings, onSettingsChange, onSave, onSaved, onExit, init }: SongEditorScreenProps & { init: Init }) {
  const [hist, setHist] = useState(() => createHistory(init.doc));
  const doc = hist.present;
  const docRef = useRef(doc);
  docRef.current = doc;
  const [selected, setSelected] = useState<number[]>([]);
  const selRef = useRef(selected);
  selRef.current = selected;

  const [tool, setTool] = useState<RollTool>("select");
  const [snap, setSnap] = useState<SnapId>(isSnap(init.view.snap) ? init.view.snap : "1/16");
  const [view, setView] = useState<RollView>(init.view.view ?? "pitch");
  const [zoom, setZoom] = useState(() => init.view.zoom ?? fitZoom(init.doc));
  const [rowH, setRowH] = useState(init.view.rowHeight ?? 16);
  const [brightness, setBrightness] = useState(70);
  const [liveRecord, setLiveRecord] = useState(false);
  const [livePlaced, setLivePlaced] = useState(0);
  const [explainer, setExplainer] = useState(false);
  const [toast, setToast] = useState<{ id: number; text: string } | null>(null);
  const [problems, setProblems] = useState<Problem[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [draftStatus, setDraftStatus] = useState("");

  const snapTicks = SNAP_TICKS[snap];
  const conflicts = useMemo(() => findConflicts(doc), [doc]);
  const rollApi = useRef<RollApi | null>(null);
  const scroll = useRef({ x: init.view.scrollX ?? 0, y: init.view.scrollY ?? initialPitchScroll(init.doc, init.view.rowHeight ?? 16) });
  const clip = useRef<Clip | null>(null);
  const lastLength = useRef<number>(PPQ / 2);
  const lastPitch = useRef<number>(64);
  const savedRef = useRef(false);
  const toastTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  const pb = useEditorPlayback(doc, settings, liveRecord, onSettingsChange);
  const pbRef = useRef(pb);
  pbRef.current = pb;
  const videoId = doc.header.youtube?.videoId;
  const hints = useHints({ videoId, getVideoState: pb.getVideoState, ownSoundsAudible: pb.ownSoundsAudible });
  const hintsRef = useRef(hints);
  hintsRef.current = hints;

  const flash = useCallback((text: string) => {
    setToast({ id: Date.now(), text });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
  }, []);
  useEffect(() => () => clearTimeout(toastTimer.current), []);

  const hear = useCallback(
    (midi: number) => {
      if (hintsRef.current.status === "recording") return;
      lastPitch.current = midi;
      void previewPitch(midi, Math.max(0.3, settings.playNotesVolume), settings.a4Hz);
    },
    [settings.playNotesVolume, settings.a4Hz],
  );

  // ---- editing
  const commit = useCallback(
    (res: OpResult, preview?: boolean): void => {
      if (res.refused) {
        flash(res.message ?? "That can't be done.");
        return;
      }
      const before = docRef.current;
      if (res.message) flash(res.message);
      if (res.doc === before) return;
      docRef.current = res.doc;
      setHist((h) => pushHistory(h, res.doc));
      if (res.ids && res.ids.length > 0) setSelected(res.ids);
      setProblems(null);
      if (preview && res.ids?.length) {
        const n = noteById(res.doc, res.ids[0]!);
        const old = noteById(before, res.ids[0]!);
        if (n && (!old || noteMidi(before, old) !== noteMidi(res.doc, n))) hear(noteMidi(res.doc, n));
      }
    },
    [flash, hear],
  );

  // The video is paused on a downbeat and the playhead is on the matching bar: move bar 1 there, then play linked again.
  const lineUp = useCallback((): void => {
    const p = pbRef.current;
    const videoSec = p.getVideoTime();
    if (videoSec === null) return flash("The video isn't ready yet.");
    const offset = lineUpOffset(videoSec, p.tempo.ticksToSec(p.getPlayhead()));
    if (offset === null) return flash("The playhead is further into the song than the video is. Move the video later or the playhead earlier.");
    commit(setVideoOffset(docRef.current, offset));
    p.setLinked(true);
  }, [commit, flash]);

  // Selection never points at notes that are gone.
  useEffect(() => {
    const ids = new Set(doc.notes.map((n) => n.id));
    const kept = selRef.current.filter((id) => ids.has(id));
    if (kept.length !== selRef.current.length) setSelected(kept);
  }, [doc]);

  useEffect(() => {
    if (selected.length === 1) {
      const n = noteById(doc, selected[0]!);
      if (n) lastLength.current = n.durationTicks;
    }
  }, [selected, doc]);

  const doUndo = useCallback(() => setHist((h) => undo(h)), []);
  const doRedo = useCallback(() => setHist((h) => redo(h)), []);

  const barsOfSelection = useCallback((): number[] => {
    const d = docRef.current;
    const len = barLengthTicks(d);
    const sel = selRef.current.map((id) => noteById(d, id)).filter((n) => !!n);
    if (sel.length === 0) return [Math.floor(pbRef.current.getPlayhead() / len)];
    return [...new Set(sel.map((n) => Math.floor(n!.startTick / len)))];
  }, []);

  const duplicate = useCallback(() => commit(duplicateBars(docRef.current, barsOfSelection())), [commit, barsOfSelection]);

  const addAt = useCallback(
    (startTick: number, midi: number, durationTicks: number, string?: StringNumber) => {
      lastLength.current = durationTicks;
      commit(addNote(docRef.current, { startTick, midi, durationTicks, string }), true);
    },
    [commit],
  );

  const liveTap = useCallback(() => {
    const d = docRef.current;
    const p = pbRef.current;
    const tick = p.getPlayhead();
    const len = barLengthTicks(d);
    const next = d.notes.find((n) => n.startTick >= tick - PPQ / 4);
    let res: OpResult;
    if (next && next.startTick - tick <= len) res = placeNextAt(d, tick, snapTicks, PPQ / 4);
    else {
      const vt = p.getVideoTime();
      const heard = vt !== null ? hintsRef.current.pitchAt(vt) : null;
      res = addAtPlayhead(d, tick, heard ?? lastPitch.current, lastLength.current, snapTicks);
    }
    if (!res.refused && res.doc !== d) setLivePlaced((c) => c + 1);
    commit(res);
  }, [commit, snapTicks]);

  const zoomBy = useCallback((dir: 1 | -1) => {
    setZoom((z) => Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(dir > 0 ? z * ZOOM_STEP : z / ZOOM_STEP))));
  }, []);
  const rowBy = useCallback((dir: 1 | -1) => {
    setRowH((r) => Math.max(MIN_ROW, Math.min(MAX_ROW, r + dir * 2)));
  }, []);

  // ---- keyboard
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (explainer) return;
      const mod = e.ctrlKey || e.metaKey;
      const k = e.key;
      const d = docRef.current;
      const ids = selRef.current;
      const key = k.length === 1 ? k.toLowerCase() : k;
      if (mod && key === "z") {
        e.preventDefault();
        if (e.shiftKey) doRedo();
        else doUndo();
      } else if (mod && key === "y") {
        e.preventDefault();
        doRedo();
      } else if (mod && key === "a") {
        e.preventDefault();
        setSelected(d.notes.map((n) => n.id));
      } else if (mod && key === "c") {
        if (ids.length === 0) return;
        e.preventDefault();
        clip.current = copyNotes(d, ids);
        flash(`Copied ${ids.length} note${ids.length === 1 ? "" : "s"}.`);
      } else if (mod && key === "v") {
        if (!clip.current) return;
        e.preventDefault();
        const at = snapTick(pbRef.current.getPlayhead(), snapTicks, barLengthTicks(d));
        commit(pasteNotes(d, clip.current, at));
      } else if (mod && key === "d") {
        e.preventDefault();
        duplicate();
      } else if (mod) {
        return;
      } else if (key === " ") {
        if (t && (t.tagName === "BUTTON" || t.tagName === "A")) return;
        e.preventDefault();
        pbRef.current.togglePlay();
      } else if (key === "Delete" || key === "Backspace") {
        if (ids.length === 0) return;
        e.preventDefault();
        commit(deleteNotes(d, ids));
      } else if (key === "Escape") {
        setSelected([]);
      } else if (key === "d") {
        setTool("draw");
      } else if (key === "v") {
        setTool("select");
      } else if (key === "n") {
        if (pbRef.current.playing) liveTap();
        else flash("Press Play first, then N for each note you hear.");
      } else if (ids.length > 0 && (key === "ArrowLeft" || key === "ArrowRight")) {
        e.preventDefault();
        const dir = key === "ArrowLeft" ? -1 : 1;
        commit(e.shiftKey ? resizeNotes(d, ids, dir * snapTicks) : moveNotes(d, ids, { dTicks: dir * snapTicks }));
      } else if (ids.length > 0 && (key === "ArrowUp" || key === "ArrowDown")) {
        e.preventDefault();
        const dir = key === "ArrowUp" ? 1 : -1;
        commit(moveNotes(d, ids, { dSemis: dir * (e.shiftKey ? 12 : 1) }), true);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [commit, doUndo, doRedo, duplicate, explainer, flash, liveTap, snapTicks]);

  // ---- draft autosave (500 ms after an edit)
  const dirty = init.alwaysSave || hist.past.length > 0 || hist.future.length > 0;
  const persist = useCallback(async (): Promise<void> => {
    if (savedRef.current) return;
    const d = docRef.current;
    let songText = "";
    try {
      songText = serializeDoc(d);
    } catch {
      songText = "";
    }
    const draft: EditorDraft = {
      id: init.draftId,
      version: 2,
      source: init.source,
      songId: init.songId,
      title: d.header.title,
      songText,
      docJson: JSON.stringify(d),
      view: { zoom: zoomRef.current, rowHeight: rowRef.current, snap: snapRef.current, view: viewRef.current, scrollX: scroll.current.x, scrollY: scroll.current.y },
      updatedAt: Date.now(),
    };
    try {
      await saveEditorDraft(draft);
      setDraftStatus("Draft saved");
    } catch {
      setDraftStatus("Draft not saved");
    }
  }, [init.draftId, init.source, init.songId]);
  const zoomRef = useRef(zoom);
  const rowRef = useRef(rowH);
  const snapRef = useRef(snap);
  const viewRef = useRef(view);
  zoomRef.current = zoom;
  rowRef.current = rowH;
  snapRef.current = snap;
  viewRef.current = view;

  useEffect(() => {
    if (!dirty || savedRef.current) return;
    setDraftStatus("Saving…");
    const id = setTimeout(() => void persist(), 500);
    return () => clearTimeout(id);
  }, [doc, zoom, rowH, snap, view, dirty, persist]);

  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  useEffect(
    () => () => {
      if (dirtyRef.current) void persist();
    },
    [persist],
  );

  const leave = useCallback(async () => {
    pbRef.current.pause();
    await hintsRef.current.close();
    if (dirtyRef.current) await persist();
    onExit();
  }, [onExit, persist]);

  // ---- saving
  const save = useCallback(async () => {
    const r = saveDoc(docRef.current);
    setSaveError(null);
    if (!r.ok) {
      setProblems(r.problems);
      return;
    }
    setProblems(null);
    setSaving(true);
    const res = await onSave(r.text, init.songId);
    setSaving(false);
    if (!res.ok) {
      setSaveError(res.message);
      return;
    }
    savedRef.current = true;
    pbRef.current.pause();
    await hintsRef.current.close();
    await deleteEditorDraft(init.draftId).catch(() => undefined);
    onSaved(res.id);
  }, [onSave, onSaved, init.songId, init.draftId]);

  const showNote = useCallback((id: number) => {
    const d = docRef.current;
    const n = noteById(d, id);
    if (!n) return;
    setSelected([id]);
    rollApi.current?.scrollToTick(n.startTick);
    rollApi.current?.scrollToMidi(noteMidi(d, n));
  }, []);

  // ---- loop, hints
  const barLen = barLengthTicks(doc);
  const loopLabel = pb.loopRange
    ? (() => {
        const a = Math.floor(pb.loopRange.startTick / barLen) + 1;
        const b = Math.ceil(pb.loopRange.endTick / barLen);
        return b <= a ? `Loop bar ${a}` : `Loop bars ${a}–${b}`;
      })()
    : "Loop";
  const toggleLoop = (): void => {
    const bars = barsOfSelection();
    const from = Math.min(...bars);
    const to = Math.max(...bars);
    pb.toggleLoop({ startTick: from * barLen, endTick: (to + 1) * barLen });
  };
  const tabBars = pb.loopOn && pb.loopRange ? { fromBar: Math.floor(pb.loopRange.startTick / barLen), toBar: Math.max(0, Math.ceil(pb.loopRange.endTick / barLen) - 1) } : null;

  const onHintsToggle = async (): Promise<void> => {
    if (hints.layerOn) {
      await hints.hideLayer();
      return;
    }
    const needsRecording = await hints.showLayer();
    if (needsRecording) {
      if (hints.supported) setExplainer(true);
      else await hints.startRecording();
    }
  };

  const h = doc.header;
  const summary = [`${h.bpm} BPM`, `${h.time.numerator}/${h.time.denominator}`, h.capo ? `capo ${h.capo}` : null, `${doc.notes.length} note${doc.notes.length === 1 ? "" : "s"} in ${doc.bars.length} bar${doc.bars.length === 1 ? "" : "s"}`]
    .filter(Boolean)
    .join(" · ");
  const saveBlocked = conflicts.length > 0 ? `${conflicts.length} note${conflicts.length === 1 ? " has" : "s have"} no free string. Fix ${conflicts.length === 1 ? "it" : "them"} first.` : null;

  return (
    <div className={`screen ${s.screen}`}>
      <header className={s.header}>
        <Button variant="ghost" icon={<ChevronLeft size={16} aria-hidden />} onClick={() => void leave()}>
          Songs
        </Button>
        <div className={s.titleBlock}>
          <EditableText className={s.titleInput} value={h.title} label="Song title" placeholder="Song title" onCommit={(v) => commit(setHeader(doc, { title: v }))} />
          <div className={s.subline}>
            <EditableText className={s.artistInput} value={h.artist ?? ""} label="Artist" placeholder="Add artist" onCommit={(v) => commit(setHeader(doc, { artist: v }))} />
            <span>{summary}</span>
            {draftStatus && <span className={s.draftStatus}>{draftStatus}</span>}
          </div>
        </div>
        <div className={s.headActions}>
          <button type="button" className={s.iconBtn} aria-label="Undo" title="Undo (Ctrl+Z)" disabled={!canUndo(hist)} onClick={doUndo}>
            <Undo2 size={18} aria-hidden />
          </button>
          <button type="button" className={s.iconBtn} aria-label="Redo" title="Redo (Ctrl+Shift+Z)" disabled={!canRedo(hist)} onClick={doRedo}>
            <Redo2 size={18} aria-hidden />
          </button>
          <button type="button" className={s.primaryBtn} disabled={saving || !!saveBlocked} title={saveBlocked ?? "Save this song"} onClick={() => void save()}>
            {saving ? "Saving…" : "Save song"}
          </button>
        </div>
      </header>

      {saveError && (
        <div className="notice notice-error" role="alert">
          {saveError}
        </div>
      )}
      {conflicts.length > 0 && (
        <div className={s.banner} role="status">
          <span>
            <strong>{conflicts.length} note{conflicts.length === 1 ? "" : "s"}</strong> can't be played at the same time on separate strings. {conflicts.length === 1 ? "It is" : "They are"} red in the roll.
          </span>
          <button type="button" onClick={() => showNote(conflicts[0]!)}>
            Show
          </button>
        </div>
      )}
      {problems && (
        <div className={s.problems} role="alert">
          <div className={s.problemsHead}>
            <strong>Fix these before saving</strong>
            <button type="button" onClick={() => setProblems(null)}>
              Close
            </button>
          </div>
          <ul>
            {problems.map((p, i) => (
              <li key={i}>
                <span>{p.message}</span>
                {p.noteId !== undefined && (
                  <button type="button" onClick={() => showNote(p.noteId!)}>
                    Show
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <ListenRow
        pb={pb}
        bpm={h.bpm}
        hints={hints}
        hasVideo={!!h.youtube}
        brightness={brightness}
        onBrightness={setBrightness}
        onHintsToggle={() => void onHintsToggle()}
        onRecord={() => setExplainer(true)}
        loopLabel={loopLabel}
        onToggleLoop={toggleLoop}
        onYoutube={(url) => commit(setYoutube(doc, url))}
        onLineUp={lineUp}
      />

      <ToolRow
        tool={tool}
        onTool={setTool}
        snap={snap}
        onSnap={setSnap}
        view={view}
        onView={setView}
        onZoom={zoomBy}
        onRowHeight={rowBy}
        onDuplicate={duplicate}
        liveRecord={liveRecord}
        onLiveRecord={() => {
          setLiveRecord((v) => !v);
          setLivePlaced(0);
        }}
      />
      {liveRecord && (
        <div className={s.liveBanner} role="status">
          <strong>Live record</strong> Press <kbd>N</kbd> each time you hear the next note while the song plays. It lands at the playhead; drag it afterwards if it's off.
          {livePlaced > 0 && <span> Placed {livePlaced}.</span>}
          {!pb.playing && <span> Press Play to start.</span>}
        </div>
      )}

      <section className={s.rollArea} aria-label="Piano roll">
        <div className={s.rollCard}>
          <RollCanvas
            doc={doc}
            view={view}
            zoom={zoom}
            rowH={rowH}
            snap={snap}
            tool={tool}
            selected={selected}
            conflicts={conflicts}
            playing={pb.playing}
            follow={pb.followOn}
            getPlayhead={pb.getPlayhead}
            loop={pb.loopRange}
            hints={hints.layerOn ? hints.hints : null}
            hintBrightness={brightness / 100}
            hintsVersion={hints.version}
            tempo={pb.tempo}
            videoOffsetSec={h.youtube?.offsetSec}
            initialScroll={scroll.current}
            drawLength={lastLength.current}
            onSelect={setSelected}
            onEdit={commit}
            onAddNote={addAt}
            onSeek={pb.seek}
            onLoop={(r) => {
              pb.setLoopRange(r);
              if (r) pb.setLoopOn(true);
            }}
            onFlag={(offset) => commit(setVideoOffset(docRef.current, offset))}
            onScroll={(x, y) => (scroll.current = { x, y })}
            onZoomWheel={(dir, axis) => (axis === "y" ? rowBy(dir) : zoomBy(dir))}
            onPreviewPitch={hear}
            apiRef={rollApi}
          />
          <TabViewPanel doc={doc} selected={selected} range={tabBars} onSelect={showNote} />
        </div>
        <aside className={s.inspector} aria-label="Inspector">
          {selected.length > 0 ? (
            <Inspector doc={doc} selected={selected} snapTicks={snapTicks} onEdit={commit} onHear={hear} />
          ) : (
            <SongPanel doc={doc} playheadBar={Math.floor(pb.getPlayhead() / barLen)} getVideoTime={pb.getVideoTime} onEdit={commit} onToast={flash} />
          )}
        </aside>
      </section>

      <div className={s.srOnly} role="status" aria-live="polite">
        {toast?.text}
      </div>
      {toast && (
        <div className={s.toast} aria-hidden="true">
          {toast.text}
        </div>
      )}
      {explainer && (
        <ExplainerSheet
          onCancel={() => setExplainer(false)}
          onContinue={() => {
            setExplainer(false);
            void hints.startRecording();
          }}
        />
      )}
    </div>
  );
}
