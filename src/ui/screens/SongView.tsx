// Song view (spec 8-10, 11.1 editor toggle, 12.2). Two modes:
//  - "practice": sheet + transport + mic feedback (usePlaybackEngine).
//  - "edit": raw text editor with live (debounced) re-parse, errors with
//    click-to-jump, and Save (spec 4.3 rule 1: text is the source of truth).

import { useEffect, useMemo, useRef, useState } from "react";
import type { ParseError, Settings, Song } from "../../model";
import { buildRepairPrompt, parse, serialize, withYoutubeOffset } from "../../songFormat";
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
import { Copy, Mic, MicOff, VideoOff } from "lucide-react";
import { ChipRow, StatusChip } from "../shell/StatusChip";
import { useShell } from "../shell/AppShellContext";

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

export function PracticeArea({
  song,
  settings,
  onOffsetNudge,
  onSetBar1Here,
  onSettingsChange,
}: {
  song: Song;
  settings: Settings;
  onOffsetNudge: (deltaMs: number) => void;
  onSetBar1Here: (videoSec: number) => void;
  onSettingsChange?: (next: Settings) => void;
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
  const [widthRef, width] = useElementWidth(900);
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
          if (eng.mode === "grid") eng.setSpeedPercent(Math.max(25, eng.speedPercent - 5));
          break;
        case "]":
          if (eng.mode === "grid") eng.setSpeedPercent(Math.min(200, eng.speedPercent + 5));
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
        speedPercent={engine.speedPercent}
        onSpeedPercentChange={engine.setSpeedPercent}
        onBpmFieldChange={engine.setBpmField}
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
        practiceExtras={
          engine.mode === "grid" ? (
            <BpmRampPanel config={engine.bpmRamp} onChange={engine.setBpmRamp} micOn={engine.micOn} />
          ) : null
        }
      />

      {engine.sessionSummary && (
        <SessionSummaryPanel
          lastPass={engine.sessionSummary.lastPass}
          allPasses={engine.sessionSummary.allPasses}
          onClose={engine.closeSessionSummary}
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
  onSettingsChange?: (next: Settings) => void;
}

export function SongView({ initialText, settings, onSave, onBack, onSettingsChange }: SongViewProps) {
  const { toast } = useShell();
  const [text, setText] = useState(initialText);
  const [savedText, setSavedText] = useState(initialText);
  const debouncedText = useDebouncedValue(text, 300);
  const [saveError, setSaveError] = useState<string | null>(null);
  const editorRef = useRef<SongEditorHandle | null>(null);

  const initialParse = useMemo(() => parse(initialText), [initialText]);
  const [editing, setEditing] = useState(!initialParse.ok);

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

  const unsaved = text !== savedText;

  return (
    <div className="screen song-view">
      <div className="screen-header">
        <h2>{parseResult.ok ? parseResult.song.header.title : "Song (has errors)"}</h2>
        <div className="song-view-actions">
          {unsaved && <span className="unsaved-badge">Unsaved changes</span>}
          <button onClick={() => setEditing((v) => !v)}>{editing ? "Preview / practice" : "Edit text"}</button>
          <button onClick={onBack}>Back to library</button>
        </div>
      </div>

      {saveError && <div className="notice notice-error">Could not save: {saveError}</div>}

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
          onSettingsChange={onSettingsChange}
        />
      ) : (
        <ProblemsPanel errors={errors} onJump={(line, col) => { setEditing(true); window.setTimeout(() => jumpToLine(line, col), 0); }} />
      )}
    </div>
  );
}
