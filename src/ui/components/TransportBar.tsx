// Transport dock (spec 10.1, 10.3, 12.2; UI revamp 5.1). Pure controlled
// component: all state lives in usePlaybackEngine. Always-visible controls are
// playback, loop, tempo, mic/metronome and the bar:beat readout; everything
// else sits in the Practice and View popovers.

import { useState, type ReactNode, type RefObject } from "react";
import { Gauge, Metronome, Mic, MicOff, Pause, Play, Repeat, SlidersHorizontal, Square, Eye, X } from "lucide-react";
import type { LaneId, PracticeMode } from "../../model";
import { MAX_BPM, MIN_BPM, type RestBars } from "../usePlaybackEngine";
import { Popover } from "./Popover";
import { TunerPanel } from "./TunerPanel";
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
  speedPercent: number;
  onSpeedPercentChange: (percent: number) => void;
  onBpmFieldChange: (bpm: number) => void;

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
  /** Extra content for the Practice popover (e.g. the BPM ramp panel). */
  practiceExtras?: ReactNode;
  /** Tuner reference pitch and its setter (dock tuner popover). */
  a4Hz?: number;
  onA4Change?: (hz: number) => void;
}

const LANE_LABELS: Record<LaneId, string> = { tab: "Tab", letter: "Letters", teacher: "Teacher notation" };
const REST_BARS_OPTIONS: RestBars[] = [0, 1, 2, 4];

/** Absolute BPM field. Typing edits a local draft; the value is applied on
 * Enter or blur (clamped to MIN_BPM..MAX_BPM), and Escape reverts, so partial
 * input like "1" on the way to "112" never reaches the clock. */
