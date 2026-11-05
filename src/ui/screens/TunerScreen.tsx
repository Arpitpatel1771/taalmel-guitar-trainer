// Tuner screen (spec 10.4). Standard tuning only.

import type { Settings } from "../../model";
import { Card } from "../components/kit";
import { PageHead } from "../components/PageHead";
import { TunerPanel } from "../components/TunerPanel";

export function TunerScreen({ settings, onChange }: { settings: Settings; onChange: (next: Settings) => void }) {
  return (
    <div className="screen">
      <PageHead title="Tuner" sub="Pluck one open string and turn its peg until the note turns green." />
      <Card style={{ maxWidth: 560, padding: 0 }}>
        <TunerPanel a4Hz={settings.a4Hz} onA4Change={(hz) => onChange({ ...settings, a4Hz: hz })} />
      </Card>
    </div>
  );
}
