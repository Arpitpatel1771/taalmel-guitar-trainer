// Settings screen (spec 11.4). Storage-agnostic: parent owns persistence.

import type { ReactNode } from "react";
import type { LaneId, PracticeMode, Settings } from "../../model";
import { Field, Segmented, Stepper } from "../components/Controls";
import st from "./Settings.module.css";

export interface SettingsScreenProps {
  settings: Settings;
  onChange: (next: Settings) => void;
  onOpenCalibration: () => void;
  onBack: () => void;
}

const LANE_LABELS: Record<LaneId, string> = { tab: "Tab", letter: "Letters", teacher: "Teacher notation" };

// Defined at module level (not inside SettingsScreen) so React keeps the same
// component identity across renders; otherwise sliders remount mid-drag.
function Row({ label, help, children }: { label: string; help?: string; children: ReactNode }) {
  return (
    <div className={st.row}>
      <div className={st.text}>
        <span className={st.label}>{label}</span>
        {help && <span className={st.help}>{help}</span>}
      </div>
      <div className={st.control}>{children}</div>
    </div>
  );
}

function Toggle({ checked, onToggle, label }: { checked: boolean; onToggle: (v: boolean) => void; label: string }) {
  return <input type="checkbox" aria-label={label} checked={checked} onChange={(e) => onToggle(e.target.checked)} />;
}

export function SettingsScreen({ settings, onChange, onOpenCalibration, onBack }: SettingsScreenProps) {
  function patch(partial: Partial<Settings>) {
    onChange({ ...settings, ...partial });
  }

  const t = settings.tiers;
  const total = Math.max(t.missWindowMs, t.closeMs, 1);
  return (
    <div className="screen settings-screen">
      <div className="screen-header">
        <h2>Settings</h2>
        <button className="btn-ghost" onClick={onBack}>
          Done
        </button>
      </div>

      <div className={st.wrap}>
        <section className={st.group}>
          <div className={st.groupTitle}>Practice</div>
          <Row label="Default clock" help="Video mode is used only for songs that have a YouTube link.">
            <Segmented
              label="Default clock"
              value={settings.defaultMode}
              options={[
                { value: "grid" as PracticeMode, label: "Grid" },
                { value: "video" as PracticeMode, label: "Video" },
              ]}
              onChange={(v) => patch({ defaultMode: v })}
            />
          </Row>
          <Row label="Count-in" help="One bar of clicks before bar 1.">
            <Toggle label="Count-in" checked={settings.countIn} onToggle={(v) => patch({ countIn: v })} />
          </Row>
          <Row label="Metronome volume">
            <input
              type="range"
              min={0}
              max={1}
              step={0.05}
              value={settings.metronomeVolume}
              onChange={(e) => patch({ metronomeVolume: Number(e.target.value) })}
            />
            <span className={st.value}>{Math.round(settings.metronomeVolume * 100)}%</span>
          </Row>
          <Row label="Metronome muted by default">
            <Toggle label="Metronome muted by default" checked={settings.metronomeMuted} onToggle={(v) => patch({ metronomeMuted: v })} />
          </Row>
          <Row label="Subdivision clicks" help="Quieter clicks on every grid slot.">
            <Toggle label="Subdivision clicks" checked={settings.subdivisionClicks} onToggle={(v) => patch({ subdivisionClicks: v })} />
          </Row>
        </section>

        <section className={st.group}>
          <div className={st.groupTitle}>Feedback &amp; timing</div>
          <Row label="Start the mic on Play" help="Listens for your plucks and grades timing and pitch.">
            <Toggle label="Start the mic on Play" checked={settings.micEnabled} onToggle={(v) => patch({ micEnabled: v })} />
          </Row>
          <Row
            label="Latency calibration"
            help={
              settings.calibration
                ? `${settings.calibration.latencyMs.toFixed(1)} ms (${settings.calibration.method === "loopback" ? "speakers" : "tap"}), ${new Date(settings.calibration.measuredAt).toLocaleDateString()}`
                : "Not calibrated: timing may look late."
            }
          >
            <button onClick={onOpenCalibration}>{settings.calibration ? "Recalibrate" : "Calibrate"}</button>
          </Row>
          <div className={st.tiers}>
            <div className={st.text}>
              <span className={st.label}>Timing tiers</span>
              <span className={st.help}>How far from the beat a pluck can be and still count as on time or close.</span>
            </div>
            <div className={st.zoneBar} aria-hidden>
              <span className={st.zoneOn} style={{ width: `${(Math.min(t.onTimeMs, total) / total) * 100}%` }} />
              <span className={st.zoneClose} style={{ width: `${(Math.max(0, Math.min(t.closeMs, total) - t.onTimeMs) / total) * 100}%` }} />
              <span className={st.zoneOff} style={{ flex: 1 }} />
            </div>
            <div className={st.zoneLegend}>
              <span>0 ms</span>
              <span>on time ≤ {t.onTimeMs}</span>
              <span>close ≤ {t.closeMs}</span>
              <span>missed after {t.missWindowMs}</span>
            </div>
            <div className={st.tierInputs}>
              <Field label="On time (ms)">
                <Stepper label="On time" value={t.onTimeMs} min={5} max={t.closeMs} step={5} onChange={(v) => patch({ tiers: { ...t, onTimeMs: v } })} />
              </Field>
              <Field label="Close (ms)">
                <Stepper label="Close" value={t.closeMs} min={t.onTimeMs} max={t.missWindowMs} step={5} onChange={(v) => patch({ tiers: { ...t, closeMs: v } })} />
              </Field>
              <Field label="Miss window (ms)">
                <Stepper label="Miss window" value={t.missWindowMs} min={t.closeMs} max={500} step={10} onChange={(v) => patch({ tiers: { ...t, missWindowMs: v } })} />
              </Field>
            </div>
          </div>
        </section>

        <section className={st.group}>
          <div className={st.groupTitle}>Display</div>
          {(Object.keys(LANE_LABELS) as LaneId[]).map((lane) => (
            <Row key={lane} label={`${LANE_LABELS[lane]} lane`} help={lane === "teacher" ? "Letter + register dot + fret-zone digit." : undefined}>
              <Toggle
                label={`${LANE_LABELS[lane]} lane`}
                checked={settings.lanes[lane]}
                onToggle={(v) => patch({ lanes: { ...settings.lanes, [lane]: v } })}
              />
            </Row>
          ))}
          <Row label="Default zoom" help="Width of one bar on screen.">
            <input type="range" min={120} max={800} step={10} value={settings.zoom} onChange={(e) => patch({ zoom: Number(e.target.value) })} />
            <span className={st.value}>{settings.zoom}px</span>
          </Row>
        </section>
      </div>
    </div>
  );
}
