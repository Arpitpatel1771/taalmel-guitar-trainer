// Transport pill (specs/5-11-ui-redesign.md 5; spec 10.1, 10.3, 12.2). Pure
// controlled component: all state lives in usePlaybackEngine. The pill holds
// Play, Stop, the loop button, practice tempo, song BPM, mic and the bar:beat readout; the
// "..." popover holds everything else (loop bars, count-in, metronome, play
// notes, lanes, zoom). The tuner lives in the pocket.

import { useRef, useState, type ReactNode, type RefObject } from "react";
import { BarChart3, MoreHorizontal, Pause, Play, Mic, MicOff, Repeat, Square, X } from "lucide-react";
import type { LaneId, PracticeMode } from "../../model";
import { MAX_BPM, MIN_BPM, type RestBars } from "../usePlaybackEngine";
import { NumberInput } from "./Controls";
import { Popover } from "./Popover";
import { Slider } from "./kit";
import { factorBpmLabel, practiceBpmRange } from "../tempoLabels";
import styles from "./TransportDock.module.css";

export interface TransportBarProps {
  playing: boolean;
  onPlayPause: () => void;
  onStop: () => void;

  mode: PracticeMode;
  hasVideo: boolean;
  onModeChange: (mode: PracticeMode) => void;

  baseBpm: number;
  currentBpm: number;
  /** Practice tempo in bpm; starts at the song's tempo, the song is not changed. */
  onPracticeBpmChange: (bpm: number) => void;
  /** Commits a new tempo for the song itself (saved with the song). */
  onSongBpmChange: (bpm: number) => void;

  videoRate: number;
  availableVideoRates: number[];
  onVideoRateChange: (rate: number) => void;

  countIn: boolean;
  onCountInChange: (v: boolean) => void;

  metronomeVolume: number;
  metronomeMuted: boolean;
  onVolumeChange: (v: number) => void;
  onMuteChange: (v: boolean) => void;

  subdivisionOn: boolean;
  onSubdivisionChange: (v: boolean) => void;

  playNotes: boolean;
  onPlayNotesChange: (v: boolean) => void;
  playNotesVolume: number;
  onPlayNotesVolumeChange: (v: number) => void;

  micOn: boolean;
  micAvailable: boolean;
  onMicToggle: () => void;

  loopEnabled: boolean;
  onLoopEnabledChange: (v: boolean) => void;
  loopRange: { start: number; end: number } | null;
  firstBarNumber: number;
  lastBarNumber: number;
  onLoopRangeFromChange: (bar: number) => void;
  onLoopRangeToChange: (bar: number) => void;
  onLoopRangeClear: () => void;
  restBars: RestBars;
  onRestBarsChange: (n: RestBars) => void;

  lanes: Record<LaneId, boolean>;
  onLanesChange: (lanes: Record<LaneId, boolean>) => void;

  zoom: number;
  onZoomChange: (zoom: number) => void;

  bpmRampActive: boolean;
  /** Bar:beat readout, written per frame by PlaybackController (not React). */
  positionRef?: RefObject<HTMLSpanElement | null>;
  /** Opens the last take's summary; absent until a take has been scored. */
  onShowSummary?: () => void;
  /** Extra content for the Practice popover (e.g. the BPM ramp panel). */
  practiceExtras?: ReactNode;
}

const LANE_LABELS: Record<LaneId, string> = { tab: "Tab", letter: "Letters" };
const REST_BARS_OPTIONS: RestBars[] = [0, 1, 2, 4];

/** The song's tempo in BPM. Typing edits a local draft; the value is applied on
 * Enter or blur (clamped to MIN_BPM..MAX_BPM), and Escape reverts, so partial
 * input like "1" on the way to "112" never reaches the song. */
function BpmInput({ value, onCommit }: { value: number; onCommit: (bpm: number) => void }) {
  const [draft, setDraftState] = useState<string | null>(null);
  // Enter commits and then blurs, which commits again: the ref makes the second call a no-op.
  const draftRef = useRef<string | null>(null);
  const setDraft = (d: string | null) => {
    draftRef.current = d;
    setDraftState(d);
  };

  function commit() {
    const d = draftRef.current;
    if (d === null) return;
    setDraft(null);
    const n = Number(d);
    if (d.trim() !== "" && Number.isFinite(n) && n > 0 && Math.round(n) !== value) onCommit(Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(n))));
  }

  return (
    <input
      className={styles.bpmInput}
      type="text"
      inputMode="numeric"
      aria-label="Song BPM"
      title={`Song tempo in BPM (${MIN_BPM}-${MAX_BPM}; Enter saves it to the song)`}
      value={draft ?? String(value)}
      onFocus={(e) => e.currentTarget.select()}
      onChange={(e) => setDraft(e.target.value.replace(/[^0-9.]/g, ""))}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          commit();
          e.currentTarget.blur();
        } else if (e.key === "Escape") {
          setDraft(null);
          e.currentTarget.blur();
        }
      }}
    />
  );
}

