// Song view (spec 8-10, 11.1 editor toggle, 12.2). Two modes:
//  - "practice": sheet + transport + mic feedback (usePlaybackEngine).
//  - "edit": raw text editor with live (debounced) re-parse, errors with
//    click-to-jump, and Save (spec 4.3 rule 1: text is the source of truth).

import { useEffect, useMemo, useRef, useState } from "react";
import type { ParseError, PracticeMode, Settings, Song } from "../../model";
import { buildRepairPrompt, parse, serialize, withSongBpm, withYoutubeOffset } from "../../songFormat";
import { computeLayout } from "../../layout";
import { Sheet, buildSongIndex } from "../../render";
import { TransportBar } from "../components/TransportBar";
import { BpmRampPanel } from "../components/BpmRampPanel";
import { SongEditor, type SongEditorHandle } from "../editor/SongEditor";
import { ProblemsPanel } from "../editor/ProblemsPanel";
import { SyntaxReference } from "../editor/SyntaxReference";
import ed from "../editor/Editor.module.css";
import { SessionSummaryPanel } from "../components/SessionSummaryPanel";
import { usePlaybackEngine } from "../usePlaybackEngine";
import { copyToClipboard, useDebouncedValue } from "../utils";
import { useElementWidth } from "../useElementWidth";
import { Copy, Mic, MicOff, Share2, VideoOff } from "lucide-react";
import { ShareDialog } from "../sharing/ShareDialog";
import { Chip, SegmentedControl } from "../components/kit";
import { updateRecentSong } from "../../storage/recent";
import { practiceBpmRange } from "../tempoLabels";
import pr from "./Practice.module.css";
import { ChipRow, StatusChip } from "../shell/StatusChip";
import { useRegisterPractice, useShell, useShellMic } from "../shell/AppShellContext";

const OFFSET_STEPS_MS = [-100, -10, 10, 100];

function EditorPreview({ song, settings }: { song: Song; settings: Settings }) {
  const [widthRef, width] = useElementWidth(700);
  const layout = useMemo(
    () => computeLayout(song, { viewportWidth: width, zoom: settings.zoom, lanes: settings.lanes }),
    [song, width, settings.zoom, settings.lanes],
  );
  const songIndex = useMemo(() => buildSongIndex(song), [song]);
  return (
    <div className="editor-preview" ref={widthRef}>
      <Sheet song={song} layout={layout} songIndex={songIndex} lanes={settings.lanes} onReady={() => {}} />
    </div>
  );
}

/** Practice-area width at which the video docks right, and its width there. */
const VIDEO_DOCK_MIN_WIDTH = 1100;
const VIDEO_DOCK_WIDTH = 420;

export interface PracticeInitialState {
  loop: { startBar: number; endBar: number } | null;
}

