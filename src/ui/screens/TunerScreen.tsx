// Tuner screen (spec 10.4). Standard tuning only.

import type { Settings } from "../../model";
import { TunerPanel } from "../components/TunerPanel";

export function TunerScreen({ settings, onChange }: { settings: Settings; onChange: (next: Settings) => void }) {
  return (
    <div className="screen">
      <div className="screen-header">
        <h2>Tuner</h2>
      </div>
      <div style={{ maxWidth: 560, background: "var(--surface-1)", border: "1px solid var(--border-subtle)", borderRadius: "var(--radius-md)" }}>
        <TunerPanel a4Hz={settings.a4Hz} onA4Change={(hz) => onChange({ ...settings, a4Hz: hz })} />
      </div>
    </div>
  );
}
