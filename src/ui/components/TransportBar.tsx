// Transport bar (spec 10.1, 10.3, 12.2). Pure controlled component: all state
// lives in the parent (SongView / usePlaybackEngine); this only renders
// controls and forwards discrete change events (never per-frame).

import type { LaneId, PracticeMode } from "../../model";
import type { RestBars } from "../usePlaybackEngine";

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
}

const LANE_LABELS: Record<LaneId, string> = { tab: "Tab", letter: "Letters", teacher: "Teacher" };
const REST_BARS_OPTIONS: RestBars[] = [0, 1, 2, 4];

export function TransportBar(props: TransportBarProps) {
  const rangeFrom = props.loopRange?.start ?? props.firstBarNumber;
  const rangeTo = props.loopRange?.end ?? props.lastBarNumber;

  return (
    <div className="transport-bar">
      <div className="transport-group">
        <button className="btn-primary" onClick={props.onPlayPause}>
          {props.playing ? "Pause" : "Play"}
        </button>
        <button onClick={props.onStop}>Stop</button>
      </div>

      <div className="transport-group">
        <label className="mode-toggle">
          <select
            value={props.mode}
            onChange={(e) => props.onModeChange(e.target.value as PracticeMode)}
            disabled={!props.hasVideo}
          >
            <option value="grid">Grid</option>
            <option value="video">Video</option>
          </select>
        </label>
      </div>

      {props.mode === "grid" ? (
        <div className="transport-group">
          <label>
            BPM
            <input
              type="number"
              min={1}
              max={400}
              value={Math.round(props.currentBpm)}
              onChange={(e) => props.onBpmFieldChange(Number(e.target.value))}
              className="bpm-field"
            />
          </label>
          <input
            type="range"
            min={25}
            max={200}
            step={1}
            value={props.speedPercent}
            onChange={(e) => props.onSpeedPercentChange(Number(e.target.value))}
          />
          <span className="speed-readout">{props.speedPercent}%</span>
          {props.bpmRampActive && <span className="badge">ramping</span>}
          <label className="checkbox">
            <input type="checkbox" checked={props.countIn} onChange={(e) => props.onCountInChange(e.target.checked)} />
            Count-in
          </label>
        </div>
      ) : (
        <div className="transport-group">
          <label>
            Rate
            <select
              value={props.videoRate}
              onChange={(e) => props.onVideoRateChange(Number(e.target.value))}
            >
              {props.availableVideoRates.map((r) => (
                <option key={r} value={r}>
                  {r}x
                </option>
              ))}
            </select>
          </label>
        </div>
      )}

      <div className="transport-group">
        <label className="checkbox">
          <input type="checkbox" checked={!props.metronomeMuted} onChange={(e) => props.onMuteChange(!e.target.checked)} />
          Metronome
        </label>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={props.metronomeVolume}
          onChange={(e) => props.onVolumeChange(Number(e.target.value))}
          disabled={props.metronomeMuted}
        />
        <label className="checkbox">
          <input type="checkbox" checked={props.subdivisionOn} onChange={(e) => props.onSubdivisionChange(e.target.checked)} />
          Subdivision
        </label>
      </div>

      <div className="transport-group">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.micOn}
            disabled={!props.micAvailable}
            onChange={props.onMicToggle}
          />
          Mic
        </label>
      </div>

      <div className="transport-group loop-group">
        <label className="checkbox">
          <input
            type="checkbox"
            checked={props.loopEnabled}
            onChange={(e) => props.onLoopEnabledChange(e.target.checked)}
          />
          Loop
        </label>
        <label className="loop-bar-input">
          From
          <input
            type="number"
            min={props.firstBarNumber}
            max={props.lastBarNumber}
            value={rangeFrom}
            onChange={(e) => props.onLoopRangeFromChange(Number(e.target.value))}
          />
        </label>
        <label className="loop-bar-input">
          To
          <input
            type="number"
            min={props.firstBarNumber}
            max={props.lastBarNumber}
            value={rangeTo}
            onChange={(e) => props.onLoopRangeToChange(Number(e.target.value))}
          />
        </label>
        {props.loopRange && (
          <span className="badge">
            Bars {props.loopRange.start}-{props.loopRange.end}
            <button className="badge-close" onClick={props.onLoopRangeClear} aria-label="Clear loop range">
              ×
            </button>
          </span>
        )}
        {props.mode === "grid" && props.loopEnabled && (
          <label>
            Rest
            <select value={props.restBars} onChange={(e) => props.onRestBarsChange(Number(e.target.value) as RestBars)}>
              {REST_BARS_OPTIONS.map((n) => (
                <option key={n} value={n}>
                  {n === 0 ? "None" : `${n} bar${n > 1 ? "s" : ""}`}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <div className="transport-group">
        {(Object.keys(LANE_LABELS) as LaneId[]).map((lane) => (
          <label key={lane} className="checkbox">
            <input
              type="checkbox"
              checked={props.lanes[lane]}
              onChange={(e) => props.onLanesChange({ ...props.lanes, [lane]: e.target.checked })}
            />
            {LANE_LABELS[lane]}
          </label>
        ))}
      </div>

      <div className="transport-group">
        <label>
          Zoom
          <input
            type="range"
            min={120}
            max={800}
            step={10}
            value={props.zoom}
            onChange={(e) => props.onZoomChange(Number(e.target.value))}
          />
        </label>
      </div>
    </div>
  );
}
