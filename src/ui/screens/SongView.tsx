// Song view (spec 8-10, 11.1 editor toggle, 12.2). Two modes:
//  - "practice": sheet + transport + mic feedback (usePlaybackEngine).
//  - "edit": raw text editor with live (debounced) re-parse, errors with
//    click-to-jump, and Save (spec 4.3 rule 1: text is the source of truth).

import { useEffect, useMemo, useRef, useState } from "react";
import type { ParseError, Settings, Song } from "../../model";
import { parse, serialize, withYoutubeOffset } from "../../songFormat";
import { computeLayout } from "../../layout";
import { Sheet, buildSongIndex } from "../../render";
import { TransportBar } from "../components/TransportBar";
import { BpmRampPanel } from "../components/BpmRampPanel";
import { ErrorList } from "../components/ErrorList";
import { SessionSummaryPanel } from "../components/SessionSummaryPanel";
import { usePlaybackEngine } from "../usePlaybackEngine";
import { offsetOfLine, useDebouncedValue } from "../utils";
import { useElementWidth } from "../useElementWidth";
import { Mic, MicOff, VideoOff } from "lucide-react";
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

  useEffect(() => setViewportWidth(width), [width, setViewportWidth]);

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

  return (
    <div className="practice-area" ref={(el) => widthRef(el)}>
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
      />

      {engine.mode === "grid" && (
        <BpmRampPanel config={engine.bpmRamp} onChange={engine.setBpmRamp} micOn={engine.micOn} />
      )}

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

      {engine.mode === "video" && engine.hasVideo && (
        <div className="video-panel" style={{ height: videoPanelHeight }}>
          <div ref={engine.videoMountRef} className="video-mount" />
          <div className="video-controls">
            {OFFSET_STEPS_MS.map((d) => (
              <button key={d} onClick={() => engine.nudgeVideoOffset(d)}>
                {d > 0 ? `+${d}` : d} ms
              </button>
            ))}
            <button onClick={engine.setBar1Here}>Set bar 1 here</button>
          </div>
          <div className="video-resize-handle" onMouseDown={startResize} />
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
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const initialParse = useMemo(() => parse(initialText), [initialText]);
  const [editing, setEditing] = useState(!initialParse.ok);

  const parseResult = useMemo(() => parse(debouncedText), [debouncedText]);
  const errors: ParseError[] = parseResult.ok ? parseResult.warnings : [...parseResult.errors, ...parseResult.warnings];

  function jumpToLine(line: number) {
    const ta = textareaRef.current;
    if (!ta) return;
    const offset = offsetOfLine(text, line);
    ta.focus();
    ta.setSelectionRange(offset, offset + (text.slice(offset).split("\n")[0]?.length ?? 0));
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
        <div className="editor-pane">
          <textarea
            ref={textareaRef}
            className="song-editor"
            value={text}
            onChange={(e) => setText(e.target.value)}
            spellCheck={false}
          />
          <div className="editor-side">
            <button className="btn-primary" disabled={!parseResult.ok} onClick={() => void handleSave()}>
              Save
            </button>
            <ErrorList errors={errors} onJump={jumpToLine} />
            {parseResult.ok && <EditorPreview song={parseResult.song} settings={settings} />}
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
        <ErrorList errors={errors} onJump={jumpToLine} />
      )}
    </div>
  );
}