export function PracticeArea({
  song,
  settings,
  onOffsetNudge,
  onSetBar1Here,
  onSongBpmChange,
  onSettingsChange,
  recentId,
  initialState,
  headerActions,
}: {
  song: Song;
  settings: Settings;
  onOffsetNudge: (deltaMs: number) => void;
  onSetBar1Here: (videoSec: number) => void;
  /** Saves a new tempo for the song itself. */
  onSongBpmChange: (bpm: number) => void;
  onSettingsChange?: (next: Settings) => void;
  /** Identifies the song for the device-local "recent" record. */
  recentId?: { songId: string; sample?: boolean };
  /** Loop and speed to start with (Home's Continue). */
  initialState?: PracticeInitialState;
  /** Buttons at the right of the practice header (edit, back). */
  headerActions?: React.ReactNode;
}) {
  const shell = useShell();
  const engine = usePlaybackEngine({
    song,
    settings,
    onVideoOffsetNudge: onOffsetNudge,
    onSetBar1Here,
    onSettingsChange,
  });
  const { setViewportWidth } = engine;
  // Apply the saved loop once, when the song opens from Home. The practice tempo always starts at the
  // song's tempo; it is never carried over from an earlier session.
  const initialRef = useRef(initialState);
  useEffect(() => {
    const init = initialRef.current;
    if (!init) return;
    if (init.loop) engine.setLoopRange({ start: init.loop.startBar, end: init.loop.endBar });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // The pocket shows the practice mic level and the song tempo.
  useShellMic("practice", engine.micNode);
  useRegisterPractice(engine.currentBpm, engine.mode === "video" && engine.hasVideo);
  const [widthRef, width] = useElementWidth(900);

  // Device-local "recent" record (Home's continue card): song visit, then loop
  // and speed changes (debounced), then the take result at the session summary.
  const recentLoop = engine.loopEnabled && engine.loopRange ? { startBar: engine.loopRange.start, endBar: engine.loopRange.end } : null;
  const sectionIndex = useMemo(() => {
    if (!recentLoop) return 0;
    const i = song.sections.findIndex((sec) => sec.bars.some((b) => b.number === recentLoop.startBar));
    return Math.max(0, i);
  }, [song, recentLoop?.startBar]); // eslint-disable-line react-hooks/exhaustive-deps
  const recentState = { title: song.header.title, sectionIndex, loop: recentLoop };
  const recentRef = useRef(recentState);
  recentRef.current = recentState;
  const recordRecent = (lastTake?: { onTime: number; total: number }) => {
    if (!recentId) return;
    updateRecentSong({ songId: recentId.songId, ...(recentId.sample ? { sample: true } : {}), ...recentRef.current, ...(lastTake ? { lastTake } : {}) });
  };
  const recordRecentRef = useRef(recordRecent);
  recordRecentRef.current = recordRecent;
  useEffect(() => {
    recordRecentRef.current();
  }, [recentId?.songId, recentId?.sample]); // eslint-disable-line react-hooks/exhaustive-deps
  const recentKey = `${recentLoop?.startBar}-${recentLoop?.endBar}-${sectionIndex}`;
  const firstKey = useRef(recentKey);
  useEffect(() => {
    if (firstKey.current === recentKey) return;
    const id = window.setTimeout(() => recordRecentRef.current(), 600);
    return () => window.clearTimeout(id);
  }, [recentKey]);
  // Leaving within the debounce window must not lose the latest loop/speed.
  useEffect(() => () => recordRecentRef.current(), []);
  // The take summary never pops up by itself; the transport's summary button opens it.
  const [summaryOpen, setSummaryOpen] = useState(false);
  const lastPass = engine.sessionSummary?.lastPass;
  useEffect(() => {
    if (lastPass) recordRecentRef.current({ onTime: lastPass.onTime, total: lastPass.totalExpected });
  }, [lastPass]);

  const sectionRanges = useMemo(
    () => song.sections.map((sec, i) => ({ i, name: sec.name || `Section ${i + 1}`, capo: sec.capo, start: sec.bars[0]?.number, end: sec.bars[sec.bars.length - 1]?.number })),
    [song],
  );
  const songCapo = song.header.capo ?? 0;
  const [videoPanelHeight, setVideoPanelHeight] = useState(320);

  // Wide screens dock the video to the right of the sheet (revamp 5); the
  // sheet then lays out in the remaining width.
  const showVideo = engine.mode === "video" && engine.hasVideo;
  const dockVideoRight = showVideo && width >= VIDEO_DOCK_MIN_WIDTH;
  const sheetWidth = dockVideoRight ? width - VIDEO_DOCK_WIDTH - 16 : width;
  useEffect(() => setViewportWidth(sheetWidth), [sheetWidth, setViewportWidth]);

  function startResize(e: React.MouseEvent) {
    e.preventDefault();
    const startY = e.clientY;
    const startHeight = videoPanelHeight;
    function onMove(ev: MouseEvent) {
      setVideoPanelHeight(Math.max(120, Math.min(600, startHeight + (ev.clientY - startY))));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  // Keyboard shortcuts while practising (revamp section 10). Ignored while
  // typing in a field so BPM/loop inputs keep working.
  const engineRef = useRef(engine);
  engineRef.current = engine;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName))) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const eng = engineRef.current;
      switch (e.key) {
        case " ":
          eng.togglePlay();
          break;
        case "Escape":
          eng.stop();
          break;
        case "l":
        case "L":
          eng.setLoopEnabled(!eng.loopEnabled);
          break;
        case "m":
        case "M":
          if (eng.micAvailable) eng.toggleMic();
          break;
        case "[":
          if (eng.mode === "grid") eng.setPracticeBpm(Math.max(practiceBpmRange(eng.baseBpm).min, Math.round(eng.currentBpm) - 5));
          break;
        case "]":
          if (eng.mode === "grid") eng.setPracticeBpm(Math.min(practiceBpmRange(eng.baseBpm).max, Math.round(eng.currentBpm) + 5));
          break;
        case "ArrowLeft":
          eng.seekBars(-1);
          break;
        case "ArrowRight":
          eng.seekBars(1);
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="practice-area" ref={(el) => widthRef(el)}>
      <header className={pr.header}>
        <div className={pr.titleRow}>
          <h2 className={pr.title}>{song.header.title}</h2>
          <div className={pr.actions}>
            {engine.hasVideo && (
              <SegmentedControl<PracticeMode>
                label="Clock"
                value={engine.mode}
                onChange={engine.setMode}
                options={[
                  { value: "grid", label: "Metronome", title: "The metronome is the clock" },
                  { value: "video", label: "YouTube video", title: "The video is the clock" },
                ]}
              />
            )}
            {headerActions}
          </div>
        </div>
        <div className={pr.meta}>
          <span className={pr.metaMono}>
            {song.header.time.numerator}/{song.header.time.denominator}
          </span>
          <span className={pr.dot}>&middot;</span>
          <span>
            <span className={pr.metaMono}>{song.header.bpm}</span> BPM
          </span>
          <span className={pr.dot}>&middot;</span>
          <span>{songCapo > 0 ? `Capo ${songCapo}` : "No capo"}</span>
        </div>
        {sectionRanges.length > 1 && (
          <div className={pr.chips} role="group" aria-label="Sections">
            {sectionRanges.map((sec) => {
              const on = !!engine.loopRange && engine.loopRange.start === sec.start && engine.loopRange.end === sec.end;
              const differs = sec.capo !== songCapo;
              return (
                <Chip
                  key={sec.i}
                  on={on}
                  title={on ? "Click to loop the whole song again" : "Loop this section"}
                  onClick={() => (on ? engine.clearLoopRange() : sec.start !== undefined && engine.setLoopRange({ start: sec.start, end: sec.end ?? sec.start }))}
                >
                  {sec.name}
                  {differs && <span className={`${pr.chipCapo}${on ? ` ${pr.chipOnCapo}` : ""}`}>Capo {sec.capo}</span>}
                </Chip>
              );
            })}
          </div>
        )}
      </header>

      <ChipRow>
        {engine.micErrorMessage ? (
          <StatusChip tone="error" icon={<MicOff size={13} />} title={engine.micErrorMessage}>
            Mic unavailable
          </StatusChip>
        ) : engine.micListening ? (
          <StatusChip tone="info" pulse title="Measuring room noise: stay quiet for a moment.">
            Listening… stay quiet
          </StatusChip>
        ) : engine.micOn ? (
          <StatusChip tone="ok" icon={<Mic size={13} />}>
            Mic on
          </StatusChip>
        ) : (
          <StatusChip icon={<MicOff size={13} />}>Mic off</StatusChip>
        )}
        {engine.micNotCalibrated && (
          <StatusChip tone="warning" title="Timing may look late until you calibrate." onClick={shell.openCalibration}>
            Not calibrated
          </StatusChip>
        )}
        {engine.playNotes && engine.micOn && (
          <StatusChip tone="warning" title="On speakers the mic hears the synthetic guitar and grades it as your playing.">
            Play notes + mic: use headphones
          </StatusChip>
        )}
        {engine.videoNotice && (
          <StatusChip tone="warning" icon={<VideoOff size={13} />} title={engine.videoNotice}>
            Video unavailable, using grid
          </StatusChip>
        )}
      </ChipRow>
      {!engine.following && (
        <button className="resume-follow-btn" onClick={engine.resumeFollow}>
          Resume follow
        </button>
      )}

      <div className={`practice-main${dockVideoRight ? " video-right" : ""}`}>
      {showVideo && (
        <div className="video-panel" style={dockVideoRight ? { width: VIDEO_DOCK_WIDTH } : { height: videoPanelHeight }}>
          <div ref={engine.videoMountRef} className="video-mount" />
          <div className="video-controls">
            {OFFSET_STEPS_MS.map((d) => (
              <button key={d} onClick={() => engine.nudgeVideoOffset(d)}>
                {d > 0 ? `+${d}` : d} ms
              </button>
            ))}
            <button onClick={engine.setBar1Here}>Set bar 1 here</button>
          </div>
          {!dockVideoRight && <div className="video-resize-handle" onMouseDown={startResize} />}
        </div>
      )}

      <Sheet
        song={song}
        layout={engine.layout}
        songIndex={engine.songIndex}
        lanes={engine.lanes}
        onReady={engine.sheetOnReady}
        loopRange={engine.loopRange}
        onBarMouseDown={engine.onBarMouseDown}
        onBarMouseEnter={engine.onBarMouseEnter}
        cursorChip={engine.capoWarning !== null ? `Next section: capo → ${engine.capoWarning}` : null}
      />
      </div>
      <TransportBar
        playing={engine.playing}
        onPlayPause={engine.togglePlay}
        onStop={engine.stop}
        mode={engine.mode}
        hasVideo={engine.hasVideo}
        onModeChange={engine.setMode}
        baseBpm={engine.baseBpm}
        currentBpm={engine.currentBpm}
        onSongBpmChange={onSongBpmChange}
        onPracticeBpmChange={engine.setPracticeBpm}
        videoRate={engine.videoRate}
        availableVideoRates={engine.availableVideoRates}
        onVideoRateChange={engine.setVideoRate}
        countIn={engine.countIn}
        onCountInChange={engine.setCountIn}
        metronomeVolume={engine.metronomeVolume}
        metronomeMuted={engine.metronomeMuted}
        onVolumeChange={engine.setMetronomeVolume}
        onMuteChange={engine.setMetronomeMuted}
        subdivisionOn={engine.subdivisionOn}
        onSubdivisionChange={engine.setSubdivisionOn}
        playNotes={engine.playNotes}
        onPlayNotesChange={engine.setPlayNotes}
        playNotesVolume={engine.playNotesVolume}
        onPlayNotesVolumeChange={engine.setPlayNotesVolume}
        micOn={engine.micOn}
        micAvailable={engine.micAvailable}
        onMicToggle={engine.toggleMic}
        loopEnabled={engine.loopEnabled}
        onLoopEnabledChange={engine.setLoopEnabled}
        loopRange={engine.loopRange}
        firstBarNumber={engine.firstBarNumber}
        lastBarNumber={engine.lastBarNumber}
        onLoopRangeFromChange={engine.setLoopRangeFrom}
        onLoopRangeToChange={engine.setLoopRangeTo}
        onLoopRangeClear={engine.clearLoopRange}
        restBars={engine.restBars}
        onRestBarsChange={engine.setRestBars}
        lanes={engine.lanes}
        onLanesChange={engine.setLanes}
        zoom={engine.zoom}
        onZoomChange={engine.setZoom}
        bpmRampActive={engine.bpmRampActive}
        positionRef={engine.positionRef}
        onShowSummary={engine.sessionSummary ? () => setSummaryOpen(true) : undefined}
        practiceExtras={
          engine.mode === "grid" ? (
            <BpmRampPanel config={engine.bpmRamp} onChange={engine.setBpmRamp} micOn={engine.micOn} />
          ) : null
        }
      />

      {summaryOpen && engine.sessionSummary && (
        <SessionSummaryPanel
          lastPass={engine.sessionSummary.lastPass}
          allPasses={engine.sessionSummary.allPasses}
          onClose={() => setSummaryOpen(false)}
        />
      )}
    </div>
  );
}

export interface SongViewProps {
  initialText: string;
  settings: Settings;
  onSave: (text: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  onBack: () => void;
  /** Opens the song editor on the given song text; absent for read-only examples. */
  onEdit?: (songText: string) => void;
  onSettingsChange?: (next: Settings) => void;
  /** Identifies the song for the "recent" record (Home's continue card). */
  recentId?: { songId: string; sample?: boolean };
  /** Loop and speed to start with (Home's Continue). */
  initialState?: PracticeInitialState;
}

export function SongView({ initialText, settings, onSave, onBack, onEdit, onSettingsChange, recentId, initialState }: SongViewProps) {
  const { toast } = useShell();
  const [text, setText] = useState(initialText);
  const [savedText, setSavedText] = useState(initialText);
  const debouncedText = useDebouncedValue(text, 300);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editorRef = useRef<SongEditorHandle | null>(null);

  const initialParse = useMemo(() => parse(initialText), [initialText]);
  const [editing, setEditing] = useState(!initialParse.ok);
  const [shareOpen, setShareOpen] = useState(false);

  const parseResult = useMemo(() => parse(debouncedText), [debouncedText]);
  const errors: ParseError[] = parseResult.ok ? parseResult.warnings : [...parseResult.errors, ...parseResult.warnings];

  function jumpToLine(line: number, column?: number) {
    editorRef.current?.jumpToLine(line, column);
  }

  const blockingErrors = errors.filter((e) => e.severity !== "warning");
  async function copyRepairPrompt() {
    const ok = await copyToClipboard(buildRepairPrompt(blockingErrors, text));
    toast(ok ? "Repair prompt copied." : "Could not copy the repair prompt: copy it manually.", ok ? "success" : "error");
  }


  async function handleSave() {
    if (!parseResult.ok) return;
    const canonical = serialize(parseResult.song);
    const result = await onSave(canonical);
    if (result.ok) {
      setSavedText(canonical);
      setText(canonical);
      setSaveError(null);
      setEditing(false);
      toast("Song saved.");
    } else {
      setSaveError(result.message);
    }
  }

  function handleOffsetNudge(deltaMs: number) {
    if (!parseResult.ok || !parseResult.song.header.youtube) return;
    const newOffsetSec = Math.max(0, parseResult.song.header.youtube.offsetSec + deltaMs / 1000);
    setText(serialize(withYoutubeOffset(parseResult.song, newOffsetSec)));
  }

  function handleSetBar1Here(videoSec: number) {
    if (!parseResult.ok || !parseResult.song.header.youtube) return;
    setText(serialize(withYoutubeOffset(parseResult.song, videoSec)));
  }

  /** The BPM box in the transport is the song's tempo: save it with the song so
   * the library and everything else show it. Examples are read-only, so they
   * only change here (unsaved) until saved as a copy. */
  async function handleSongBpmChange(bpm: number) {
    if (!parseResult.ok) return;
    const canonical = serialize(withSongBpm(parseResult.song, bpm));
    if (recentId?.sample) {
      setText(canonical);
      return;
    }
    const result = await onSave(canonical);
    if (result.ok) {
      setSavedText(canonical);
      setText(canonical);
      setSaveError(null);
      toast(`Song tempo saved: ${Math.round(bpm)} bpm.`);
    } else {
      setSaveError(result.message);
    }
  }

  const unsaved = text !== savedText;
  const practicing = !editing && parseResult.ok;

  /** Opens the piano-roll editor on the song's canonical text (the text editor's unsaved changes are kept in the text box until saved). */
  function openEditor() {
    if (!onEdit || !parseResult.ok) return;
    onEdit(serialize(parseResult.song));
  }
  const editButtons = (
    <>
      {onEdit && (
        <button className="btn-primary" onClick={openEditor} disabled={!parseResult.ok || unsaved} title={unsaved ? "Save or undo your text changes first" : "Fix and add notes on a piano roll"}>
          Edit
        </button>
      )}
      <button onClick={() => setEditing((v) => !v)}>{editing ? "Preview / practice" : "Edit text"}</button>
    </>
  );
  const actionButtons = (
    <>
      {unsaved && <span className={pr.unsaved}>Unsaved changes</span>}
      <button onClick={() => setShareOpen(true)} disabled={!parseResult.ok}>
        <Share2 size={14} /> Share
      </button>
      {editButtons}
      <button onClick={onBack}>Back to library</button>
    </>
  );

  return (
    <div className="screen song-view">
      {!practicing && (
      <div className="screen-header">
        <h2>{parseResult.ok ? parseResult.song.header.title : "Song (has errors)"}</h2>
        {parseResult.ok && !!parseResult.song.header.capo && <span className="capo-badge song-capo">Capo {parseResult.song.header.capo}</span>}
        <div className="song-view-actions">
          {unsaved && <span className="unsaved-badge">Unsaved changes</span>}
          <button onClick={() => setShareOpen(true)} disabled={!parseResult.ok}>
            <Share2 size={14} /> Share
          </button>
          {editButtons}
          <button onClick={onBack}>Back to library</button>
        </div>
      </div>
      )}

      {saveError && <div className="notice notice-error">Could not save: {saveError}</div>}
      {shareOpen && parseResult.ok && <ShareDialog title={parseResult.song.header.title} text={serialize(parseResult.song)} onClose={() => setShareOpen(false)} />}

      {editing ? (
        <div className={ed.split}>
          <div className={ed.pane}>
            <SongEditor ref={editorRef} value={text} onChange={setText} errors={errors} className={ed.editorHost} />
            <ProblemsPanel
              errors={errors}
              onJump={jumpToLine}
              actions={
                blockingErrors.length > 0 ? (
                  <button onClick={() => void copyRepairPrompt()}>
                    <Copy size={14} /> Copy repair prompt
                  </button>
                ) : null
              }
            />
            <SyntaxReference />
            <div className={ed.actions}>
              <span className={ed.hint}>Comments and blank lines are not kept when saving.</span>
              <button className={`btn-primary ${ed.actionsEnd}`} disabled={!parseResult.ok || !unsaved} onClick={() => void handleSave()}>
                Save
              </button>
            </div>
          </div>
          <div className={ed.pane}>
            {parseResult.ok ? (
              <EditorPreview song={parseResult.song} settings={settings} />
            ) : (
              <div className={ed.previewEmpty}>Fix the errors to see the preview</div>
            )}
          </div>
        </div>
      ) : parseResult.ok ? (
        <PracticeArea
          song={parseResult.song}
          settings={settings}
          onOffsetNudge={handleOffsetNudge}
          onSetBar1Here={handleSetBar1Here}
          onSongBpmChange={(bpm) => void handleSongBpmChange(bpm)}
          onSettingsChange={onSettingsChange}
          recentId={recentId}
          initialState={initialState}
          headerActions={actionButtons}
        />
      ) : (
        <ProblemsPanel errors={errors} onJump={(line, col) => { setEditing(true); window.setTimeout(() => jumpToLine(line, col), 0); }} />
      )}
    </div>
  );
}