function BpmInput({ value, onCommit }: { value: number; onCommit: (bpm: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);

  function commit() {
    if (draft === null) return;
    const n = Number(draft);
    if (draft.trim() !== "" && Number.isFinite(n) && n > 0) onCommit(n);
    setDraft(null);
  }

  return (
    <input
      className={styles.bpmInput}
      type="text"
      inputMode="numeric"
      aria-label="BPM"
      title={`BPM (${MIN_BPM}-${MAX_BPM}; Enter to apply, [ and ] change speed)`}
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

  return (
    <div className={styles.dock}>
      <div className={styles.group}>
        <button
          className={styles.playBtn}
          onClick={props.onPlayPause}
          aria-label={props.playing ? "Pause" : "Play"}
          title={props.playing ? "Pause (Space)" : "Play (Space)"}
        >
          {props.playing ? <Pause size={20} fill="currentColor" /> : <Play size={20} fill="currentColor" />}
        </button>
        <button className={styles.iconBtn} onClick={props.onStop} aria-label="Stop" title="Stop (Esc)">
          <Square size={16} />
        </button>
      </div>

      <div className={styles.group}>
        <button
          className={`${styles.iconBtn}${props.loopEnabled ? ` ${styles.on}` : ""}`}
          onClick={() => props.onLoopEnabledChange(!props.loopEnabled)}
          aria-pressed={props.loopEnabled}
          title="Loop (L). Drag across bar numbers on the sheet to pick a range."
        >
          <Repeat size={16} />
        </button>
        {props.loopEnabled && (
          <div className={styles.loopRange}>
            <input
              type="number"
              aria-label="Loop from bar"
              min={props.firstBarNumber}
              max={props.lastBarNumber}
              value={rangeFrom}
              onChange={(e) => props.onLoopRangeFromChange(Number(e.target.value))}
            />
            <span className={styles.dim}>to</span>
            <input
              type="number"
              aria-label="Loop to bar"
              min={props.firstBarNumber}
              max={props.lastBarNumber}
              value={rangeTo}
              onChange={(e) => props.onLoopRangeToChange(Number(e.target.value))}
            />
            {props.loopRange && (
              <button className={styles.clearBtn} onClick={props.onLoopRangeClear} aria-label="Loop whole song" title="Loop whole song">
                <X size={12} />
              </button>
            )}
          </div>
        )}
      </div>

      <div className={styles.tempo}>
        {grid ? (
          <>
            <BpmInput value={Math.round(props.currentBpm)} onCommit={props.onBpmFieldChange} />
            <span className={styles.tempoMeta}>
              BPM · {props.speedPercent}%{props.bpmRampActive ? " · ramping" : ""}
            </span>
          </>
        ) : (
          <>
            <select value={props.videoRate} onChange={(e) => props.onVideoRateChange(Number(e.target.value))} aria-label="Playback rate">
              {props.availableVideoRates.map((r) => (
                <option key={r} value={r}>
                  {r}x
                </option>
              ))}
            </select>
            <span className={styles.tempoMeta}>video rate</span>
          </>
        )}
      </div>

      <div className={styles.group}>
        <button
          className={`${styles.iconBtn}${props.micOn ? ` ${styles.on}` : ""}`}
          onClick={props.onMicToggle}
          disabled={!props.micAvailable}
          aria-pressed={props.micOn}
          title="Microphone feedback (M)"
        >
          {props.micOn ? <Mic size={16} /> : <MicOff size={16} />}
        </button>
        <button
          className={`${styles.iconBtn}${!props.metronomeMuted ? ` ${styles.on}` : ""}`}
          onClick={() => props.onMuteChange(!props.metronomeMuted)}
          aria-pressed={!props.metronomeMuted}
          title="Metronome"
        >
          <Metronome size={16} />
        </button>
      </div>

      <div className={styles.position} title="Bar : beat">
        <span ref={props.positionRef}>1:1</span>
      </div>

      <div className={styles.spacer} />

      {props.a4Hz !== undefined && props.onA4Change && (
        <Popover label="Tuner" icon={<Gauge size={15} />} width={400}>
          <TunerPanel compact autoStart a4Hz={props.a4Hz} onA4Change={props.onA4Change} />
        </Popover>
      )}

      <Popover label="Practice" icon={<SlidersHorizontal size={15} />}>
        <div className={styles.panelSection}>
          <div className={styles.panelTitle}>Tempo</div>
          {grid ? (
            <>
            <label className={styles.row}>
              BPM
              <input
                type="range"
                min={MIN_BPM}
                max={MAX_BPM}
                step={1}
                value={Math.round(props.currentBpm)}
                onChange={(e) => props.onBpmFieldChange(Number(e.target.value))}
              />
              <span className={styles.value}>{Math.round(props.currentBpm)}</span>
            </label>
            <button className={styles.ghostBtn} onClick={() => props.onBpmFieldChange(props.baseBpm)}>
              Reset to song tempo ({props.baseBpm} BPM)
            </button>
            </>
          ) : null}
          <label className={styles.row}>
            Clock
            <select value={props.mode} onChange={(e) => props.onModeChange(e.target.value as PracticeMode)} disabled={!props.hasVideo}>
              <option value="grid">Grid (metronome)</option>
              <option value="video">Video</option>
            </select>
          </label>
          {grid && (
            <label className={styles.row}>
              <input type="checkbox" checked={props.countIn} onChange={(e) => props.onCountInChange(e.target.checked)} />
              Count-in bar
            </label>
          )}
        </div>
        <div className={styles.panelSection}>
          <div className={styles.panelTitle}>Metronome</div>
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
        {grid && (
          <div className={styles.panelSection}>
            <div className={styles.panelTitle}>Loop</div>
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
            {props.practiceExtras}
          </div>
        )}
      </Popover>

      <Popover label="View" icon={<Eye size={15} />}>
        <div className={styles.panelSection}>
          <div className={styles.panelTitle}>Lanes</div>
          {(Object.keys(LANE_LABELS) as LaneId[]).map((lane) => (
            <label key={lane} className={styles.row}>
              <input
                type="checkbox"
                checked={props.lanes[lane]}
                onChange={(e) => props.onLanesChange({ ...props.lanes, [lane]: e.target.checked })}
              />
              {LANE_LABELS[lane]}
            </label>
          ))}
        </div>
        <div className={styles.panelSection}>
          <div className={styles.panelTitle}>Zoom</div>
          <label className={styles.row}>
            <input
              type="range"
              min={120}
              max={800}
              step={10}
              value={props.zoom}
              onChange={(e) => props.onZoomChange(Number(e.target.value))}
            />
            <span className={styles.value}>{props.zoom}px/bar</span>
          </label>
        </div>
      </Popover>
    </div>
  );
}
