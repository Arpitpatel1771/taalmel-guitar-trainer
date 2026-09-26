// Settings screen (spec 11.4). Storage-agnostic: parent owns persistence.

import type { LaneId, PracticeMode, Settings } from "../../model";

export interface SettingsScreenProps {
  settings: Settings;
  onChange: (next: Settings) => void;
  onOpenCalibration: () => void;
  onBack: () => void;
}

const LANE_LABELS: Record<LaneId, string> = { tab: "Tab", letter: "Letters", teacher: "Teacher notation" };

export function SettingsScreen({ settings, onChange, onOpenCalibration, onBack }: SettingsScreenProps) {
  function patch(partial: Partial<Settings>) {
    onChange({ ...settings, ...partial });
  }

  return (
    <div className="screen settings-screen">
      <div className="screen-header">
        <h2>Settings</h2>
        <button onClick={onBack}>Back</button>
      </div>

      <section>
        <h3>Calibration</h3>
        {settings.calibration ? (
          <p>
            {settings.calibration.latencyMs.toFixed(1)} ms ({settings.calibration.method}), measured{" "}
            {new Date(settings.calibration.measuredAt).toLocaleString()}
          </p>
        ) : (
          <p>Not calibrated -- mic feedback timing may look off.</p>
        )}
        <button onClick={onOpenCalibration}>Open calibration</button>
      </section>

      <section>
        <h3>Lanes shown by default</h3>
        {(Object.keys(LANE_LABELS) as LaneId[]).map((lane) => (
          <label key={lane} className="checkbox">
            <input
              type="checkbox"
              checked={settings.lanes[lane]}
              onChange={(e) => patch({ lanes: { ...settings.lanes, [lane]: e.target.checked } })}
            />
            {LANE_LABELS[lane]}
          </label>
        ))}
      </section>

      <section>
        <h3>Default zoom ({settings.zoom}px/bar)</h3>
        <input
          type="range"
          min={120}
          max={800}
          step={10}
          value={settings.zoom}
          onChange={(e) => patch({ zoom: Number(e.target.value) })}
        />
      </section>

      <section>
        <h3>Default mode</h3>
        <select value={settings.defaultMode} onChange={(e) => patch({ defaultMode: e.target.value as PracticeMode })}>
          <option value="grid">Grid</option>
          <option value="video">Video (when available)</option>
        </select>
      </section>

      <section>
        <h3>Metronome</h3>
        <label>
          Volume
          <input
            type="range"
            min={0}
            max={1}
            step={0.05}
            value={settings.metronomeVolume}
            onChange={(e) => patch({ metronomeVolume: Number(e.target.value) })}
          />
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={settings.metronomeMuted} onChange={(e) => patch({ metronomeMuted: e.target.checked })} />
          Muted by default
        </label>
        <label className="checkbox">
          <input
            type="checkbox"
            checked={settings.subdivisionClicks}
            onChange={(e) => patch({ subdivisionClicks: e.target.checked })}
          />
          Subdivision clicks
        </label>
        <label className="checkbox">
          <input type="checkbox" checked={settings.countIn} onChange={(e) => patch({ countIn: e.target.checked })} />
          Count-in by default
        </label>
      </section>

      <section>
        <h3>Microphone</h3>
        <label className="checkbox">
          <input type="checkbox" checked={settings.micEnabled} onChange={(e) => patch({ micEnabled: e.target.checked })} />
          Start the mic automatically on Play
        </label>
      </section>

      <section>
        <h3>Timing tiers</h3>
        <label>
          On time (ms)
          <input
            type="number"
            value={settings.tiers.onTimeMs}
            onChange={(e) => patch({ tiers: { ...settings.tiers, onTimeMs: Number(e.target.value) } })}
          />
        </label>
        <label>
          Close (ms)
          <input
            type="number"
            value={settings.tiers.closeMs}
            onChange={(e) => patch({ tiers: { ...settings.tiers, closeMs: Number(e.target.value) } })}
          />
        </label>
        <label>
          Miss window (ms)
          <input
            type="number"
            value={settings.tiers.missWindowMs}
            onChange={(e) => patch({ tiers: { ...settings.tiers, missWindowMs: Number(e.target.value) } })}
          />
        </label>
      </section>
    </div>
  );
}
