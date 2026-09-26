// BPM ramp configuration (spec 12.2): for any loop, grid mode only. Start
// BPM, step, optional max, and an advance condition (after M passes, or after
// M consecutive accurate passes when mic is on).

import type { BpmRampConfig } from "../usePlaybackEngine";

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
            <input
              type="number"
              value={config.startBpm}
              onChange={(e) => patch({ startBpm: Number(e.target.value) })}
            />
          </label>
          <label>
            Step
            <input type="number" value={config.stepBpm} onChange={(e) => patch({ stepBpm: Number(e.target.value) })} />
          </label>
          <label>
            Max
            <input
              type="number"
              value={config.maxBpm ?? ""}
              placeholder="none"
              onChange={(e) => patch({ maxBpm: e.target.value === "" ? null : Number(e.target.value) })}
            />
          </label>
          <label>
            Advance after
            <input
              type="number"
              min={1}
              value={config.condition.count}
              onChange={(e) =>
                patch({
                  condition:
                    config.condition.kind === "passes"
                      ? { kind: "passes", count: Number(e.target.value) }
                      : { ...config.condition, count: Number(e.target.value) },
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
              <input
                type="number"
                min={0}
                max={100}
                value={config.condition.minOnTimePct}
                onChange={(e) =>
                  patch({
                    condition: { ...config.condition, minOnTimePct: Number(e.target.value) } as BpmRampConfig["condition"],
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