export function TransportBar(props: TransportBarProps) {
  const rangeFrom = props.loopRange?.start ?? props.firstBarNumber;
  const rangeTo = props.loopRange?.end ?? props.lastBarNumber;
  const grid = props.mode === "grid";
  const range = practiceBpmRange(props.baseBpm);
  const practiceBpm = Math.round(props.currentBpm);
  const loopLabel =
    props.loopRange && props.loopRange.start !== props.loopRange.end
      ? `Loop bars ${props.loopRange.start}\u2013${props.loopRange.end}`
      : props.loopRange
        ? `Loop bar ${props.loopRange.start}`
        : "Loop";

  return (
    <div className={styles.pill}>
      <button
        className={styles.playBtn}
        onClick={props.onPlayPause}
        aria-label={props.playing ? "Pause" : "Play"}
        title={props.playing ? "Pause (Space)" : "Play (Space)"}
      >
        {props.playing ? <Pause size={24} fill="currentColor" /> : <Play size={24} fill="currentColor" />}
      </button>
      <button className={styles.iconBtn} onClick={props.onStop} aria-label="Stop" title="Stop (Esc)">
        <Square size={16} />
      </button>

      <button
        className={`${styles.loopBtn}${props.loopEnabled ? ` ${styles.on}` : ""}`}
        onClick={() => props.onLoopEnabledChange(!props.loopEnabled)}
        aria-pressed={props.loopEnabled}
        title="Loop (L). Drag across bar numbers on the sheet to pick a range."
      >
        <Repeat size={16} />
        {loopLabel}
      </button>

      <div className={styles.speed}>
        {grid ? (
          <>
            <span className={styles.tempoMeta}>Practice at</span>
            <Slider
              label="Practice at (bpm)"
              min={range.min}
              max={range.max}
              step={1}
              value={Math.min(range.max, Math.max(range.min, practiceBpm))}
              onChange={props.onPracticeBpmChange}
              className={styles.speedSlider}
            />
            <span className={styles.speedValue} title="Practice tempo ([ and ] change it by 5 bpm)">
              {practiceBpm} bpm{props.bpmRampActive ? " \u00b7 ramping" : ""}
            </span>
            {practiceBpm !== props.baseBpm && (
              <button className={styles.ghostBtn} onClick={() => props.onPracticeBpmChange(props.baseBpm)}>
                Back to {props.baseBpm} bpm
              </button>
            )}
          </>
        ) : (
          <>
            <select value={props.videoRate} onChange={(e) => props.onVideoRateChange(Number(e.target.value))} aria-label="Video tempo">
              {props.availableVideoRates.map((r) => (
                <option key={r} value={r}>
                  {factorBpmLabel(props.baseBpm, r)}
                </option>
              ))}
            </select>
            <span className={styles.tempoMeta}>video tempo</span>
          </>
        )}
      </div>

      {grid && (
        <div className={styles.tempo}>
          <BpmInput value={props.baseBpm} onCommit={props.onSongBpmChange} />
          <span className={styles.tempoMeta}>BPM</span>
        </div>
      )}

      <button
        className={`${styles.iconBtn}${props.micOn ? ` ${styles.on}` : ""}`}
        onClick={props.onMicToggle}
        disabled={!props.micAvailable}
        aria-pressed={props.micOn}
        aria-label="Microphone feedback"
        title="Microphone feedback (M)"
      >
        {props.micOn ? <Mic size={16} /> : <MicOff size={16} />}
      </button>

      {props.onShowSummary && (
        <button className={styles.iconBtn} onClick={props.onShowSummary} aria-label="Last take summary" title="Last take summary">
          <BarChart3 size={16} />
        </button>
      )}

      <div className={styles.position} title="Bar : beat">
        <span ref={props.positionRef}>1:1</span>
      </div>

      <Popover
        label="More controls"
        width={340}
        trigger={<MoreHorizontal size={20} />}
        triggerClassName={styles.moreBtn}
      >
        <div className={styles.panelSection}>
          <div className={styles.panelTitle}>Loop</div>
          <div className={styles.row}>
            Bars
            <span className={styles.loopRange}>
              <NumberInput
                aria-label="Loop from bar"
                integer
                min={props.firstBarNumber}
                max={props.lastBarNumber}
                value={rangeFrom}
                onCommit={(v) => v !== null && props.onLoopRangeFromChange(v)}
              />
              <span className={styles.dim}>to</span>
              <NumberInput
                aria-label="Loop to bar"
                integer
                min={props.firstBarNumber}
                max={props.lastBarNumber}
                value={rangeTo}
                onCommit={(v) => v !== null && props.onLoopRangeToChange(v)}
              />
              {props.loopRange && (
                <button className={styles.clearBtn} onClick={props.onLoopRangeClear} aria-label="Loop whole song" title="Loop whole song">
                  <X size={12} />
                </button>
              )}
            </span>
          </div>
          {grid && (
            <label className={styles.row}>
              Rest between loops
              <select value={props.restBars} onChange={(e) => props.onRestBarsChange(Number(e.target.value) as RestBars)}>
                {REST_BARS_OPTIONS.map((n) => (
                  <option key={n} value={n}>
                    {n === 0 ? "None" : `${n} bar${n > 1 ? "s" : ""}`}
                  </option>
                ))}
              </select>
            </label>
          )}
          {grid && props.practiceExtras}
        </div>
        {grid && (
          <div className={styles.panelSection}>
            <div className={styles.panelTitle}>Tempo</div>
            <label className={styles.row}>
              Practice at
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={1}
                value={Math.min(range.max, Math.max(range.min, practiceBpm))}
                onChange={(e) => props.onPracticeBpmChange(Number(e.target.value))}
              />
              <span className={styles.value}>{practiceBpm} bpm</span>
            </label>
            <button className={styles.ghostBtn} onClick={() => props.onPracticeBpmChange(props.baseBpm)} disabled={practiceBpm === props.baseBpm}>
              Back to song tempo ({props.baseBpm} bpm)
            </button>
            <label className={styles.row}>
              <input type="checkbox" checked={props.countIn} onChange={(e) => props.onCountInChange(e.target.checked)} />
              Count-in bar
            </label>
          </div>
        )}
        <div className={styles.panelSection}>
          <div className={styles.panelTitle}>Metronome</div>
          <label className={styles.row}>
            <input type="checkbox" checked={!props.metronomeMuted} onChange={(e) => props.onMuteChange(!e.target.checked)} />
            Click on
          </label>
          <label className={styles.row}>
            Volume
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={props.metronomeVolume}
              onChange={(e) => props.onVolumeChange(Number(e.target.value))}
              disabled={props.metronomeMuted}
            />
          </label>
          <label className={styles.row}>
            <input type="checkbox" checked={props.subdivisionOn} onChange={(e) => props.onSubdivisionChange(e.target.checked)} />
            Subdivision clicks
          </label>
        </div>
        <div className={styles.panelSection}>
          <div className={styles.panelTitle}>Play notes (guitar)</div>
          <label className={styles.row}>
            <input type="checkbox" checked={props.playNotes} onChange={(e) => props.onPlayNotesChange(e.target.checked)} />
            Play the song with a synthetic guitar
          </label>
          <label className={styles.row}>
            Volume
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={props.playNotesVolume}
              onChange={(e) => props.onPlayNotesVolumeChange(Number(e.target.value))}
              disabled={!props.playNotes}
            />
          </label>
        </div>
        <div className={styles.panelSection}>
          <div className={styles.panelTitle}>View</div>
          {(Object.keys(LANE_LABELS) as LaneId[]).map((lane) => (
            <label key={lane} className={styles.row}>
              <input
                type="checkbox"
                checked={props.lanes[lane]}
                onChange={(e) => props.onLanesChange({ ...props.lanes, [lane]: e.target.checked })}
              />
              {LANE_LABELS[lane]} lane
            </label>
          ))}
          <label className={styles.row}>
            Zoom
            <input type="range" min={120} max={800} step={10} value={props.zoom} onChange={(e) => props.onZoomChange(Number(e.target.value))} />
            <span className={styles.value}>{props.zoom}px/bar</span>
          </label>
        </div>
      </Popover>
    </div>
  );
}
