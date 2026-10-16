// BPM ramp configuration (spec 12.2): for any loop, grid mode only. Start
// BPM, step, optional max, and an advance condition (after M passes, or after
// M consecutive accurate passes when mic is on).

import { MAX_BPM, MIN_BPM, type BpmRampConfig } from "../usePlaybackEngine";
import { NumberInput } from "./Controls";

export interface BpmRampPanelProps {
  config: BpmRampConfig;
  onChange: (c: BpmRampConfig) => void;
  micOn: boolean;
}

export function BpmRampPanel({ config, onChange, micOn }: BpmRampPanelProps) {
  function patch(partial: Partial<BpmRampConfig>) {
    onChange({ ...config, ...partial });
  }

  return (
    <div className="bpm-ramp-panel">
      <label className="checkbox">
        <input type="checkbox" checked={config.enabled} onChange={(e) => patch({ enabled: e.target.checked })} />
        BPM ramp on loop
      </label>
      {config.enabled && (
        <>
          <label>
            Start
            <NumberInput value={config.startBpm} min={MIN_BPM} max={MAX_BPM} onCommit={(v) => v !== null && patch({ startBpm: v })} />
          </label>
          <label>
            Step
            <NumberInput value={config.stepBpm} onCommit={(v) => v !== null && patch({ stepBpm: v })} />
          </label>
          <label>
            Max
            <NumberInput
              value={config.maxBpm}
              min={MIN_BPM}
              max={MAX_BPM}
              allowEmpty
              placeholder="none"
              onCommit={(v) => patch({ maxBpm: v })}
            />
          </label>
          <label>
            Advance after
            <NumberInput
              min={1}
              integer
              value={config.condition.count}
              onCommit={(v) =>
                v !== null &&
                patch({
                  condition:
                    config.condition.kind === "passes" ? { kind: "passes", count: v } : { ...config.condition, count: v },
                })
              }
            />
            passes
          </label>
          {micOn && (
            <label className="checkbox">
              <input
                type="checkbox"
                checked={config.condition.kind === "accuracy"}
                onChange={(e) =>
                  patch({
                    condition: e.target.checked
                      ? { kind: "accuracy", count: config.condition.count, minOnTimePct: 80 }
                      : { kind: "passes", count: config.condition.count },
                  })
                }
              />
              require accuracy (no misses, on-time %)
            </label>
          )}
          {config.condition.kind === "accuracy" && (
            <label>
              Min on-time %
              <NumberInput
                min={0}
                max={100}
                value={config.condition.minOnTimePct}
                onCommit={(v) =>
                  v !== null &&
                  patch({
                    condition: { ...config.condition, minOnTimePct: v } as BpmRampConfig["condition"],
                  })
                }
              />
            </label>
          )}
        </>
      )}
    </div>
  );
}
